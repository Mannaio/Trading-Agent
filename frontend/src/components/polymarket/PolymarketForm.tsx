import { useState, useCallback } from 'react';
import type {
  PolymarketMarketWindow,
  PolymarketMarketPrices,
  PolymarketRequest,
  PolymarketSymbol,
} from '../../types-polymarket';
import { POLYMARKET_SYMBOL_OPTIONS } from '../../types-polymarket';

interface ScreenshotEntry {
  dataUrl: string;
  rsi?: number;
  rsiCrop?: string;
  droCrop?: string;
  droDominanceCrop?: string;
}

interface PolymarketFormProps {
  onSubmit: (request: PolymarketRequest) => void;
  isLoading: boolean;
}

const MARKET_WINDOW_OPTIONS: { value: PolymarketMarketWindow; label: string }[] = [
  { value: '5m', label: '5 minute market' },
  { value: '15m', label: '15 minute market' },
];

export function PolymarketForm({ onSubmit, isLoading }: PolymarketFormProps) {
  const [symbol, setSymbol] = useState<PolymarketSymbol>('ETHUSDT');
  const [marketWindow, setMarketWindow] = useState<PolymarketMarketWindow>('5m');
  const [entry, setEntry] = useState<ScreenshotEntry | null>(null);
  const [upCents, setUpCents] = useState('');
  const [downCents, setDownCents] = useState('');
  const [notes, setNotes] = useState('');
  const [capturing, setCapturing] = useState(false);

  const handleCapture = useCallback(async () => {
    setCapturing(true);
    try {
      const res = await fetch(`/capture/polymarket?symbol=${symbol}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `Capture failed (${res.status})`);
      }
      const data: {
        screenshot: string;
        rsi?: number | null;
        rsiCrop?: string | null;
        droCrop?: string | null;
        droDominanceCrop?: string | null;
      } = await res.json();
      if (!data.screenshot) {
        throw new Error('No screenshot returned');
      }
      setEntry({
        dataUrl: data.screenshot,
        ...(data.rsi != null && { rsi: data.rsi }),
        ...(data.rsiCrop != null && { rsiCrop: data.rsiCrop }),
        ...(data.droCrop != null && { droCrop: data.droCrop }),
        ...(data.droDominanceCrop != null && { droDominanceCrop: data.droDominanceCrop }),
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to capture chart');
    } finally {
      setCapturing(false);
    }
  }, [symbol]);

  const handleSymbolChange = (next: PolymarketSymbol) => {
    setSymbol(next);
    setEntry(null);
  };

  const parseCents = (value: string): number | null => {
    if (value.trim() === '') return null;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 99) return null;
    return n;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!entry) return;

    const parsedUp = parseCents(upCents);
    const parsedDown = parseCents(downCents);
    let marketPrices: PolymarketMarketPrices | undefined;
    if (parsedUp != null && parsedDown != null) {
      marketPrices = { upCents: parsedUp, downCents: parsedDown };
    }

    onSubmit({
      symbol,
      screenshot: entry.dataUrl,
      screenshotsMeta: {
        rsi: entry.rsi,
        rsiCrop: entry.rsiCrop,
        droCrop: entry.droCrop,
        droDominanceCrop: entry.droDominanceCrop,
      },
      marketWindow,
      marketPrices,
      notes: notes.trim() || undefined,
    });
  };

  const canSubmit = !isLoading && entry != null;

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1.5">Symbol</label>
        <select
          value={symbol}
          onChange={(e) => handleSymbolChange(e.target.value as PolymarketSymbol)}
          className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
        >
          {POLYMARKET_SYMBOL_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1.5">Market window</label>
        <select
          value={marketWindow}
          onChange={(e) => setMarketWindow(e.target.value as PolymarketMarketWindow)}
          className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
        >
          {MARKET_WINDOW_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1.5">
          5m Chart Screenshot
        </label>
        <button
          type="button"
          onClick={handleCapture}
          disabled={capturing}
          className="mb-3 inline-flex items-center gap-2 px-4 py-2 bg-gray-800 border border-gray-600 hover:bg-gray-700 disabled:bg-gray-800/50 disabled:border-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed rounded-lg text-sm text-gray-100 transition-colors"
        >
          {capturing ? (
            <>
              <svg
                className="animate-spin h-4 w-4"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              Capturing 5m chart...
            </>
          ) : (
            <>
              <span>📷</span>
              Capture from TradingView
            </>
          )}
        </button>

        {entry ? (
          <div className="bg-gray-800/60 rounded-lg border border-gray-700 overflow-hidden">
            <div className="relative group">
              <img
                src={entry.dataUrl}
                alt="5m chart screenshot"
                className="w-full h-40 object-cover object-top"
              />
              <button
                type="button"
                onClick={() => setEntry(null)}
                className="absolute top-2 right-2 bg-red-600 hover:bg-red-500 text-white text-xs w-6 h-6 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                x
              </button>
            </div>
            <div className="p-2.5 text-xs text-gray-400 flex flex-wrap gap-2">
              {entry.rsi != null && <span>RSI: {entry.rsi.toFixed(1)}</span>}
              {entry.rsiCrop && <span>RSI crop ✓</span>}
              {entry.droCrop && <span>DRO crop ✓</span>}
              {entry.droDominanceCrop && <span>Dominance crop ✓</span>}
            </div>
          </div>
        ) : (
          <div className="border-2 border-dashed border-gray-600 rounded-lg p-5 text-center bg-gray-900/50">
            <div className="text-gray-400 text-sm">
              <span className="text-2xl block mb-1">📸</span>
              Capture a 5m chart to analyze
            </div>
          </div>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1.5">
          Market prices
          <span className="ml-1 text-gray-500 font-normal">(optional — enables max buy ¢)</span>
        </label>
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="block text-xs text-gray-500 mb-1">Up ¢</label>
            <input
              type="number"
              min={1}
              max={99}
              value={upCents}
              onChange={(e) => setUpCents(e.target.value)}
              placeholder="e.g. 60"
              className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white text-sm placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
            />
          </div>
          <div className="flex-1">
            <label className="block text-xs text-gray-500 mb-1">Down ¢</label>
            <input
              type="number"
              min={1}
              max={99}
              value={downCents}
              onChange={(e) => setDownCents(e.target.value)}
              placeholder="e.g. 41"
              className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white text-sm placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
            />
          </div>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1.5">Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional context — e.g. 'Polymarket Up 60¢ / Down 41¢, expecting mean reversion after RSI peak...'"
          rows={3}
          className="w-full px-4 py-3 bg-gray-900 border border-gray-600 rounded-lg text-white text-sm placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all resize-none"
        />
      </div>

      <button
        type="submit"
        disabled={!canSubmit}
        className="w-full py-4 px-6 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 disabled:from-gray-600 disabled:to-gray-700 disabled:cursor-not-allowed text-white font-semibold rounded-lg shadow-lg transition-all duration-200 flex items-center justify-center gap-2"
      >
        {isLoading ? (
          <>
            <svg
              className="animate-spin h-5 w-5"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            Analyzing chart...
          </>
        ) : (
          <>
            <span>🔍</span>
            Analyze Polymarket
          </>
        )}
      </button>

      {!canSubmit && !isLoading && (
        <p className="text-xs text-gray-500 text-center">Capture a 5m chart screenshot to analyze</p>
      )}
    </form>
  );
}
