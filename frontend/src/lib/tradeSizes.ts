import type { Symbol, TradeSize } from '../types';

export const TRADE_SIZES: TradeSize[] = [0.5, 1, 2];

/** Symbols that use the OKX spot cash ledger */
export const LEDGER_SYMBOLS: Symbol[] = ['BTCUSD', 'BTCUSDT', 'ETHUSDT'];

export function supportsLedger(symbol: Symbol): boolean {
  return LEDGER_SYMBOLS.includes(symbol);
}

/** Base asset unit for the size dropdown */
export function getSizeUnit(symbol: Symbol): 'BTC' | 'ETH' {
  if (symbol === 'ETHUSDT') return 'ETH';
  return 'BTC';
}

/** Binance stream symbol for live price (BTCUSD maps to BTCUSDT) */
export function getMarketDataSymbol(symbol: Symbol): Symbol {
  if (symbol === 'BTCUSD') return 'BTCUSDT';
  return symbol;
}

export function formatSizeLabel(size: TradeSize, symbol: Symbol): string {
  return `${size} ${getSizeUnit(symbol)}`;
}
