import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import { AnalysisForm } from './components/AnalysisForm';
import { usePriceTracker } from './hooks/usePriceTracker';
import type { AnalysisRequest, AnalysisResponse, StoredAnalysis, Direction } from './types';

const AnalysisResult = lazy(() => import('./components/AnalysisResult').then(m => ({ default: m.AnalysisResult })));
const HistoryList = lazy(() => import('./components/HistoryList').then(m => ({ default: m.HistoryList })));
const StatsPanel = lazy(() => import('./components/StatsPanel').then(m => ({ default: m.StatsPanel })));

function LoadingFallback() {
  return (
    <div className="bg-gray-800/50 rounded-lg p-6 border border-gray-700 animate-pulse">
      <div className="h-6 bg-gray-700 rounded w-1/3 mb-4" />
      <div className="space-y-3">
        <div className="h-4 bg-gray-700 rounded w-full" />
        <div className="h-4 bg-gray-700 rounded w-5/6" />
        <div className="h-4 bg-gray-700 rounded w-4/6" />
      </div>
    </div>
  );
}

const STORAGE_KEY = 'trading-agent-history';
const MAX_HISTORY = 50;

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function loadHistory(): StoredAnalysis[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: StoredAnalysis[] = JSON.parse(raw);
    // Migrate old entries that don't have outcome
    return parsed.map((item) => ({
      ...item,
      outcome: item.outcome ?? 'expired', // old entries without tracking → expired
    }));
  } catch {
    return [];
  }
}

function saveHistory(list: StoredAnalysis[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_HISTORY)));
}

export default function App() {
  const [history, setHistory] = useState<StoredAnalysis[]>([]);
  const [selected, setSelected] = useState<StoredAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const h = loadHistory();
    setHistory(h);
    if (h.length > 0) setSelected(h[0]);
  }, []);

  // Price tracker — auto-resolves pending predictions
  const handleTrackerUpdate = useCallback((updated: StoredAnalysis[]) => {
    setHistory(updated);
    saveHistory(updated);
    // If the selected item was updated, refresh it
    setSelected((prev) => {
      if (!prev) return prev;
      const refreshed = updated.find((h) => h.id === prev.id);
      return refreshed ?? prev;
    });
  }, []);

  const { prices } = usePriceTracker({
    history,
    onUpdate: handleTrackerUpdate,
  });

  const selectedLivePrice = useMemo(() => {
    if (!selected) return null;
    return prices[selected.symbol] ?? null;
  }, [selected, prices]);

  // Save feedback for a lost trade
  const handleSaveFeedback = useCallback(
    (id: string, feedback: string) => {
      const next = history.map((item) =>
        item.id === id ? { ...item, feedback } : item,
      );
      setHistory(next);
      saveHistory(next);
      // Also refresh selected if it's the one being updated
      setSelected((prev) =>
        prev?.id === id ? { ...prev, feedback } : prev,
      );
    },
    [history],
  );

  // Confirm a trade — start tracking with (possibly adjusted) levels, direction, and optional amount
  const handleConfirmTrade = useCallback(
    (id: string, levels: { entry: number; stopLoss: number; takeProfit: number }, direction: Direction, tradeAmount?: number) => {
      const next = history.map((item) =>
        item.id === id
          ? { ...item, outcome: 'pending' as const, levels, direction, tradeAmount }
          : item,
      );
      setHistory(next);
      saveHistory(next);
      setSelected((prev) =>
        prev?.id === id ? { ...prev, outcome: 'pending' as const, levels, direction, tradeAmount } : prev,
      );
    },
    [history],
  );

  // Cancel a live trade — snapshot exit price, mark as cancelled
  const handleCancelTrade = useCallback(
    (id: string, exitPrice: number) => {
      const next = history.map((item) =>
        item.id === id
          ? {
              ...item,
              outcome: 'cancelled' as const,
              outcomePrice: exitPrice,
              outcomeTimestamp: new Date().toISOString(),
            }
          : item,
      );
      setHistory(next);
      saveHistory(next);
      setSelected((prev) =>
        prev?.id === id
          ? {
              ...prev,
              outcome: 'cancelled' as const,
              outcomePrice: exitPrice,
              outcomeTimestamp: new Date().toISOString(),
            }
          : prev,
      );
    },
    [history],
  );

  // Refuse a trade — mark as expired, never tracked
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

  const lessons = useMemo(() => {
    return history
      .filter((h) => h.outcome === 'lost' && h.feedback)
      .slice(0, 10)
      .map((h) => {
        const sym = h.symbol.replace('USDT', '/USDT');
        const dir = h.direction;
        const date = new Date(h.timestamp).toLocaleDateString();
        return `${sym} ${dir} (${date}): "${h.feedback}"`;
      });
  }, [history]);

  const handleAnalyze = useCallback(
    async (req: AnalysisRequest) => {
      setLoading(true);
      setError(null);

      const enrichedReq = lessons.length > 0 ? { ...req, pastLessons: lessons } : req;

      try {
        const res = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(enrichedReq),
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
    [history, lessons],
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-900 to-gray-800 flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-900/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center gap-3">
          <span className="text-2xl">🤖</span>
          <div>
            <h1 className="text-xl font-bold text-white leading-tight">Trading Agent</h1>
            <p className="text-xs text-gray-500">Scalp prediction &middot; 0.5% target</p>
          </div>
        </div>
      </header>

      {/* Main */}
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

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Left — Form */}
          <div className="lg:col-span-5">
            <div className="bg-gray-800/50 rounded-lg p-6 border border-gray-700 lg:sticky lg:top-24">
              <AnalysisForm onSubmit={handleAnalyze} isLoading={loading} />
            </div>
          </div>

          {/* Right — Results, Stats & History */}
          <div className="lg:col-span-7 space-y-6">
            <Suspense fallback={<LoadingFallback />}>
              <AnalysisResult
                analysis={selected}
                livePrice={selectedLivePrice}
                onSaveFeedback={handleSaveFeedback}
                onConfirmTrade={handleConfirmTrade}
                onRefuseTrade={handleRefuseTrade}
                onCancelTrade={handleCancelTrade}
              />
            </Suspense>
            <Suspense fallback={<LoadingFallback />}>
              <StatsPanel history={history} />
            </Suspense>
            <Suspense fallback={<LoadingFallback />}>
              <HistoryList
                history={history}
                onSelect={setSelected}
                selectedId={selected?.id ?? null}
              />
            </Suspense>
          </div>
        </div>
      </main>

      {/* Footer */}
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
