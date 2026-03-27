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

    // Get the current symbol from TradingView
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
  const symbolButton = await page.$('#header-toolbar-symbol-search');
  
  if (!symbolButton) {
    console.log(`[Capture] ERROR: Could not find symbol button in header`);
    throw new Error('Could not find TradingView symbol button');
  }

  console.log(`[Capture] Step 1: Clicking symbol button...`);
  await symbolButton.click();
  await page.waitForTimeout(600);

  // Step 2: Find the search input in the modal
  console.log(`[Capture] Step 2: Looking for search input...`);
  
  const searchInput = await page.$('input[type="text"]');

  if (!searchInput) {
    console.log(`[Capture] ERROR: Could not find search input`);
    await page.keyboard.press('Escape');
    throw new Error('Could not find symbol search input');
  }

  // Step 3: Clear and type the new symbol
  console.log(`[Capture] Step 3: Typing "${symbol}"...`);
  await searchInput.click({ clickCount: 3 }); // Select all existing text
  await page.waitForTimeout(100);
  await page.keyboard.type(symbol, { delay: 50 });
  
  // Wait for search results to load
  console.log(`[Capture] Waiting for search results...`);
  await page.waitForTimeout(1000);

  // Step 4: Press Down arrow to select first result, then Enter
  console.log(`[Capture] Step 4: Selecting first result...`);
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
