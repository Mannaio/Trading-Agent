import { useEffect, useRef, useState } from 'react';
import type { StoredAnalysis, Outcome, CloseBy, Symbol } from '../types';
import { getMarketDataSymbol } from '../lib/tradeSizes';

const EXPIRY_MS = 24 * 60 * 60_000; // 24 hours
const EXPIRY_CHECK_INTERVAL = 60_000; // check expiry every 60 seconds
const UI_THROTTLE_MS = 1_000; // throttle price state updates to 1/sec
const RECONNECT_BASE_MS = 3_000; // initial reconnect delay
const RECONNECT_MAX_MS = 30_000; // max reconnect delay
const WS_BASE_URL = 'wss://stream.binance.com:9443/ws';
const KLINE_INTERVAL = '5m'; // 5-minute candles for catch-up (288 per 24h, within 1000 limit)

// ─── Resolution logic (unchanged) ───

/** Check if a pending prediction should be resolved */
function resolveOutcome(
  prediction: StoredAnalysis,
  currentPrice: number,
): { outcome: Outcome; price: number; closedBy?: CloseBy } | null {
  if (prediction.outcome !== 'pending') return null;
  if (prediction.direction === 'UNCLEAR') {
    return { outcome: 'expired', price: currentPrice };
  }

  const { stopLoss, takeProfit } = prediction.levels;

  if (prediction.direction === 'HIGHER') {
    if (currentPrice >= takeProfit) return { outcome: 'won', price: currentPrice, closedBy: 'tp_sl' };
    if (currentPrice <= stopLoss) return { outcome: 'lost', price: currentPrice, closedBy: 'tp_sl' };
  } else {
    if (currentPrice <= takeProfit) return { outcome: 'won', price: currentPrice, closedBy: 'tp_sl' };
    if (currentPrice >= stopLoss) return { outcome: 'lost', price: currentPrice, closedBy: 'tp_sl' };
  }

  // Check expiry: resolve to won/lost based on current price vs entry
  const age = Date.now() - new Date(prediction.timestamp).getTime();
  if (age > EXPIRY_MS) {
    const entry = prediction.levels.entry;
    const isWin = prediction.direction === 'HIGHER' ? currentPrice > entry : currentPrice < entry;
    return { outcome: isWin ? 'won' : 'lost', price: currentPrice, closedBy: 'timeout' };
  }

  return null; // still pending
}

// ─── Kline-based catch-up resolution ───

type Kline = [
  number, // openTime
  string, // open
  string, // high
  string, // low
  string, // close
  string, // volume
  number, // closeTime
  ...unknown[]
];

