import {
  DEFAULT_MIN_CONFIDENCE,
  formatAlertEmail,
  shouldSendEmail,
  type PolymarketCall,
  type PolymarketMarketWindow,
} from './watch-notify.js';

export type TickStatus = 'sent' | 'skip' | 'error';

export interface CaptureResult {
  screenshot: string;
  rsi?: number | null;
  rsiCrop?: string | null;
  droCrop?: string | null;
  droDominanceCrop?: string | null;
}

export interface AnalyzeRequest {
  symbol: string;
  screenshot: string;
  screenshotsMeta?: {
    rsi?: number;
    rsiCrop?: string;
    droCrop?: string;
    droDominanceCrop?: string;
  };
  marketWindow: PolymarketMarketWindow;
}

export interface AnalyzeResult {
  call: PolymarketCall;
  confidence: number;
  marketWindow: PolymarketMarketWindow;
  maxBuyUpCents: number | null;
  maxBuyDownCents: number | null;
  edgeNote: string;
  reasoning: string;
  reports: {
    rsi: { rsiValue: number | null };
    dro: { dominanceColor: string };
  };
  vetoApplied: boolean;
  timestamp: string;
}

export interface TickConfig {
  symbol: string;
  marketWindow: PolymarketMarketWindow;
  minConfidence?: number;
}

export interface TickDeps {
  capture: (symbol: string) => Promise<CaptureResult>;
  analyze: (request: AnalyzeRequest) => Promise<AnalyzeResult>;
  sendEmail: (msg: { subject: string; text: string }) => Promise<void>;
  log: (msg: string) => void;
}

function buildScreenshotsMeta(capture: CaptureResult): AnalyzeRequest['screenshotsMeta'] {
  const meta: NonNullable<AnalyzeRequest['screenshotsMeta']> = {};
  if (capture.rsi != null) meta.rsi = capture.rsi;
  if (capture.rsiCrop) meta.rsiCrop = capture.rsiCrop;
  if (capture.droCrop) meta.droCrop = capture.droCrop;
  if (capture.droDominanceCrop) meta.droDominanceCrop = capture.droDominanceCrop;
  return Object.keys(meta).length > 0 ? meta : undefined;
}

export function createOverlapGuard(
  run: () => Promise<void>,
  log: (msg: string) => void,
): () => Promise<void> {
  let running = false;
  return async () => {
    if (running) {
      log('skip overlapping tick');
      return;
    }
    running = true;
    try {
      await run();
    } finally {
      running = false;
    }
  };
}

export async function runTick(config: TickConfig, deps: TickDeps): Promise<TickStatus> {
  const minConfidence = config.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  try {
    const captured = await deps.capture(config.symbol);
    const result = await deps.analyze({
      symbol: config.symbol,
      screenshot: captured.screenshot,
      screenshotsMeta: buildScreenshotsMeta(captured),
      marketWindow: config.marketWindow,
    });

    if (!shouldSendEmail(result.call, result.confidence, minConfidence)) {
      deps.log(`SKIP ${config.symbol} ${config.marketWindow} ${result.call} ${result.confidence}%`);
      return 'skip';
    }

    const email = formatAlertEmail({
      call: result.call,
      symbol: config.symbol,
      marketWindow: result.marketWindow,
      confidence: result.confidence,
      maxBuyUpCents: result.maxBuyUpCents,
      maxBuyDownCents: result.maxBuyDownCents,
      edgeNote: result.edgeNote,
      reasoning: result.reasoning,
      rsiValue: result.reports.rsi.rsiValue,
      dominanceColor: result.reports.dro.dominanceColor,
      vetoApplied: result.vetoApplied,
      timestamp: result.timestamp,
    });
    await deps.sendEmail(email);
    deps.log(`SENT ${result.call} ${config.symbol} ${config.marketWindow} ${result.confidence}%`);
    return 'sent';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.log(`ERROR ${message}`);
    return 'error';
  }
}
