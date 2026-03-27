import { chromium, type Page } from 'playwright';

export interface CaptureOptions {
  symbol?: string;
  cdpUrl?: string;
}

export interface CaptureResult {
  screenshots: string[]; // base64 data URLs, ordered [4H, 1H, 15m]
  timeframes: string[]; // ["4h", "1h", "15m"]
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

    for (const tf of TIMEFRAMES) {
      console.log(`[Capture] Switching to timeframe: ${tf.label}`);
      await switchTimeframe(tvPage, tf.selector, tf.label);
      
      // Wait for chart to fully load (indicators, candles, etc.)
      console.log(`[Capture] Waiting for chart to fully render...`);
      await waitForChartToLoad(tvPage);

      // Use TradingView's native snapshot feature
      console.log(`[Capture] Taking snapshot for ${tf.label}...`);
      const base64 = await takeNativeSnapshot(tvPage);
      screenshots.push(base64);
    }

    return {
      screenshots,
      timeframes: TIMEFRAMES.map((tf) => tf.label),
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