/** Fetch 5-minute klines from Binance for a time range (via Vite proxy) */
async function fetchKlines(
  symbol: string,
  startTime: number,
  endTime: number,
): Promise<Kline[]> {
  try {
    const url =
      `/binance/api/v3/klines?symbol=${symbol}` +
      `&interval=${KLINE_INTERVAL}&startTime=${startTime}&endTime=${endTime}&limit=1000`;
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[CatchUp] Binance klines returned ${res.status} for ${symbol}`);
      return [];
    }
    return await res.json();
  } catch (err) {
    console.warn(`[CatchUp] Failed to fetch klines for ${symbol}:`, err);
    return [];
  }
}

/**
 * Resolve a pending prediction against historical klines.
 * Iterates candles chronologically; for each candle checks SL first (conservative).
 * Returns the resolution and the approximate timestamp of the candle that triggered it.
 */
function resolveFromKlines(
  prediction: StoredAnalysis,
  klines: Kline[],
): { outcome: Outcome; price: number; timestamp: string; closedBy?: CloseBy } | null {
  if (prediction.outcome !== 'pending') return null;
  if (prediction.direction === 'UNCLEAR') return null;

  const { stopLoss, takeProfit } = prediction.levels;

  for (const kline of klines) {
    const high = parseFloat(kline[2]);
    const low = parseFloat(kline[3]);
    const closeTime = kline[6] as number;
    const candleTs = new Date(closeTime).toISOString();

    if (prediction.direction === 'HIGHER') {
      // Check SL first (conservative: if both hit in same candle, count as loss)
      if (low <= stopLoss) return { outcome: 'lost', price: stopLoss, timestamp: candleTs, closedBy: 'tp_sl' };
      if (high >= takeProfit) return { outcome: 'won', price: takeProfit, timestamp: candleTs, closedBy: 'tp_sl' };
    } else {
      if (high >= stopLoss) return { outcome: 'lost', price: stopLoss, timestamp: candleTs, closedBy: 'tp_sl' };
      if (low <= takeProfit) return { outcome: 'won', price: takeProfit, timestamp: candleTs, closedBy: 'tp_sl' };
    }
  }

  // Check if the trade has timed out: resolve to won/lost based on last close vs entry
  const age = Date.now() - new Date(prediction.timestamp).getTime();
  if (age > EXPIRY_MS && klines.length > 0) {
    const lastKline = klines[klines.length - 1];
    const lastClose = parseFloat(lastKline[4]);
    const entry = prediction.levels.entry;
    const isWin = prediction.direction === 'HIGHER' ? lastClose > entry : lastClose < entry;
    return { outcome: isWin ? 'won' : 'lost', price: lastClose, timestamp: new Date().toISOString(), closedBy: 'timeout' };
  }

  return null;
}

/**
 * On page load, check all pending predictions against historical kline data
 * to resolve any that hit TP/SL while the browser was closed.
 */
async function catchUpPendingTrades(
  currentHistory: StoredAnalysis[],
  onUpdate: (updated: StoredAnalysis[]) => void,
) {
  const pending = currentHistory.filter((h) => h.outcome === 'pending');
  if (pending.length === 0) return;

  console.log(`[CatchUp] Checking ${pending.length} pending prediction(s) against historical data...`);

  // Group pending trades by market data symbol (BTCUSD → BTCUSDT stream)
  const bySymbol = new Map<Symbol, StoredAnalysis[]>();
  for (const p of pending) {
    const marketSym = getMarketDataSymbol(p.symbol);
    const list = bySymbol.get(marketSym) ?? [];
    list.push(p);
    bySymbol.set(marketSym, list);
  }

  // Fetch klines for each symbol and resolve
  const resolutions = new Map<string, { outcome: Outcome; price: number; timestamp: string; closedBy?: CloseBy }>();

  for (const [symbol, trades] of bySymbol) {
    // Start from the earliest trade's timestamp
    const earliest = Math.min(...trades.map((t) => new Date(t.timestamp).getTime()));
    const klines = await fetchKlines(symbol, earliest, Date.now());

    if (klines.length === 0) {
      console.log(`[CatchUp] No kline data for ${symbol}, skipping`);
      continue;
    }

    console.log(`[CatchUp] Got ${klines.length} candles for ${symbol}`);

    for (const trade of trades) {
      // Only check candles after this specific trade's start time
      const tradeStart = new Date(trade.timestamp).getTime();
      const relevantKlines = klines.filter((k) => (k[6] as number) >= tradeStart);
      const result = resolveFromKlines(trade, relevantKlines);

      if (result) {
        console.log(
          `[CatchUp] ${trade.symbol} ${trade.direction} -> ${result.outcome.toUpperCase()} @ ${result.price}` +
            ` (entry=${trade.levels.entry}, sl=${trade.levels.stopLoss}, tp=${trade.levels.takeProfit})`,
        );
        resolutions.set(trade.id, result);
      }
    }
  }

  if (resolutions.size === 0) {
    console.log('[CatchUp] No resolutions found — all trades still within range');
    return;
  }

  // Apply resolutions
  const updated = currentHistory.map((item) => {
    const res = resolutions.get(item.id);
    if (res) {
      return {
        ...item,
        outcome: res.outcome,
        outcomePrice: res.price,
        outcomeTimestamp: res.timestamp,
        ...(res.closedBy !== undefined && { closedBy: res.closedBy }),
      };
    }
    return item;
  });

  onUpdate(updated);
  console.log(`[CatchUp] Resolved ${resolutions.size} trade(s)`);
}

// ─── Hook ───

interface UsePriceTrackerOptions {
  history: StoredAnalysis[];
  onUpdate: (updated: StoredAnalysis[]) => void;
}

export function usePriceTracker({ history, onUpdate }: UsePriceTrackerOptions) {
  const [prices, setPrices] = useState<Record<string, number>>({});

  // Refs for stable access inside callbacks
  const historyRef = useRef(history);
  historyRef.current = history;

  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  const pricesRef = useRef(prices);
  pricesRef.current = prices;

  // Track which symbols currently have active WebSocket connections
  const socketsRef = useRef<Map<Symbol, WebSocket>>(new Map());
  // Track reconnect attempt counts per symbol for exponential backoff
  const reconnectAttemptsRef = useRef<Map<Symbol, number>>(new Map());
  // Track reconnect timers so we can cancel on cleanup
  const reconnectTimersRef = useRef<Map<Symbol, ReturnType<typeof setTimeout>>>(new Map());
  // Throttle UI price updates (one timer per symbol)
  const throttleTimersRef = useRef<Map<Symbol, ReturnType<typeof setTimeout>>>(new Map());
  // Latest price per symbol (updated on every tick, not throttled)
  const latestPricesRef = useRef<Record<string, number>>({});
  // Prevent catch-up from running more than once
  const catchUpRanRef = useRef(false);

  // ─── Catch-up on mount: resolve trades that hit TP/SL while browser was closed ───
  useEffect(() => {
    if (catchUpRanRef.current) return;
    if (history.length === 0) return;
    const pending = history.filter((h) => h.outcome === 'pending');
    if (pending.length === 0) return;

    catchUpRanRef.current = true;
    catchUpPendingTrades(history, onUpdateRef.current);
  }, [history]);

  // ─── Resolve pending predictions for a given symbol at a given price ───
  function checkResolutions(marketSymbol: Symbol, price: number) {
    const currentHistory = historyRef.current;
    const pending = currentHistory.filter(
      (h) => h.outcome === 'pending' && getMarketDataSymbol(h.symbol) === marketSymbol,
    );

    if (pending.length === 0) return;

    let changed = false;
    const updated = currentHistory.map((item) => {
      if (item.outcome !== 'pending' || getMarketDataSymbol(item.symbol) !== marketSymbol) return item;

      const result = resolveOutcome(item, price);
      if (result) {
        changed = true;
        console.log(
          `[PriceTracker] ${item.symbol} ${item.direction} -> ${result.outcome.toUpperCase()} @ ${result.price}` +
            ` (entry=${item.levels.entry}, sl=${item.levels.stopLoss}, tp=${item.levels.takeProfit})`,
        );
        return {
          ...item,
          outcome: result.outcome,
          outcomePrice: result.price,
          outcomeTimestamp: new Date().toISOString(),
          ...(result.closedBy !== undefined && { closedBy: result.closedBy }),
        };
      }
      return item;
    });

    if (changed) {
      onUpdateRef.current(updated);
    }
  }

  // ─── Throttled UI price update ───
  function scheduleUiUpdate(symbol: Symbol, price: number) {
    latestPricesRef.current[symbol] = price;

    // If a throttle timer already exists for this symbol, skip
    if (throttleTimersRef.current.has(symbol)) return;

    throttleTimersRef.current.set(
      symbol,
      setTimeout(() => {
        throttleTimersRef.current.delete(symbol);
        const latest = latestPricesRef.current[symbol];
        if (latest !== undefined) {
          setPrices((prev) => ({ ...prev, [symbol]: latest }));
        }
      }, UI_THROTTLE_MS),
    );
  }

  // ─── Open a WebSocket for a symbol ───
  function openSocket(symbol: Symbol) {
    // Don't open a duplicate
    if (socketsRef.current.has(symbol)) return;

    const streamName = symbol.toLowerCase();
    const url = `${WS_BASE_URL}/${streamName}@trade`;
    console.log(`[PriceTracker] Opening WebSocket for ${symbol}`);

    const ws = new WebSocket(url);
    socketsRef.current.set(symbol, ws);

    ws.onopen = () => {
      console.log(`[PriceTracker] WebSocket connected: ${symbol}`);
      // Reset reconnect attempts on successful connection
      reconnectAttemptsRef.current.set(symbol, 0);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const price = parseFloat(data.p);
        if (isNaN(price)) return;

        // 1. Check resolutions on every tick (never miss a wick)
        checkResolutions(symbol, price);

        // 2. Throttled UI update
        scheduleUiUpdate(symbol, price);
      } catch {
        // Malformed message — ignore
      }
    };

    ws.onerror = (err) => {
      console.warn(`[PriceTracker] WebSocket error for ${symbol}:`, err);
    };

    ws.onclose = () => {
      console.log(`[PriceTracker] WebSocket closed: ${symbol}`);
      socketsRef.current.delete(symbol);

      // Check if we still need this symbol before reconnecting
      const pending = historyRef.current.filter(
        (h) => h.outcome === 'pending' && getMarketDataSymbol(h.symbol) === symbol,
      );
      if (pending.length === 0) {
        console.log(`[PriceTracker] No pending trades for ${symbol}, not reconnecting`);
        return;
      }

      // Exponential backoff reconnect
      const attempts = reconnectAttemptsRef.current.get(symbol) ?? 0;
      const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, attempts), RECONNECT_MAX_MS);
      console.log(`[PriceTracker] Reconnecting ${symbol} in ${delay}ms (attempt ${attempts + 1})`);
      reconnectAttemptsRef.current.set(symbol, attempts + 1);

      const timer = setTimeout(() => {
        reconnectTimersRef.current.delete(symbol);
        openSocket(symbol);
      }, delay);
      reconnectTimersRef.current.set(symbol, timer);
    };
  }

  // ─── Close a WebSocket for a symbol ───
  function closeSocket(symbol: Symbol) {
    const ws = socketsRef.current.get(symbol);
    if (ws) {
      console.log(`[PriceTracker] Closing WebSocket for ${symbol}`);
      ws.onclose = null; // prevent reconnect on intentional close
      ws.close();
      socketsRef.current.delete(symbol);
    }
    // Cancel any pending reconnect
    const timer = reconnectTimersRef.current.get(symbol);
    if (timer) {
      clearTimeout(timer);
      reconnectTimersRef.current.delete(symbol);
    }
    reconnectAttemptsRef.current.delete(symbol);
  }

  // ─── Sync WebSocket connections with pending predictions ───
  useEffect(() => {
    const pending = history.filter((h) => h.outcome === 'pending');
    const neededMarketSymbols = new Set(
      pending.map((p) => getMarketDataSymbol(p.symbol)),
    );
    const activeSymbols = new Set(socketsRef.current.keys());

    // Also include symbols with pending reconnect timers
    for (const sym of reconnectTimersRef.current.keys()) {
      activeSymbols.add(sym);
    }

    // Open sockets for new symbols
    for (const sym of neededMarketSymbols) {
      if (!socketsRef.current.has(sym) && !reconnectTimersRef.current.has(sym)) {
        openSocket(sym);
      }
    }

    for (const sym of activeSymbols) {
      if (!neededMarketSymbols.has(sym)) {
        closeSocket(sym);
      }
    }
  }, [history]);

  // ─── Expiry check interval (lightweight, every 60 seconds) ───
  useEffect(() => {
    const interval = setInterval(() => {
      const currentHistory = historyRef.current;
      const pending = currentHistory.filter((h) => h.outcome === 'pending');

      if (pending.length === 0) return;

      let changed = false;
      const updated = currentHistory.map((item) => {
        if (item.outcome !== 'pending') return item;
        const age = Date.now() - new Date(item.timestamp).getTime();
        if (age > EXPIRY_MS) {
          const lastPrice = latestPricesRef.current[getMarketDataSymbol(item.symbol)];
          // No real price available yet — leave pending, let the next WS tick or kline catch-up resolve it
          if (!lastPrice) return item;
          changed = true;
          const entry = item.levels.entry;
          const isWin = item.direction === 'HIGHER' ? lastPrice > entry : lastPrice < entry;
          const outcome = isWin ? 'won' : 'lost';
          console.log(`[PriceTracker] ${item.symbol} timed out after 24h @ ${lastPrice} -> ${outcome.toUpperCase()}`);
          return {
            ...item,
            outcome: (isWin ? 'won' : 'lost') as 'won' | 'lost',
            outcomePrice: lastPrice,
            outcomeTimestamp: new Date().toISOString(),
            closedBy: 'timeout' as const,
          };
        }
        return item;
      });

      if (changed) {
        onUpdateRef.current(updated);
      }
    }, EXPIRY_CHECK_INTERVAL);

    return () => clearInterval(interval);
  }, []);

  // ─── Cleanup all sockets on unmount ───
  useEffect(() => {
    return () => {
      for (const sym of [...socketsRef.current.keys()]) {
        closeSocket(sym);
      }
      for (const timer of throttleTimersRef.current.values()) {
        clearTimeout(timer);
      }
      throttleTimersRef.current.clear();
    };
  }, []);

  return { prices };
}
