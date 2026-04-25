// ─── Symbol ───
export type Symbol = 'ETHUSDT' | 'BTCUSDT' | 'ETHBTC';

// ─── Trend Direction ───
export type TrendDirection = 'bullish' | 'bearish' | 'neutral';

// ─── Timeframes ───
export type Timeframe = '4h' | '1h' | '15m';

// ─── Prediction Direction ───
export type Direction = 'HIGHER' | 'LOWER' | 'UNCLEAR';

// ─── Per-screenshot metadata ───
export interface ScreenshotMeta {
  dataUrl: string;
  timeframe: Timeframe;
  ema50?: number;
  ema200?: number;
  rsi?: number;
  /** Cropped screenshot of the RSI legend row — same frame as dataUrl, guaranteed to match */
  rsiCrop?: string;
  /** Cropped screenshot of the full DRO Alert pane — for pivot direction detection */
  droCrop?: string;
  /** User-confirmed DRO last pivot type — authoritative when provided */
  droPivot?: 'LOW' | 'HIGH';
}

// ─── Indicator values (optional) ───
export interface Indicators {
  trend: { '4h': TrendDirection; '1h': TrendDirection; '15m': TrendDirection };
}

// ─── API Request ───
export interface AnalysisRequest {
  symbol: Symbol;
  screenshots: string[];        // base64 data URLs (max 3)
  screenshotsMeta?: ScreenshotMeta[];
  userReasoning: string;
  indicators?: Indicators;
  pastLessons?: string[];       // feedback from past lost trades
}

// ─── Per-timeframe analysis ───
export interface TimeframeAnalysis {
  ema: string;
  rsi: string;
  dro: string;
}

// ─── API Response ───
export interface AnalysisResponse {
  direction: Direction;
  probability: number;
  timeframeEstimate: string;
  analysis: Record<Timeframe, TimeframeAnalysis>;
  conclusion: string;
  reasoning: string;
  thesisFeedback: string;
  keyRisk: string;
  levels: {
    entry: number;
    stopLoss: number;
    takeProfit: number;
  };
  timestamp: string;
}

// ─── Cloudflare Worker env bindings ───
export interface Env {
  OPENAI_API_KEY: string;
}
