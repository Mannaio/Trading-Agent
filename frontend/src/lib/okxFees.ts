import type { Direction, Symbol } from '../types';
import { getSizeUnit } from './tradeSizes';

/** OKX EEA spot fees (derivatives account opened, Group 1 standard pairs) */
export const OKX_TAKER_RATE = 0.001; // 0.10% — market entry
export const OKX_MAKER_RATE = 0.0008; // 0.08% — limit exit

export interface SpotFeeBreakdown {
  entryFeeBase: number;
  entryFeeQuote: number;
  exitFeeQuote: number;
  totalFeeQuote: number;
}

export interface SpotPnLResult {
  grossQuote: number;
  fees: SpotFeeBreakdown;
  netQuote: number;
  netBtc: number;
}

function entryFeeQuote(size: number, entry: number): number {
  return size * entry * OKX_TAKER_RATE;
}

function exitFeeQuote(size: number, exit: number): number {
  return size * exit * OKX_MAKER_RATE;
}

/** Estimate fees at entry (exit unknown — use entry as proxy for exit fee estimate) */
export function estimateEntryFees(size: number, entry: number): SpotFeeBreakdown {
  const entryFeeBase = size * OKX_TAKER_RATE;
  const entryFeeQ = entryFeeQuote(size, entry);
  const exitFeeQ = exitFeeQuote(size, entry);
  return {
    entryFeeBase: entryFeeBase,
    entryFeeQuote: entryFeeQ,
    exitFeeQuote: exitFeeQ,
    totalFeeQuote: entryFeeQ + exitFeeQ,
  };
}

/** Full spot P&L for a closed trade (market entry, limit exit) */
export function calcSpotPnL(
  direction: Direction,
  size: number,
  entry: number,
  exit: number,
  btcUsdPrice: number,
): SpotPnLResult {
  const entryFeeBase = size * OKX_TAKER_RATE;
  const entryFeeQ = entryFeeQuote(size, entry);
  const exitFeeQ = exitFeeQuote(size, exit);

  const gross =
    direction === 'HIGHER' ? size * (exit - entry) : size * (entry - exit);

  const netQuote = gross - entryFeeQ - exitFeeQ;
  const netBtc = btcUsdPrice > 0 ? netQuote / btcUsdPrice : 0;

  return {
    grossQuote: gross,
    fees: {
      entryFeeBase,
      entryFeeQuote: entryFeeQ,
      exitFeeQuote: exitFeeQ,
      totalFeeQuote: entryFeeQ + exitFeeQ,
    },
    netQuote,
    netBtc,
  };
}

/** Exposure of an open position in BTC terms (for cash spot limits) */
export function calcExposureBtc(
  symbol: Symbol,
  size: number,
  entry: number,
  btcUsdPrice: number,
): number {
  if (btcUsdPrice <= 0) return size;
  const unit = getSizeUnit(symbol);
  if (unit === 'BTC') return size;
  return (size * entry) / btcUsdPrice;
}

export function formatFeeDisplay(
  fees: SpotFeeBreakdown,
  symbol: Symbol,
): string {
  const unit = getSizeUnit(symbol);
  const basePart = `${fees.entryFeeBase.toFixed(6)} ${unit}`;
  const quotePart =
    symbol === 'ETHUSDT'
      ? `$${fees.totalFeeQuote.toFixed(2)}`
      : `$${fees.totalFeeQuote.toFixed(2)}`;
  return `${basePart} + ${quotePart}`;
}
