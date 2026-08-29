import { chromium, type Page } from 'playwright';
import { assertTradingViewTabOpen, CDP_CONNECT_HINT, CDP_CONNECT_OPTIONS } from './cdp-prep.js';
import {
  captureDroPane,
  captureRsiLegend,
  extractRsiValue,
  findTradingViewTab,
  switchSymbol,
  switchTimeframe,
  takeNativeSnapshot,
  waitForChartToLoad,
} from './capture.js';

export interface PolymarketCaptureOptions {
  symbol?: string;
  cdpUrl?: string;
}

export interface PolymarketCaptureResult {
  screenshot: string;
  rsi: number | null;
  rsiCrop: string | null;
  droCrop: string | null;
  droDominanceCrop: string | null;
  symbol: string;
  timeframe: '5m';
}

const TIMEFRAME_5M = { label: '5m', selector: '[data-value="5"]' };

/** Maps app symbol ids to TradingView search strings. */
const TRADINGVIEW_SYMBOL: Record<string, string> = {
  ETHUSDT: 'ETHUSDT',
  BTCUSD: 'COINBASE:BTCUSD',
  BNBUSDT: 'BNBUSDT',
};

function resolveTradingViewSymbol(symbol: string): string {
  return TRADINGVIEW_SYMBOL[symbol] ?? symbol;
}

/**
 * Crop the DRO dominance band strip (green/red background at the bottom of the DRO pane).
 */
export async function captureDroDominancePane(page: Page): Promise<string | null> {
  const handles = await page.$$('[class*="pane"]');
  for (const el of handles) {
    const text = await el.evaluate((e: Element) => (e.textContent || '').replace(/\s+/g, ' ').trim());
    if (!/Detrended Rhythm Oscillator|DRO.*Alerts/i.test(text)) continue;
    const box = await el.boundingBox();
    if (!box || box.width < 100 || box.height < 60) continue;

    // Dominance bands sit at the bottom of the DRO pane — avoid sending the full pane image.
    const dominanceHeight = Math.min(120, box.height);
    const padding = 4;
    const clip = {
      x: Math.max(0, box.x - padding),
      y: Math.max(0, box.y + box.height - dominanceHeight - padding),
      width: Math.min(box.width + padding * 2, 1200),
      height: dominanceHeight + padding * 2,
    };
    const buffer = await page.screenshot({ clip });
    return `data:image/png;base64,${buffer.toString('base64')}`;
  }
  return null;
}

export async function capturePolymarketCharts(
  options: PolymarketCaptureOptions = {},
): Promise<PolymarketCaptureResult> {
  const cdpUrl = options.cdpUrl ?? 'http://127.0.0.1:9222';
  const symbol = options.symbol ?? 'ETHUSDT';
  const tradingViewSymbol = resolveTradingViewSymbol(symbol);

  await assertTradingViewTabOpen(cdpUrl);

  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>>;
  try {
    browser = await chromium.connectOverCDP(cdpUrl, CDP_CONNECT_OPTIONS);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('Timeout') && message.includes('connectOverCDP')) {
      throw new Error(`${CDP_CONNECT_HINT} (${message})`);
    }
    throw err;
  }

  try {
    const tvPage = await findTradingViewTab(browser);

    if (!tvPage) {
      throw new Error(
        'No TradingView chart tab found. Make sure you have tradingview.com/chart open in Chrome.',
      );
    }

    await tvPage.bringToFront();

    console.log(`[Polymarket Capture] Switching to symbol: ${tradingViewSymbol}`);
    await switchSymbol(tvPage, tradingViewSymbol);

    console.log(`[Polymarket Capture] Switching to timeframe: ${TIMEFRAME_5M.label}`);
    await switchTimeframe(tvPage, TIMEFRAME_5M.selector, TIMEFRAME_5M.label);

    console.log(`[Polymarket Capture] Waiting for chart to fully render...`);
    await waitForChartToLoad(tvPage);

    await tvPage.mouse.move(10, 10);
    await tvPage.waitForTimeout(300);

    const { value: rsi, rawText: rsiRawText } = await extractRsiValue(tvPage);
    console.log(`[Polymarket Capture] RSI raw text: "${rsiRawText ?? 'no match'}"`);
    console.log(`[Polymarket Capture] RSI: ${rsi ?? 'not found'}`);

    const rsiCrop = await captureRsiLegend(tvPage);
    console.log(`[Polymarket Capture] RSI legend crop: ${rsiCrop ? 'captured' : 'not found'}`);

    const droCrop = await captureDroPane(tvPage);
    console.log(`[Polymarket Capture] DRO pane crop: ${droCrop ? 'captured' : 'not found'}`);

    const droDominanceCrop = await captureDroDominancePane(tvPage);
    console.log(
      `[Polymarket Capture] DRO dominance crop: ${droDominanceCrop ? 'captured' : 'not found'}`,
    );

    console.log(`[Polymarket Capture] Taking snapshot...`);
    const screenshot = await takeNativeSnapshot(tvPage);

    return {
      screenshot,
      rsi,
      rsiCrop,
      droCrop,
      droDominanceCrop,
      symbol,
      timeframe: '5m',
    };
  } finally {
    browser.close();
  }
}
