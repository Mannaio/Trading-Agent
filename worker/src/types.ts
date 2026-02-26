// ─── Symbol ───
export type Symbol = 'ETHUSDT' | 'BTCUSDT' | 'ETHBTC';

// ─── Trend Direction ───
export type TrendDirection = 'bullish' | 'bearish' | 'neutral';

// ─── Prediction Direction ───
export type Direction = 'HIGHER' | 'LOWER' | 'UNCLEAR';

// ─── Indicator values (optional) ───
export interface Indicators {
  trend: { '4h': TrendDirection; '1h': TrendDirection; '15m': TrendDirection };
}

// ─── API Request ───
export interface AnalysisRequest {
  symbol: Symbol;
  screenshots: string[];        // base64 data URLs (max 3)
  userReasoning: string;
  indicators?: Indicators;
  pastLessons?: string[];       // feedback from past lost trades
}

// ─── API Response ───
export interface AnalysisResponse {
  direction: Direction;
  probability: number;
  timeframeEstimate: string;
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
