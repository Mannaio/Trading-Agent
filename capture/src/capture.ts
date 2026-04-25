import { chromium, type Page } from 'playwright';

export interface CaptureOptions {
  symbol?: string;
  cdpUrl?: string;
}

export interface CaptureResult {
  screenshots: string[]; // base64 data URLs, ordered [4H, 1H, 15m]
  timeframes: string[]; // ["4h", "1h", "15m"]
  rsiValues: (number | null)[]; // RSI values per timeframe, extracted from DOM (for logging)
  /** Cropped screenshot of the RSI legend row — same frame as the main screenshot */
  rsiCrops: (string | null)[]; // base64 data URLs
  /** Cropped screenshot of the full DRO Alert pane — used by the model to read pivot direction */
  droCrops: (string | null)[]; // base64 data URLs
  symbol: string; // the symbol that was captured
}

const TIMEFRAMES = [
  { label: '4h', selector: '[data-value="240"]' },
  { label: '1h', selector: '[data-value="60"]' },
  { label: '15m', selector: '[data-value="15"]' },
];

const SYMBOL_SWITCH_WAIT_MS = 2000;
const MAX_LOADING_WAIT_MS = 10000; // Max time to wait for chart to load

export async function captureCharts(options: CaptureOptions = {}): Promise<CaptureResult> {
  const cdpUrl = options.cdpUrl ?? 'http://localhost:9222';
  const requestedSymbol = options.symbol;

  const browser = await chromium.connectOverCDP(cdpUrl);

  try {
    const tvPage = await findTradingViewTab(browser);

    if (!tvPage) {
      throw new Error(
        'No TradingView chart tab found. Make sure you have tradingview.com/chart open in Chrome.'
      );
    }

    await tvPage.bringToFront();

    // Switch to requested symbol if provided
    if (requestedSymbol) {
      await switchSymbol(tvPage, requestedSymbol);
    }

    // Get the current symbol from TradingView
    const capturedSymbol = await getCurrentSymbol(tvPage) ?? requestedSymbol ?? 'UNKNOWN';

    const screenshots: string[] = [];
    const rsiValues: (number | null)[] = [];

    // Read the RSI before the first timeframe switch so we have an "old" reference to detect change
    let previousRsi = (await extractRsiValue(tvPage)).value;

    const rsiCrops: (string | null)[] = [];
    const droCrops: (string | null)[] = [];

    for (const tf of TIMEFRAMES) {
      console.log(`[Capture] Switching to timeframe: ${tf.label}`);
      await switchTimeframe(tvPage, tf.selector, tf.label);

      console.log(`[Capture] Waiting for chart to fully render...`);
      await waitForChartToLoad(tvPage);

      // Wait until the RSI value actually changes from the previous timeframe's value.
      const { value: rsi, rawText: rsiRawText } = await waitForRsiChange(tvPage, previousRsi);
      console.log(`[Capture] RSI raw text for ${tf.label}: "${rsiRawText ?? 'no match'}"`);
      console.log(`[Capture] RSI for ${tf.label}: ${rsi ?? 'not found'}`);
      rsiValues.push(rsi);
      previousRsi = rsi;

      // Crop RSI legend row and DRO pane from the same rendered frame as the main screenshot
      const rsiCrop = await captureRsiLegend(tvPage);
      console.log(`[Capture] RSI legend crop for ${tf.label}: ${rsiCrop ? 'captured' : 'not found'}`);
      rsiCrops.push(rsiCrop);

      const droCrop = await captureDroPane(tvPage);
      console.log(`[Capture] DRO pane crop for ${tf.label}: ${droCrop ? 'captured' : 'not found'}`);
      droCrops.push(droCrop);

      console.log(`[Capture] Taking snapshot for ${tf.label}...`);
      const base64 = await takeNativeSnapshot(tvPage);
      screenshots.push(base64);
    }

    return {
      screenshots,
      timeframes: TIMEFRAMES.map((tf) => tf.label),
      rsiValues,
      rsiCrops,
      droCrops,
      symbol: capturedSymbol,
    };
  } finally {
    browser.close();
  }
}

