export type PolymarketCall = 'UP' | 'DOWN' | 'SKIP';
export type PolymarketMarketWindow = '5m' | '15m';
export type PolymarketSymbol = 'ETHUSDT' | 'BTCUSD' | 'BNBUSDT';

export const POLYMARKET_SYMBOLS: PolymarketSymbol[] = ['ETHUSDT', 'BTCUSD', 'BNBUSDT'];

export interface RsiReport {
  rsiValue: number | null;
  zone: 'oversold' | 'mid' | 'overbought';
  slope: 'rising' | 'falling' | 'flat';
  extreme: 'peak' | 'trough' | 'none';
  roomToMove: 'spike' | 'drop' | 'both' | 'none';
  roomConfidence: number;
  marginNotes: string;
  bias: 'bullish' | 'bearish' | 'neutral';
  caveats: string[];
}

export interface DroReport {
  dominanceColor: 'green' | 'red' | 'unclear';
  dominanceSinceBars: number | null;
  lookbackWindow: 'last_70_minutes';
  alertCycle: {
    pivotDirection: 'LOW' | 'HIGH' | 'unclear';
    mean: number | null;
    barsSincePivot: number | null;
  };
  notes: string;
}

export interface EmaDpoReport {
  emaBias: 'bullish' | 'bearish' | 'neutral';
  emaGap: 'tight' | 'moderate' | 'wide';
  priceVsEma: 'extended_above' | 'between' | 'extended_below' | 'unclear';
  dpoSwing: {
    lastHighHighDistance: number | null;
    lastLowLowDistance: number | null;
    interpretation: string;
  };
  supportsCall: 'yes' | 'no' | 'neutral';
  notes: string;
}

export interface PolymarketScreenshotMeta {
  rsi?: number;
  rsiCrop?: string;
  droCrop?: string;
  droDominanceCrop?: string;
}

export interface PolymarketMarketPrices {
  upCents: number;
  downCents: number;
}

export interface PolymarketRequest {
  symbol: PolymarketSymbol;
  screenshot: string;
  screenshotsMeta?: PolymarketScreenshotMeta;
  marketWindow: PolymarketMarketWindow;
  marketPrices?: PolymarketMarketPrices;
  notes?: string;
}

export interface PolymarketResponse {
  call: PolymarketCall;
  confidence: number;
  marketWindow: PolymarketMarketWindow;
  maxBuyUpCents: number | null;
  maxBuyDownCents: number | null;
  edgeNote: string;
  reasoning: string;
  reports: {
    rsi: RsiReport;
    dro: DroReport;
    emaDpo: EmaDpoReport;
  };
  vetoApplied: boolean;
  correlationCall: PolymarketCall;
  timestamp: string;
}

/** Input bundle passed from orchestrator to DecisionAgent */
export interface PolymarketAnalysisInput {
  request: PolymarketRequest;
  reports: {
    rsi: RsiReport;
    dro: DroReport;
    emaDpo: EmaDpoReport;
  };
  gateCall: PolymarketCall;
}
