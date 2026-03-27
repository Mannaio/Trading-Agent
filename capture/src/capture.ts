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

const CHART_RENDER_WAIT_MS = 3000;
const SYMBOL_SWITCH_WAIT_MS = 2000;

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

    // Get the current symbol from TradingView (to return in response)
    const capturedSymbol = await getCurrentSymbol(tvPage) ?? requestedSymbol ?? 'UNKNOWN';

    const screenshots: string[] = [];

    for (const tf of TIMEFRAMES) {
      await switchTimeframe(tvPage, tf.selector, tf.label);
      await tvPage.waitForTimeout(CHART_RENDER_WAIT_MS);

      const chartEl = await tvPage.$('.chart-markup-table');
      const buffer = chartEl ? await chartEl.screenshot() : await tvPage.screenshot();

      const base64 = `data:image/png;base64,${buffer.toString('base64')}`;
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
  // The symbol button is in the header toolbar
  const symbolButton = await page.$('#header-toolbar-symbol-search');
  
  if (!symbolButton) {
    console.log(`[Capture] ERROR: Could not find symbol button in header`);
    throw new Error('Could not find TradingView symbol button');
  }

  console.log(`[Capture] Step 1: Clicking symbol button...`);
  await symbolButton.click();
  await page.waitForTimeout(500);

  // Step 2: Wait for the Symbol Search modal to open and find the input
  console.log(`[Capture] Step 2: Waiting for Symbol Search modal...`);
  
  // The modal has a search input - try multiple selectors
  const searchInput = await page.waitForSelector(
    '[data-dialog-name="Symbol Search"] input, ' +
    '[aria-label="Symbol Search"] input, ' + 
    'div[class*="dialog"] input[type="text"], ' +
    'input[placeholder*="Search"], ' +
    'input[placeholder*="Symbol"]',
    { timeout: 3000, state: 'visible' }
  ).catch(() => null);

  if (!searchInput) {
    console.log(`[Capture] ERROR: Could not find search input in modal`);
    // Try to close the dialog and abort
    await page.keyboard.press('Escape');
    throw new Error('Could not find symbol search input');
  }

  // Step 3: Clear the input and type the symbol
  console.log(`[Capture] Step 3: Clearing input and typing "${symbol}"...`);
  await searchInput.click({ clickCount: 3 }); // Triple-click to select all
  await page.waitForTimeout(100);
  await searchInput.fill(symbol);
  await page.waitForTimeout(800); // Wait for search results to load

  // Step 4: Click the first result or press Enter
  console.log(`[Capture] Step 4: Selecting first result...`);
  
  // Try to find and click the first result row
  const firstResult = await page.$('[data-role="list"] [data-active="true"], [class*="listContainer"] > div:first-child, [class*="itemRow"]:first-child');
  
  if (firstResult) {
    console.log(`[Capture] Found first result, clicking...`);
    await firstResult.click();
  } else {
    console.log(`[Capture] No result row found, pressing Enter...`);
    await page.keyboard.press('Enter');
  }

  console.log(`[Capture] Waiting for chart to load new symbol...`);
  await page.waitForTimeout(SYMBOL_SWITCH_WAIT_MS);

  // Verify
  const newSymbol = await getCurrentSymbol(page);
  console.log(`[Capture] === DONE. Chart now shows: ${newSymbol} ===`);
}

async function getCurrentSymbol(page: Page): Promise<string | null> {
  // Try to read the symbol from the header
  const symbolEl = await page.$('#header-toolbar-symbol-search');
  if (symbolEl) {
    const text = await symbolEl.textContent();
    if (text) {
      // Clean up the symbol text (remove exchange prefix, whitespace, etc.)
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
