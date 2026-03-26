import { useState, useRef, useCallback } from 'react';
import type { Symbol, Timeframe, TrendDirection, AnalysisRequest, Indicators, ScreenshotMeta } from '../types';

interface ScreenshotEntry {
  dataUrl: string;
  timeframe: Timeframe;
}

const DEFAULT_TIMEFRAMES: Timeframe[] = ['4h', '1h', '15m'];
const TIMEFRAME_LABELS: Record<Timeframe, string> = { '4h': '4H', '1h': '1H', '15m': '15m' };

interface AnalysisFormProps {
  onSubmit: (request: AnalysisRequest) => void;
  isLoading: boolean;
}

const MAX_SCREENSHOTS = 3;
const MAX_FILE_SIZE = 4 * 1024 * 1024; // 4 MB

export function AnalysisForm({ onSubmit, isLoading }: AnalysisFormProps) {
  const [symbol, setSymbol] = useState<Symbol>('ETHUSDT');
  const [entries, setEntries] = useState<ScreenshotEntry[]>([]);
  const [userReasoning, setUserReasoning] = useState('');
  const [showIndicators, setShowIndicators] = useState(false);

  // Trend direction
  const [trend4h, setTrend4h] = useState<TrendDirection>('neutral');
  const [trend1h, setTrend1h] = useState<TrendDirection>('neutral');
  const [trend15m, setTrend15m] = useState<TrendDirection>('neutral');

  const [dragActive, setDragActive] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback((file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      if (!file.type.startsWith('image/')) {
        reject(new Error('Only image files are allowed'));
        return;
      }
      if (file.size > MAX_FILE_SIZE) {
        reject(new Error('File too large (max 4 MB)'));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }, []);

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      const remaining = MAX_SCREENSHOTS - entries.length;
      const toProcess = Array.from(files).slice(0, remaining);
      try {
        const results = await Promise.all(toProcess.map(processFile));
        setEntries((prev) => {
          const usedTfs = new Set(prev.map((e) => e.timeframe));
          const newEntries: ScreenshotEntry[] = results.map((dataUrl) => {
            const tf = DEFAULT_TIMEFRAMES.find((t) => !usedTfs.has(t)) ?? '15m';
            usedTfs.add(tf);
            return { dataUrl, timeframe: tf };
          });
          return [...prev, ...newEntries].slice(0, MAX_SCREENSHOTS);
        });
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Failed to add image');
      }
    },
    [entries.length, processFile],
  );

  const handleCapture = useCallback(async () => {
    setCapturing(true);
    try {
      const res = await fetch(`/capture/capture?symbol=${symbol}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `Capture failed (${res.status})`);
      }
      const data: { screenshots: string[] } = await res.json();
      if (data.screenshots.length === 0) {
        throw new Error('No screenshots returned');
      }
      setEntries(
        data.screenshots.slice(0, MAX_SCREENSHOTS).map((dataUrl, index) => ({
          dataUrl,
          timeframe: DEFAULT_TIMEFRAMES[index] ?? '15m',
        })),
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to capture charts');
    } finally {
      setCapturing(false);
    }
  }, [symbol]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
    },
    [addFiles],
  );

  const removeScreenshot = (index: number) => {
    setEntries((prev) => prev.filter((_, i) => i !== index));
  };

  const updateEntry = (index: number, patch: Partial<ScreenshotEntry>) => {
    setEntries((prev) => prev.map((e, i) => (i === index ? { ...e, ...patch } : e)));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    let indicators: Indicators | undefined;

    if (showIndicators) {
      indicators = {
        trend: { '4h': trend4h, '1h': trend1h, '15m': trend15m },
      };
    }

    const screenshots = entries.map((e) => e.dataUrl);

    const screenshotsMeta: ScreenshotMeta[] = entries.map((e) => ({
      dataUrl: e.dataUrl,
      timeframe: e.timeframe,
    }));

    onSubmit({
      symbol,
      screenshots,
      screenshotsMeta,
      userReasoning: userReasoning.trim(),
      indicators,
    });
  };

  const canSubmit =
    !isLoading && (entries.length > 0 || userReasoning.trim().length > 0);

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Symbol */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1.5">Symbol</label>
        <select
          value={symbol}
          onChange={(e) => setSymbol(e.target.value as Symbol)}
          className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
        >
          <option value="ETHUSDT">ETH / USDT</option>
          <option value="BTCUSDT">BTC / USDT</option>
          <option value="ETHBTC">ETH / BTC</option>
        </select>
      </div>

      {/* Screenshot Upload */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1.5">
          Chart Screenshots
          <span className="ml-1 text-gray-500 font-normal">
            ({entries.length}/{MAX_SCREENSHOTS})
          </span>
        </label>
        <button
          type="button"
          onClick={handleCapture}
          disabled={capturing || entries.length >= MAX_SCREENSHOTS}
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
              Capturing... (4H → 1H → 15m)
            </>
          ) : (
            <>
              <span>📷</span>
              Capture from TradingView
            </>
          )}
        </button>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-5 text-center cursor-pointer transition-all ${
            dragActive
              ? 'border-blue-500 bg-blue-500/10'
              : 'border-gray-600 hover:border-gray-500 bg-gray-900/50'
          } ${entries.length >= MAX_SCREENSHOTS ? 'opacity-50 pointer-events-none' : ''}`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => e.target.files && addFiles(e.target.files)}
          />
          <div className="text-gray-400 text-sm">
            <span className="text-2xl block mb-1">📸</span>
            {entries.length >= MAX_SCREENSHOTS
              ? 'Max screenshots reached'
              : 'Drop chart screenshots here or click to upload'}
          </div>
        </div>

        {entries.length > 0 && (
          <div className="space-y-3 mt-3">
            {entries.map((entry, i) => (
              <div
                key={i}
                className="bg-gray-800/60 rounded-lg border border-gray-700 overflow-hidden"
              >
                {/* Preview image — full width */}
                <div className="relative group">
                  <img
                    src={entry.dataUrl}
                    alt={`Screenshot ${i + 1}`}
                    className="w-full h-40 object-cover object-top"
                  />
                  <button
                    type="button"
                    onClick={() => removeScreenshot(i)}
                    className="absolute top-2 right-2 bg-red-600 hover:bg-red-500 text-white text-xs w-6 h-6 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    x
                  </button>
                </div>

                {/* Timeframe selector */}
                <div className="p-2.5">
                  <select
                    value={entry.timeframe}
                    onChange={(e) => updateEntry(i, { timeframe: e.target.value as Timeframe })}
                    className="w-full px-2.5 py-1.5 bg-gray-900 border border-gray-600 rounded-md text-white text-sm font-medium focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    {DEFAULT_TIMEFRAMES.map((tf) => (
                      <option key={tf} value={tf}>{TIMEFRAME_LABELS[tf]}</option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* User Reasoning */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1.5">
          Your Reasoning / Thesis
        </label>
        <textarea
          value={userReasoning}
          onChange={(e) => setUserReasoning(e.target.value)}
          placeholder="What do you see on the chart? e.g. 'RSI divergence on 1H, DRO showing cycle low approaching on 15m, I think price pushes up 0.5% within 10 min...'"
          rows={4}
          className="w-full px-4 py-3 bg-gray-900 border border-gray-600 rounded-lg text-white text-sm placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all resize-none"
        />
      </div>

      {/* Optional Indicators Toggle */}
      <div>
        <button
          type="button"
          onClick={() => setShowIndicators(!showIndicators)}
          className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-300 transition-colors"
        >
          <svg
            className={`w-4 h-4 transition-transform ${showIndicators ? 'rotate-90' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          Add indicator values (optional)
        </button>

        {showIndicators && (
          <div className="mt-3 bg-gray-800/50 rounded-lg p-4 border border-gray-700 space-y-5">
            {/* Trend Direction */}
            <div>
              <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">
                Trend Direction
              </h4>
              <p className="text-[11px] text-gray-500 mb-2">
                Your assessment from the chart (EMA, market structure, price action — whatever you use)
              </p>
              <div className="grid grid-cols-3 gap-3">
                {([
                  { label: '4H', value: trend4h, setter: setTrend4h },
                  { label: '1H', value: trend1h, setter: setTrend1h },
                  { label: '15m', value: trend15m, setter: setTrend15m },
                ] as const).map(({ label, value, setter }) => (
                  <div key={label}>
                    <label className="block text-xs text-gray-400 mb-1">Trend {label}</label>
                    <select
                      value={value}
                      onChange={(e) => setter(e.target.value as TrendDirection)}
                      className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded-md text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                      <option value="bullish">Bullish</option>
                      <option value="neutral">Neutral</option>
                      <option value="bearish">Bearish</option>
                    </select>
                  </div>
                ))}
              </div>
            </div>

          </div>
        )}
      </div>

      {/* Submit */}
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
            Predict 0.5% Move
          </>
        )}
      </button>

      {!canSubmit && !isLoading && (
        <p className="text-xs text-gray-500 text-center">
          Add at least a screenshot or write your reasoning to analyze
        </p>
      )}
    </form>
  );
}
