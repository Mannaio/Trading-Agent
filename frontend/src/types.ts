// ─── Symbol ───
export type Symbol = 'ETHUSDT' | 'BTCUSDT' | 'ETHBTC';

// ─── Trend Direction ───
export type TrendDirection = 'bullish' | 'bearish' | 'neutral';

// ─── Timeframes ───
export type Timeframe = '4h' | '1h' | '15m';

// ─── Per-screenshot metadata ───
export interface ScreenshotMeta {
  dataUrl: string;
  timeframe: Timeframe;
  ema50?: number;
  ema200?: number;
  rsi?: number;
}

// ─── Prediction Direction ───
export type Direction = 'HIGHER' | 'LOWER' | 'UNCLEAR';

// ─── Trade Outcome ───
export type Outcome = 'review' | 'pending' | 'won' | 'lost' | 'expired' | 'cancelled';

// ─── Indicator values (optional structured data) ───
export interface Indicators {
  trend: { '4h': TrendDirection; '1h': TrendDirection; '15m': TrendDirection };
}

// ─── API Request ───
export interface AnalysisRequest {
  symbol: Symbol;
  screenshots: string[];        // base64 data URLs (max 3)
  screenshotsMeta?: ScreenshotMeta[];
  userReasoning: string;        // user's own thinking / thesis
  indicators?: Indicators;      // optional structured data
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
  probability: number;          // 0-100
  timeframeEstimate: string;    // e.g. "5-15 minutes"
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

// ─── Stored analysis (persisted in localStorage) ───
export interface StoredAnalysis extends AnalysisResponse {
  id: string;
  symbol: Symbol;
  userReasoning: string;
  screenshotCount: number;
  outcome: Outcome;
  outcomeTimestamp?: string;
  outcomePrice?: number;
  feedback?: string;            // user's lesson learned (set after lost trades)
  tradeAmount?: number;         // asset quantity (e.g. 0.2 ETH)
}

// ─── Direction display config ───
export const DIRECTION_CONFIG: Record<Direction, { label: string; color: string; emoji: string }> = {
  HIGHER:  { label: 'HIGHER (+0.5%)', color: 'text-emerald-400', emoji: '🟢' },
  LOWER:   { label: 'LOWER (-0.5%)',  color: 'text-red-400',     emoji: '🔴' },
  UNCLEAR: { label: 'UNCLEAR',        color: 'text-yellow-400',  emoji: '🟡' },
};

// ─── Outcome display config ───
export const OUTCOME_CONFIG: Record<Outcome, { label: string; color: string; bg: string; emoji: string }> = {
  review:  { label: 'REVIEW',  color: 'text-amber-400',   bg: 'bg-amber-500/20 border-amber-500/40', emoji: '🔍' },
  pending: { label: 'LIVE',    color: 'text-blue-400',    bg: 'bg-blue-500/20 border-blue-500/40', emoji: '⏳' },
  won:     { label: 'WON',     color: 'text-emerald-400', bg: 'bg-emerald-500/20 border-emerald-500/40', emoji: '✅' },
  lost:    { label: 'LOST',    color: 'text-red-400',     bg: 'bg-red-500/20 border-red-500/40', emoji: '❌' },
  expired:   { label: 'EXPIRED',   color: 'text-gray-400',    bg: 'bg-gray-500/20 border-gray-500/40', emoji: '⏰' },
  cancelled: { label: 'CANCELLED', color: 'text-orange-400',  bg: 'bg-orange-500/20 border-orange-500/40', emoji: '🚫' },
};
