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
  // TradingView symbol search can be opened with keyboard shortcut or clicking symbol button
  // We'll use the keyboard shortcut which is more reliable
  await page.keyboard.press('.');
  await page.waitForTimeout(300);

  // Wait for search dialog to appear
  const searchInput = await page.waitForSelector(
    'input[data-role="search"], input[placeholder*="Search"], input[placeholder*="Symbol"]',
    { timeout: 3000 }
  ).catch(() => null);

  if (!searchInput) {
    // Fallback: try clicking on the symbol button in the header
    const symbolBtn = await page.$('#header-toolbar-symbol-search');
    if (symbolBtn) {
      await symbolBtn.click();
      await page.waitForTimeout(300);
    } else {
      throw new Error('Could not open symbol search dialog');
    }
  }

  // Clear existing text and type the new symbol
  await page.keyboard.press('Control+a');
  await page.keyboard.type(symbol, { delay: 50 });
  await page.waitForTimeout(500);

  // Press Enter to select the first result
  await page.keyboard.press('Enter');
  await page.waitForTimeout(SYMBOL_SWITCH_WAIT_MS);
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
