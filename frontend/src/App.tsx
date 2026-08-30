import { useState, useEffect, useCallback, useRef } from 'react';
import { AnalysisForm } from './components/scalp/AnalysisForm';
import { AnalysisResult } from './components/scalp/AnalysisResult';
import { HistoryList } from './components/HistoryList';
import { StatsPanel } from './components/StatsPanel';
import { PolymarketForm } from './components/polymarket/PolymarketForm';
import { PolymarketResult } from './components/polymarket/PolymarketResult';
import { PolymarketHistoryList } from './components/polymarket/PolymarketHistoryList';
import { usePriceTracker } from './hooks/usePriceTracker';
import { estimateEntryFees } from './lib/okxFees';
import {
  HISTORY_STORAGE_KEY,
  loadLedger,
  saveLedger,
  resetPortfolioStorage,
  canOpenTrade,
  applyTradeClose,
  type PortfolioLedger,
} from './lib/portfolioLedger';
import { getMarketDataSymbol, supportsLedger } from './lib/tradeSizes';
import type { AnalysisRequest, AnalysisResponse, StoredAnalysis, Direction, PortfolioContext, TradeSize } from './types';
import type {
  PolymarketRequest,
  PolymarketResponse,
  StoredPolymarketAnalysis,
  PolymarketOutcome,
} from './types-polymarket';

type AppMode = 'scalp' | 'polymarket';

const POLYMARKET_STORAGE_KEY = 'trading-agent-polymarket-history';
const MAX_HISTORY = 50;

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function loadHistory(): StoredAnalysis[] {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed: StoredAnalysis[] = JSON.parse(raw);
    return parsed.map((item) => ({
      ...item,
      outcome: item.outcome ?? 'expired',
    }));
  } catch {
    return [];
  }
}

function saveHistory(list: StoredAnalysis[]): void {
  localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(list.slice(0, MAX_HISTORY)));
}

function initScalpStorage(): { history: StoredAnalysis[]; ledger: PortfolioLedger } {
  const hasV2 = localStorage.getItem(HISTORY_STORAGE_KEY) !== null;
  if (!hasV2) {
    resetPortfolioStorage();
    return { history: [], ledger: loadLedger() };
  }
  return { history: loadHistory(), ledger: loadLedger() };
}

function getBtcUsdPrice(prices: Record<string, number>, fallback = 95000): number {
  return prices.BTCUSDT ?? prices.BTCUSD ?? fallback;
}

function finalizeClosures(
  prev: StoredAnalysis[],
  next: StoredAnalysis[],
  ledger: PortfolioLedger,
  btcUsdPrice: number,
): { history: StoredAnalysis[]; ledger: PortfolioLedger } {
  let updatedLedger = ledger;
  const history = next.map((item) => {
    const old = prev.find((p) => p.id === item.id);
    const justClosed =
      old?.outcome === 'pending' &&
      (item.outcome === 'won' || item.outcome === 'lost') &&
      item.tradeSize != null &&
      supportsLedger(item.symbol) &&
      item.outcomePrice != null &&
      !old.ledger?.closedAt;

    if (!justClosed) return item;

    const { ledger: nextLedger, ledgerFields } = applyTradeClose(
      updatedLedger,
      item,
      item.outcomePrice!,
      btcUsdPrice,
    );
    updatedLedger = nextLedger;
    return { ...item, ledger: ledgerFields };
  });

  return { history, ledger: updatedLedger };
}

function loadPolymarketHistory(): StoredPolymarketAnalysis[] {
  try {
    const raw = localStorage.getItem(POLYMARKET_STORAGE_KEY);
    if (!raw) return [];
    const parsed: StoredPolymarketAnalysis[] = JSON.parse(raw);
    return parsed.map((item) => ({
      ...item,
      outcome: item.outcome ?? 'review',
    }));
  } catch {
    return [];
  }
}

function savePolymarketHistory(list: StoredPolymarketAnalysis[]): void {
  localStorage.setItem(POLYMARKET_STORAGE_KEY, JSON.stringify(list.slice(0, MAX_HISTORY)));
}

