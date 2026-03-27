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

const CHART_RENDER_WAIT_MS = 2000;
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
      console.log(`[Capture] Switching to timeframe: ${tf.label}`);
      await switchTimeframe(tvPage, tf.selector, tf.label);
      await tvPage.waitForTimeout(CHART_RENDER_WAIT_MS);

      // Use TradingView's native snapshot feature
      console.log(`[Capture] Taking native TradingView snapshot for ${tf.label}...`);
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

async function takeNativeSnapshot(page: Page): Promise<string> {
  // The FULL chart layout container includes the main chart + all indicator panes (RSI, DRO, etc.)
  // We need to capture the entire layout, not just .chart-markup-table
  
  // Selector priority for the full chart layout:
  // 1. .layout__area--center contains the entire chart area with all panes
  // 2. .chart-container or similar wrapper
  // 3. The main chart group that includes indicator panes
  
  const fullChartSelectors = [
    '.layout__area--center',           // Main chart area including all panes
    '[class*="chart-container"]',      // Chart container
    '.chart-gui-wrapper',              // GUI wrapper
    '#overlap-manager-root',           // Sometimes wraps everything
  ];

  // Try to find the full chart container
  let chartContainer = null;
  for (const selector of fullChartSelectors) {
    chartContainer = await page.$(selector);
    if (chartContainer) {
      console.log(`[Capture] Found chart container with selector: ${selector}`);
      break;
    }
  }

  if (chartContainer) {
    // Take a screenshot of the entire chart layout (includes RSI, DRO, etc.)
    console.log(`[Capture] Taking screenshot of full chart layout...`);
    const buffer = await chartContainer.screenshot();
    return `data:image/png;base64,${buffer.toString('base64')}`;
  }

  // Fallback: Try to get all canvas elements from ALL chart panes and combine them
  console.log(`[Capture] Using multi-pane canvas extraction...`);
  
  const base64 = await page.evaluate(() => {
    // Find the main layout area that contains all chart panes
    const layoutArea = document.querySelector('.layout__area--center') as HTMLElement;
    if (!layoutArea) {
      // Fallback to chart-markup-table if layout area not found
      const chartTable = document.querySelector('.chart-markup-table') as HTMLElement;
      if (!chartTable) return null;
      
      const rect = chartTable.getBoundingClientRect();
      const canvas = document.createElement('canvas');
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
      
      document.querySelectorAll('.chart-markup-table canvas').forEach((c) => {
        const htmlCanvas = c as HTMLCanvasElement;
        const canvasRect = htmlCanvas.getBoundingClientRect();
        ctx.drawImage(htmlCanvas, canvasRect.left - rect.left, canvasRect.top - rect.top);
      });
      
      return canvas.toDataURL('image/png');
    }
    
    const rect = layoutArea.getBoundingClientRect();
    const combinedCanvas = document.createElement('canvas');
    combinedCanvas.width = rect.width * window.devicePixelRatio;
    combinedCanvas.height = rect.height * window.devicePixelRatio;
    const ctx = combinedCanvas.getContext('2d');
    if (!ctx) return null;
    
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    
    // Get ALL canvases in the layout area (main chart + indicator panes)
    const allCanvases = layoutArea.querySelectorAll('canvas');
    console.log(`Found ${allCanvases.length} canvas elements`);
    
    allCanvases.forEach((canvas) => {
      const c = canvas as HTMLCanvasElement;
      const canvasRect = c.getBoundingClientRect();
      const x = canvasRect.left - rect.left;
      const y = canvasRect.top - rect.top;
      try {
        ctx.drawImage(c, x, y, canvasRect.width, canvasRect.height);
      } catch (e) {
        // Some canvases might be tainted, skip them
      }
    });
    
    return combinedCanvas.toDataURL('image/png');
  });

  if (base64) {
    console.log(`[Capture] Got image from multi-pane canvas extraction`);
    return base64;
  }

  // Last resort: Full page screenshot (cropped to visible area)
  console.log(`[Capture] Using full page screenshot as last resort...`);
  const buffer = await page.screenshot({ fullPage: false });
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
