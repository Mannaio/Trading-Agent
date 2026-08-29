export type PolymarketCall = 'UP' | 'DOWN' | 'SKIP';
export type PolymarketMarketWindow = '5m' | '15m';
export type PolymarketSymbol = 'ETHUSDT' | 'BTCUSD' | 'BNBUSDT';

export const POLYMARKET_SYMBOL_OPTIONS: { value: PolymarketSymbol; label: string }[] = [
  { value: 'ETHUSDT', label: 'ETH / USDT (Binance)' },
  { value: 'BTCUSD', label: 'BTC / USD (Coinbase)' },
  { value: 'BNBUSDT', label: 'BNB / USDT (Binance)' },
];

export function formatPolymarketSymbolLabel(symbol: PolymarketSymbol): string {
  switch (symbol) {
    case 'ETHUSDT':
      return 'ETH / USDT';
    case 'BTCUSD':
      return 'BTC / USD';
    case 'BNBUSDT':
      return 'BNB / USDT';
    default: {
      const _exhaustive: never = symbol;
      return _exhaustive;
    }
  }
}

export function polymarketSymbolShort(symbol: PolymarketSymbol): string {
  switch (symbol) {
    case 'ETHUSDT':
      return 'ETH';
    case 'BTCUSD':
      return 'BTC';
    case 'BNBUSDT':
      return 'BNB';
    default: {
      const _exhaustive: never = symbol;
      return _exhaustive;
    }
  }
}

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

export type PolymarketOutcome = 'review' | 'took' | 'skipped' | 'won' | 'lost';

export interface StoredPolymarketAnalysis extends PolymarketResponse {
  id: string;
  symbol: PolymarketSymbol;
  notes?: string;
  marketPrices?: PolymarketMarketPrices;
  outcome: PolymarketOutcome;
  outcomeTimestamp?: string;
}

export const POLYMARKET_CALL_CONFIG: Record<
  PolymarketCall,
  { label: string; color: string; emoji: string }
> = {
  UP: { label: 'UP', color: 'text-emerald-400', emoji: '🟢' },
  DOWN: { label: 'DOWN', color: 'text-red-400', emoji: '🔴' },
  SKIP: { label: 'SKIP', color: 'text-yellow-400', emoji: '🟡' },
};

export const POLYMARKET_OUTCOME_CONFIG: Record<
  PolymarketOutcome,
  { label: string; color: string; bg: string; emoji: string }
> = {
  review: { label: 'REVIEW', color: 'text-amber-400', bg: 'bg-amber-500/20 border-amber-500/40', emoji: '🔍' },
  took: { label: 'TOOK', color: 'text-blue-400', bg: 'bg-blue-500/20 border-blue-500/40', emoji: '✅' },
  skipped: { label: 'SKIPPED', color: 'text-gray-400', bg: 'bg-gray-500/20 border-gray-500/40', emoji: '⏭️' },
  won: { label: 'WON', color: 'text-emerald-400', bg: 'bg-emerald-500/20 border-emerald-500/40', emoji: '🏆' },
  lost: { label: 'LOST', color: 'text-red-400', bg: 'bg-red-500/20 border-red-500/40', emoji: '❌' },
};