export default function App() {
  const [mode, setMode] = useState<AppMode>('scalp');
  const [history, setHistory] = useState<StoredAnalysis[]>([]);
  const [ledger, setLedger] = useState<PortfolioLedger>(() => loadLedger());
  const [selected, setSelected] = useState<StoredAnalysis | null>(null);
  const [polymarketHistory, setPolymarketHistory] = useState<StoredPolymarketAnalysis[]>([]);
  const [selectedPolymarket, setSelectedPolymarket] = useState<StoredPolymarketAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [polymarketLoading, setPolymarketLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [portfolioSizeUsd, setPortfolioSizeUsd] = useState<number>(() => {
    const saved = localStorage.getItem('portfolio-size');
    return saved ? Number(saved) : 0;
  });
  const [maxRiskPercent, setMaxRiskPercent] = useState<number>(() => {
    const saved = localStorage.getItem('portfolio-risk');
    return saved ? Number(saved) : 2;
  });

  const historyRef = useRef(history);
  historyRef.current = history;
  const ledgerRef = useRef(ledger);
  ledgerRef.current = ledger;
  const pricesRef = useRef<Record<string, number>>({});

  useEffect(() => {
    const { history: h, ledger: l } = initScalpStorage();
    setHistory(h);
    setLedger(l);
    if (h.length > 0) setSelected(h[0]);

    const pm = loadPolymarketHistory();
    setPolymarketHistory(pm);
    if (pm.length > 0) setSelectedPolymarket(pm[0]);
  }, []);

  useEffect(() => {
    if (portfolioSizeUsd > 0) localStorage.setItem('portfolio-size', String(portfolioSizeUsd));
  }, [portfolioSizeUsd]);

  useEffect(() => {
    localStorage.setItem('portfolio-risk', String(maxRiskPercent));
  }, [maxRiskPercent]);

  const applyHistoryUpdate = useCallback((updated: StoredAnalysis[]) => {
    const btcUsd = getBtcUsdPrice(pricesRef.current);
    const { history: finalized, ledger: nextLedger } = finalizeClosures(
      historyRef.current,
      updated,
      ledgerRef.current,
      btcUsd,
    );
    setHistory(finalized);
    saveHistory(finalized);
    if (nextLedger.balanceBtc !== ledgerRef.current.balanceBtc) {
      setLedger(nextLedger);
      saveLedger(nextLedger);
    }
    setSelected((prev) => {
      if (!prev) return prev;
      const refreshed = finalized.find((h) => h.id === prev.id);
      return refreshed ?? prev;
    });
  }, []);

  const { prices } = usePriceTracker({
    history,
    onUpdate: applyHistoryUpdate,
  });

  pricesRef.current = prices;

  const handleSaveFeedback = useCallback(
    (id: string, feedback: string) => {
      const next = history.map((item) =>
        item.id === id ? { ...item, feedback } : item,
      );
      setHistory(next);
      saveHistory(next);
      setSelected((prev) =>
        prev?.id === id ? { ...prev, feedback } : prev,
      );
    },
    [history],
  );

  const handleConfirmTrade = useCallback(
    (
      id: string,
      levels: { entry: number; stopLoss: number; takeProfit: number },
      direction: Direction,
      tradeSize: TradeSize,
    ) => {
      const item = history.find((h) => h.id === id);
      if (!item) return;

      if (!supportsLedger(item.symbol)) {
        setError('OKX spot ledger supports BTC/USD and ETH/USDT only.');
        return;
      }

      const btcUsd = getBtcUsdPrice(pricesRef.current, levels.entry);
      const check = canOpenTrade(history, tradeSize, item.symbol, levels.entry, ledger.balanceBtc, btcUsd);
      if (!check.ok) {
        setError(check.reason);
        return;
      }

      const fees = estimateEntryFees(tradeSize, levels.entry);
      const confirmedAt = new Date().toISOString();

      const next = history.map((h) =>
        h.id === id
          ? {
              ...h,
              outcome: 'pending' as const,
              levels,
              direction,
              tradeSize,
              ledger: {
                entryFeeBase: fees.entryFeeBase,
                entryFeeQuote: fees.entryFeeQuote,
                confirmedAt,
              },
            }
          : h,
      );
      setHistory(next);
      saveHistory(next);
      setSelected((prev) =>
        prev?.id === id
          ? {
              ...prev,
              outcome: 'pending' as const,
              levels,
              direction,
              tradeSize,
              ledger: {
                entryFeeBase: fees.entryFeeBase,
                entryFeeQuote: fees.entryFeeQuote,
                confirmedAt,
              },
            }
          : prev,
      );
      setError(null);
    },
    [history, ledger.balanceBtc],
  );

  const handleCancelTrade = useCallback(
    (id: string, exitPrice: number) => {
      const prev = historyRef.current;
      const next = prev.map((item) => {
        if (item.id !== id) return item;
        const isWin = item.direction === 'HIGHER' ? exitPrice > item.levels.entry : exitPrice < item.levels.entry;
        return {
          ...item,
          outcome: (isWin ? 'won' : 'lost') as 'won' | 'lost',
          outcomePrice: exitPrice,
          outcomeTimestamp: new Date().toISOString(),
          closedBy: 'manual' as const,
        };
      });
      applyHistoryUpdate(next);
    },
    [applyHistoryUpdate],
  );

  const handleRefuseTrade = useCallback(
    (id: string) => {
      const next = history.map((item) =>
        item.id === id ? { ...item, outcome: 'expired' as const } : item,
      );
      setHistory(next);
      saveHistory(next);
      setSelected((prev) =>
        prev?.id === id ? { ...prev, outcome: 'expired' as const } : prev,
      );
    },
    [history],
  );

  function computePortfolioContext(): PortfolioContext | undefined {
    if (!portfolioSizeUsd || portfolioSizeUsd <= 0) return undefined;

    const completed = history.filter((h) => h.outcome === 'won' || h.outcome === 'lost');
    const won = completed.filter((h) => h.outcome === 'won').length;
    const winRate = completed.length > 0 ? won / completed.length : 0;

    const bandWinRate = (low: number, high: number): number | null => {
      const inBand = completed.filter((h) => h.probability >= low && h.probability < high);
      if (inBand.length < 3) return null;
      return inBand.filter((h) => h.outcome === 'won').length / inBand.length;
    };

    const recent = history
      .filter((h) => h.outcome === 'won' || h.outcome === 'lost')
      .slice(0, 5);
    const recentWins = recent.filter((h) => h.outcome === 'won').length;
    const recentLosses = recent.filter((h) => h.outcome === 'lost').length;
    let recentStreak = 'mixed';
    if (recent.length >= 2) {
      if (recentLosses >= 3) recentStreak = `${recentLosses} losses`;
      else if (recentWins >= 3) recentStreak = `${recentWins} wins`;
    }

    return {
      portfolioSizeUsd,
      maxRiskPerTradePercent: maxRiskPercent,
      totalTrades: completed.length,
      winRate,
      winRateByProbabilityBand: {
        '55-65': bandWinRate(55, 65),
        '65-75': bandWinRate(65, 75),
        '75+': bandWinRate(75, 101),
      },
      recentStreak,
    };
  }

  function collectLessons(): string[] {
    return history
      .filter((h) => h.outcome === 'lost' && h.feedback)
      .slice(0, 10)
      .map((h) => {
        const sym = h.symbol.replace('USDT', '/USDT');
        const dir = h.direction;
        const date = new Date(h.timestamp).toLocaleDateString();
        return `${sym} ${dir} (${date}): "${h.feedback}"`;
      });
  }

  const handleAnalyze = useCallback(
    async (req: AnalysisRequest) => {
      setLoading(true);
      setError(null);

      const lessons = collectLessons();
      const enrichedReq = lessons.length > 0 ? { ...req, pastLessons: lessons } : req;

      const portfolioContext = computePortfolioContext();
      const finalReq = portfolioContext ? { ...enrichedReq, portfolioContext } : enrichedReq;

      try {
        const res = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(finalReq),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(
            (data as { error?: string }).error || `Request failed (${res.status})`
          );
        }

        const data: AnalysisResponse = await res.json();

        const stored: StoredAnalysis = {
          ...data,
          id: uid(),
          symbol: req.symbol,
          userReasoning: req.userReasoning,
          screenshotCount: req.screenshots.length,
          outcome: data.direction === 'UNCLEAR' ? 'expired' : 'review',
        };

        const next = [stored, ...history].slice(0, MAX_HISTORY);
        setHistory(next);
        saveHistory(next);
        setSelected(stored);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unexpected error');
      } finally {
        setLoading(false);
      }
    },
    [history],
  );

  const handlePolymarketAnalyze = useCallback(
    async (req: PolymarketRequest) => {
      setPolymarketLoading(true);
      setError(null);

      try {
        const res = await fetch('/api/polymarket/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(req),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(
            (data as { error?: string }).error || `Request failed (${res.status})`
          );
        }

        const data: PolymarketResponse = await res.json();

        const stored: StoredPolymarketAnalysis = {
          ...data,
          id: uid(),
          symbol: req.symbol,
          notes: req.notes,
          marketPrices: req.marketPrices,
          outcome: 'review',
        };

        const next = [stored, ...polymarketHistory].slice(0, MAX_HISTORY);
        setPolymarketHistory(next);
        savePolymarketHistory(next);
        setSelectedPolymarket(stored);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unexpected error');
      } finally {
        setPolymarketLoading(false);
      }
    },
    [polymarketHistory],
  );

  const handlePolymarketOutcome = useCallback(
    (id: string, outcome: PolymarketOutcome) => {
      const next = polymarketHistory.map((item) =>
        item.id === id
          ? { ...item, outcome, outcomeTimestamp: new Date().toISOString() }
          : item,
      );
      setPolymarketHistory(next);
      savePolymarketHistory(next);
      setSelectedPolymarket((prev) =>
        prev?.id === id
          ? { ...prev, outcome, outcomeTimestamp: new Date().toISOString() }
          : prev,
      );
    },
    [polymarketHistory],
  );

  const selectedLivePrice = selected
    ? prices[getMarketDataSymbol(selected.symbol)] ?? null
    : null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-900 to-gray-800 flex flex-col">
      <header className="border-b border-gray-800 bg-gray-900/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🤖</span>
            <div>
              <h1 className="text-xl font-bold text-white leading-tight">Trading Agent</h1>
              <p className="text-xs text-gray-500">Scalp prediction &middot; OKX spot ledger</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMode('scalp')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                mode === 'scalp' ? 'active bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'
              }`}
            >
              Scalp
            </button>
            <button
              type="button"
              onClick={() => setMode('polymarket')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                mode === 'polymarket' ? 'active bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'
              }`}
            >
              Polymarket
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8 flex-1">
        {error && (
          <div className="mb-6 p-4 bg-red-900/50 border border-red-700 rounded-lg flex items-center gap-3">
            <span className="text-red-400 shrink-0">⚠️</span>
            <p className="text-red-200 flex-1 text-sm">{error}</p>
            <button
              onClick={() => setError(null)}
              className="text-red-400 hover:text-red-300 transition-colors"
            >
              ✕
            </button>
          </div>
        )}

        {mode === 'scalp' ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            <div className="lg:col-span-5">
              <div className="bg-gray-800/50 rounded-lg p-6 border border-gray-700 lg:sticky lg:top-24">
                <AnalysisForm
                  onSubmit={handleAnalyze}
                  isLoading={loading}
                  portfolioSizeUsd={portfolioSizeUsd}
                  maxRiskPercent={maxRiskPercent}
                  onPortfolioSizeChange={setPortfolioSizeUsd}
                  onMaxRiskPercentChange={setMaxRiskPercent}
                />
              </div>
            </div>

            <div className="lg:col-span-7 space-y-6">
              <AnalysisResult
                analysis={selected}
                livePrice={selectedLivePrice}
                ledger={ledger}
                btcUsdPrice={getBtcUsdPrice(prices)}
                onSaveFeedback={handleSaveFeedback}
                onConfirmTrade={handleConfirmTrade}
                onRefuseTrade={handleRefuseTrade}
                onCancelTrade={handleCancelTrade}
              />
              <StatsPanel history={history} ledger={ledger} />
              <HistoryList
                history={history}
                ledger={ledger}
                onSelect={setSelected}
                selectedId={selected?.id ?? null}
              />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            <div className="lg:col-span-5">
              <div className="bg-gray-800/50 rounded-lg p-6 border border-gray-700 lg:sticky lg:top-24">
                <PolymarketForm onSubmit={handlePolymarketAnalyze} isLoading={polymarketLoading} />
              </div>
            </div>

            <div className="lg:col-span-7 space-y-6">
              <PolymarketResult
                analysis={selectedPolymarket}
                onOutcome={handlePolymarketOutcome}
              />
              <PolymarketHistoryList
                history={polymarketHistory}
                onSelect={setSelectedPolymarket}
                selectedId={selectedPolymarket?.id ?? null}
              />
            </div>
          </div>
        )}
      </main>

      <footer className="border-t border-gray-800">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <p className="text-center text-gray-500 text-xs">
            Scalp trading analysis tool &middot; Not financial advice &middot; Use at your own risk
          </p>
        </div>
      </footer>
    </div>
  );
}