async function waitForChartToLoad(page: Page): Promise<void> {
  console.log(`[Capture] Waiting for chart to fully load...`);
  
  // Step 1: Wait for any loading spinners to disappear
  await page.waitForTimeout(1000);
  
  // Step 2: Wait for the chart to stop updating (network idle)
  try {
    await page.waitForLoadState('networkidle', { timeout: 5000 });
    console.log(`[Capture] Network idle reached`);
  } catch {
    console.log(`[Capture] Network idle timeout, continuing...`);
  }
  
  // Step 3: Wait for indicator data to be rendered
  // Check that RSI/DRO values are visible in the indicator panes
  const maxAttempts = 15;
  for (let i = 0; i < maxAttempts; i++) {
    const indicatorsReady = await page.evaluate(() => {
      // Look for indicator value text in the pane legends
      // TradingView shows values like "RSI (2, close, SMA, 14, 2) 45.67"
      const panes = document.querySelectorAll('[class*="pane"]');
      let rsiFound = false;
      let droFound = false;
      
      panes.forEach(pane => {
        const text = pane.textContent || '';
        if (text.includes('RSI') && /\d+\.\d+/.test(text)) {
          rsiFound = true;
        }
        if ((text.includes('DRO') || text.includes('Detrended')) && /\d+/.test(text)) {
          droFound = true;
        }
      });
      
      // Also check for any numeric values in legend areas
      const legends = document.querySelectorAll('[class*="legend"], [class*="valuesWrapper"]');
      let hasNumericValues = false;
      legends.forEach(legend => {
        if (/\d+\.\d{2}/.test(legend.textContent || '')) {
          hasNumericValues = true;
        }
      });
      
      return { rsiFound, droFound, hasNumericValues };
    });
    
    console.log(`[Capture] Check ${i + 1}/${maxAttempts}: RSI=${indicatorsReady.rsiFound}, DRO=${indicatorsReady.droFound}, values=${indicatorsReady.hasNumericValues}`);
    
    if (indicatorsReady.hasNumericValues) {
      console.log(`[Capture] Indicators appear to be loaded`);
      // Extra wait to ensure everything is rendered
      await page.waitForTimeout(2000);
      return;
    }
    
    await page.waitForTimeout(500);
  }
  
  // Final fallback wait
  console.log(`[Capture] Indicators check timed out, adding extra wait...`);
  await page.waitForTimeout(3000);
}

async function takeNativeSnapshot(page: Page): Promise<string> {
  console.log(`[Capture] Taking screenshot of full viewport...`);
  
  // Hide any floating UI elements that shouldn't be in the screenshot
  await page.evaluate(() => {
    const hideSelectors = [
      '[class*="popup"]',
      '[class*="tooltip"]', 
      '[class*="dropdown-menu"]',
      '[class*="context-menu"]',
    ];
    hideSelectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(el => {
        (el as HTMLElement).style.setProperty('visibility', 'hidden', 'important');
      });
    });
  });
  
  await page.waitForTimeout(100);
  
  // Take screenshot of the full visible page (includes all indicator panes)
  const buffer = await page.screenshot({ 
    fullPage: false,
    type: 'png',
  });
  
  // Restore hidden elements
  await page.evaluate(() => {
    const hideSelectors = [
      '[class*="popup"]',
      '[class*="tooltip"]',
      '[class*="dropdown-menu"]',
      '[class*="context-menu"]',
    ];
    hideSelectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(el => {
        (el as HTMLElement).style.removeProperty('visibility');
      });
    });
  });
  
  console.log(`[Capture] Screenshot taken successfully`);
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

/**
 * Crop a screenshot of just the RSI legend row (the line that reads "RSI 2 close 52.96").
 * This is taken from the exact same rendered frame as the main screenshot so it cannot
 * disagree with what is visible in the chart.
 */
async function captureRsiLegend(page: Page): Promise<string | null> {
  const handles = await page.$$('[class*="study"]');
  for (const el of handles) {
    const text = await el.evaluate((e: Element) => (e.textContent || '').replace(/\s+/g, ' ').trim());
    if (!/RSI[\s\d]*close/i.test(text)) continue;
    const box = await el.boundingBox();
    if (!box || box.width < 20 || box.height < 4) continue;

    // Add padding so the number is clearly readable
    const padding = 6;
    const clip = {
      x: Math.max(0, box.x - padding),
      y: Math.max(0, box.y - padding),
      width: Math.min(box.width + padding * 2, 700),
      height: box.height + padding * 2,
    };
    const buffer = await page.screenshot({ clip });
    return `data:image/png;base64,${buffer.toString('base64')}`;
  }
  return null;
}

/**
 * Crop a screenshot of the full DRO Alert pane (the zigzag panel).
 * The model uses this to determine the last pivot direction:
 * if the rightmost cycle number sits BELOW the 0 axis → last pivot was LOW, heading UP.
 * If ABOVE the 0 axis → last pivot was HIGH, heading DOWN.
 */
async function captureDroPane(page: Page): Promise<string | null> {
  const handles = await page.$$('[class*="pane"], [class*="study"]');
  for (const el of handles) {
    const text = await el.evaluate((e: Element) => (e.textContent || '').replace(/\s+/g, ' ').trim());
    if (!/DRO Alert|DRO.*close/i.test(text)) continue;
    const box = await el.boundingBox();
    if (!box || box.width < 100 || box.height < 30) continue;

    const padding = 4;
    const clip = {
      x: Math.max(0, box.x - padding),
      y: Math.max(0, box.y - padding),
      width: Math.min(box.width + padding * 2, 1920),
      height: box.height + padding * 2,
    };
    const buffer = await page.screenshot({ clip });
    return `data:image/png;base64,${buffer.toString('base64')}`;
  }
  return null;
}

