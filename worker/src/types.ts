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

// ─── Agent 1 output: raw extracted data per chart ───
export interface ChartExtraction {
  timeframe: Timeframe;
  ema50: number | null;
  ema200: number | null;
  rsi: number | null;
  dro: {
    rightmostCycleNumberBelowZero: boolean | null; // true = LOW pivot (bullish), false = HIGH (bearish)
    rightmostCycleNumber: number | null;
    mean: number | null;
    barsSincePivot: number | null;
  } | null;
  currentPrice: number | null;
  extractionConfidence: 'high' | 'medium' | 'low';
}

// ─── Agent 2 output: interpretation for one timeframe ───
export interface TimeframeAnalysisResult {
  timeframe: Timeframe;
  emaBias: 'bullish' | 'bearish' | 'neutral';
  emaGapClassification: 'tight' | 'moderate' | 'wide';
  emaGapPercent: number;
  rsiSignal: 'overbought' | 'oversold' | 'neutral';
  rsiValue: number | null;
  droBias: 'bullish' | 'bearish' | 'unclear';
  droCycleProgressPercent: number | null;
  overallBias: 'bullish' | 'bearish' | 'unclear';
  confidence: number; // 0-100
  summary: string;
  // Backward-compat flat fields (used by orchestrator to fill AnalysisResponse.analysis)
  ema: string;
  rsi: string;
  dro: string;
}

// ─── Agent 3 output: synthesis across all timeframes ───
export interface SynthesisResult {
  direction: Direction;
  probability: number;
  timeframeEstimate: string;
  conclusion: string;
  thesisFeedback: string;
  keyRisk: string;
}

// ─── Portfolio context sent by frontend ───
export interface PortfolioContext {
  portfolioSizeUsd: number;
  maxRiskPerTradePercent: number;
  totalTrades: number;
  winRate: number; // 0-1
  winRateByProbabilityBand: {
    '55-65': number | null;
    '65-75': number | null;
    '75+': number | null;
  };
  recentStreak: string; // e.g. "3 losses", "2 wins", "mixed"
}

// ─── Agent 4 output: trade strategy ───
export interface StrategyResult {
  entry: number;
  stopLoss: number;
  takeProfit: number;
  riskReward: number;
  suggestedPositionSizeUsd: number | null;
  suggestedPositionSizePercent: number | null;
  tradeRecommendation: 'TAKE' | 'SKIP' | 'WAIT';
  recommendationReasoning: string;
}

// ─── API Request ───
export interface AnalysisRequest {
  symbol: Symbol;
  screenshots: string[];        // base64 data URLs (max 3)
  screenshotsMeta?: ScreenshotMeta[];
  userReasoning: string;
  indicators?: Indicators;
  pastLessons?: string[];       // feedback from past lost trades
  portfolioContext?: PortfolioContext;
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
  tradeRecommendation?: 'TAKE' | 'SKIP' | 'WAIT';
  recommendationReasoning?: string;
  suggestedPositionSizeUsd?: number;
  suggestedPositionSizePercent?: number;
  riskReward?: number;
  extractions?: ChartExtraction[];
}

// ─── Cloudflare Worker env bindings ───
export interface Env {
  OPENAI_API_KEY: string;
}
