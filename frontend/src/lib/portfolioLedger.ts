import type { StoredAnalysis, TradeSize } from '../types';
import { calcExposureBtc, calcSpotPnL } from './okxFees';
import { supportsLedger } from './tradeSizes';

export const LEDGER_STORAGE_KEY = 'trading-agent-ledger-v1';
export const HISTORY_STORAGE_KEY = 'trading-agent-history-v2';
export const LEGACY_HISTORY_KEY = 'trading-agent-history';

export const INITIAL_CAPITAL_BTC = 100;

export interface PortfolioLedger {
  initialCapitalBtc: number;
  balanceBtc: number;
  version: 1;
}

export function createInitialLedger(): PortfolioLedger {
  return {
    initialCapitalBtc: INITIAL_CAPITAL_BTC,
    balanceBtc: INITIAL_CAPITAL_BTC,
    version: 1,
  };
}

export function loadLedger(): PortfolioLedger {
  try {
    const raw = localStorage.getItem(LEDGER_STORAGE_KEY);
    if (!raw) return createInitialLedger();
    const parsed = JSON.parse(raw) as PortfolioLedger;
    if (parsed.version !== 1 || typeof parsed.balanceBtc !== 'number') {
      return createInitialLedger();
    }
    return parsed;
  } catch {
    return createInitialLedger();
  }
}

export function saveLedger(ledger: PortfolioLedger): void {
  localStorage.setItem(LEDGER_STORAGE_KEY, JSON.stringify(ledger));
}

/** Wipe legacy history and init fresh ledger (one-time migration) */
export function resetPortfolioStorage(): void {
  localStorage.removeItem(LEGACY_HISTORY_KEY);
  localStorage.removeItem(HISTORY_STORAGE_KEY);
  saveLedger(createInitialLedger());
}

export function openExposureBtc(
  history: StoredAnalysis[],
  btcUsdPrice: number,
): number {
  return history
    .filter((h) => h.outcome === 'pending' && h.tradeSize != null && supportsLedger(h.symbol))
    .reduce((sum, h) => {
      const size = h.tradeSize!;
      return sum + calcExposureBtc(h.symbol, size, h.levels.entry, btcUsdPrice);
    }, 0);
}

export function canOpenTrade(
  history: StoredAnalysis[],
  size: TradeSize,
  symbol: StoredAnalysis['symbol'],
  entry: number,
  balanceBtc: number,
  btcUsdPrice: number,
): { ok: true } | { ok: false; reason: string } {
  if (!supportsLedger(symbol)) {
    return { ok: false, reason: 'Ledger is only available for BTC/USD and ETH/USDT.' };
  }
  const exposure = calcExposureBtc(symbol, size, entry, btcUsdPrice);
  const open = openExposureBtc(history, btcUsdPrice);
  if (open + exposure > balanceBtc) {
    return {
      ok: false,
      reason: `Insufficient balance: need ${(open + exposure).toFixed(4)} BTC exposure, have ${balanceBtc.toFixed(4)} BTC.`,
    };
  }
  return { ok: true };
}

export function applyTradeClose(
  ledger: PortfolioLedger,
  item: StoredAnalysis,
  exitPrice: number,
  btcUsdPrice: number,
): { ledger: PortfolioLedger; ledgerFields: NonNullable<StoredAnalysis['ledger']> } {
  const size = item.tradeSize!;
  const pnl = calcSpotPnL(item.direction, size, item.levels.entry, exitPrice, btcUsdPrice);

  const balanceBtcAfter = ledger.balanceBtc + pnl.netBtc;

  return {
    ledger: { ...ledger, balanceBtc: balanceBtcAfter },
    ledgerFields: {
      entryFeeBase: pnl.fees.entryFeeBase,
      entryFeeQuote: pnl.fees.entryFeeQuote,
      exitFeeQuote: pnl.fees.exitFeeQuote,
      totalFeeQuote: pnl.fees.totalFeeQuote,
      grossPnlQuote: pnl.grossQuote,
      netPnlQuote: pnl.netQuote,
      netPnlBtc: pnl.netBtc,
      balanceBtcAfter,
      confirmedAt: item.ledger?.confirmedAt,
      closedAt: new Date().toISOString(),
    },
  };
}

export function ledgerReturnPct(ledger: PortfolioLedger): number {
  if (ledger.initialCapitalBtc <= 0) return 0;
  return ((ledger.balanceBtc - ledger.initialCapitalBtc) / ledger.initialCapitalBtc) * 100;
}