async function extractRsiValue(page: Page): Promise<{ value: number | null; rawText: string | null }> {
  return page.evaluate(() => {
    const RE = /RSI[\s\d]*close\s*([\d.]+)/i;

    // Primary: study legend items
    const studyItems = document.querySelectorAll('[class*="study"]');
    for (const item of studyItems) {
      const text = (item.textContent || '').replace(/\s+/g, ' ').trim();
      const match = text.match(RE);
      if (match) {
        const val = parseFloat(match[1]);
        if (!isNaN(val) && val >= 0 && val <= 100) {
          // Return first 80 chars of the matched text as context
          return { value: val, rawText: text.slice(0, 80) };
        }
      }
    }
    // Fallback: legend / valuesWrapper elements
    const legends = document.querySelectorAll('[class*="legend"], [class*="valuesWrapper"]');
    for (const legend of legends) {
      const text = (legend.textContent || '').replace(/\s+/g, ' ').trim();
      const match = text.match(RE);
      if (match) {
        const val = parseFloat(match[1]);
        if (!isNaN(val) && val >= 0 && val <= 100) {
          return { value: val, rawText: text.slice(0, 80) };
        }
      }
    }
    return { value: null, rawText: null };
  });
}

/**
 * Poll until the RSI legend value differs from `oldRsi` (meaning TradingView has refreshed
 * the indicator for the new timeframe). Falls back after `timeoutMs` with whatever value
 * is currently shown.
 */
async function waitForRsiChange(
  page: Page,
  oldRsi: number | null,
  timeoutMs = 10_000,
): Promise<{ value: number | null; rawText: string | null }> {
  const interval = 400;
  const maxAttempts = Math.ceil(timeoutMs / interval);

  for (let i = 0; i < maxAttempts; i++) {
    const result = await extractRsiValue(page);
    const changed =
      result.value !== null &&
      (oldRsi === null || Math.abs(result.value - oldRsi) > 0.01);
    if (changed) {
      console.log(`[Capture] RSI changed from ${oldRsi ?? 'null'} → ${result.value} after ${(i + 1) * interval}ms`);
      return result;
    }
    await page.waitForTimeout(interval);
  }

  // Timeout — return whatever is showing (may still be stale)
  const fallback = await extractRsiValue(page);
  console.log(`[Capture] RSI did not change after ${timeoutMs}ms, using current value: ${fallback.value ?? 'null'}`);
  return fallback;
}

async function findTradingViewTab(
  browser: Awaited<ReturnType<typeof chromium.connectOverCDP>>
): Promise<Page | null> {
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      if (page.url().includes('tradingview.com/chart')) {
        return page;
      }
    }
  }
  return null;
}

async function switchSymbol(page: Page, symbol: string): Promise<void> {
  console.log(`[Capture] === SWITCHING SYMBOL TO: ${symbol} ===`);

  // Step 1: Click on the symbol in the top-left to open Symbol Search modal
  const symbolButton = await page.$('#header-toolbar-symbol-search');
  
  if (!symbolButton) {
    console.log(`[Capture] ERROR: Could not find symbol button in header`);
    throw new Error('Could not find TradingView symbol button');
  }

  console.log(`[Capture] Step 1: Clicking symbol button...`);
  await symbolButton.click();
  await page.waitForTimeout(800);

  // Step 2: The search input should already be focused, just select all and type
  // Using keyboard shortcuts for cross-platform compatibility
  console.log(`[Capture] Step 2: Selecting all text in search input...`);
  await page.keyboard.press('Meta+a'); // Cmd+A on Mac
  await page.waitForTimeout(100);

  // Step 3: Type the new symbol (will replace selected text)
  console.log(`[Capture] Step 3: Typing "${symbol}"...`);
  await page.keyboard.type(symbol, { delay: 50 });
  
  // Wait for search results to load
  console.log(`[Capture] Waiting for search results...`);
  await page.waitForTimeout(1000);

  // Step 4: Press Down arrow to select first result, then Enter
  console.log(`[Capture] Step 4: Selecting first result (ArrowDown + Enter)...`);
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(100);
  await page.keyboard.press('Enter');

  console.log(`[Capture] Waiting for chart to load new symbol...`);
  await page.waitForTimeout(SYMBOL_SWITCH_WAIT_MS);

  // Verify
  const newSymbol = await getCurrentSymbol(page);
  console.log(`[Capture] === DONE. Chart now shows: ${newSymbol} ===`);
}

async function getCurrentSymbol(page: Page): Promise<string | null> {
  const symbolEl = await page.$('#header-toolbar-symbol-search');
  if (symbolEl) {
    const text = await symbolEl.textContent();
    if (text) {
      return text.replace(/^[A-Z]+:/, '').trim().replace(/\s+/g, '');
    }
  }
  return null;
}

async function switchTimeframe(page: Page, selector: string, label: string): Promise<void> {
  const btn = await page.$(selector);
  if (btn) {
    await btn.click();
    return;
  }

  // Fallback: open the timeframe dropdown and search
  const dropdownTrigger = await page.$('#header-toolbar-intervals');
  if (dropdownTrigger) {
    await dropdownTrigger.click();
    await page.waitForTimeout(300);
    const option = await page.$(selector);
    if (option) {
      await option.click();
      return;
    }
  }

  throw new Error(`Could not find timeframe button for ${label}`);
}
