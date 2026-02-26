import { useState, useRef, useCallback, memo, useMemo } from 'react';
import type { Symbol, TrendDirection, AnalysisRequest, Indicators } from '../types';


interface AnalysisFormProps {
  onSubmit: (request: AnalysisRequest) => void;
  isLoading: boolean;
}

const MAX_SCREENSHOTS = 3;
const MAX_FILE_SIZE = 4 * 1024 * 1024; // 4 MB

interface ScreenshotThumbnailProps {
  src: string;
  index: number;
  onRemove: (index: number) => void;
}

const ScreenshotThumbnail = memo(function ScreenshotThumbnail({ src, index, onRemove }: ScreenshotThumbnailProps) {
  const handleRemove = useCallback(() => {
    onRemove(index);
  }, [onRemove, index]);

  return (
    <div className="relative group">
      <img
        src={src}
        alt={`Screenshot ${index + 1}`}
        className="h-20 w-32 object-cover rounded-md border border-gray-600"
      />
      <button
        type="button"
        onClick={handleRemove}
        className="absolute -top-2 -right-2 bg-red-600 hover:bg-red-500 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
      >
        x
      </button>
    </div>
  );
});

export const AnalysisForm = memo(function AnalysisForm({ onSubmit, isLoading }: AnalysisFormProps) {
  const [symbol, setSymbol] = useState<Symbol>('ETHUSDT');
  const [screenshots, setScreenshots] = useState<string[]>([]);
  const [userReasoning, setUserReasoning] = useState('');
  const [showIndicators, setShowIndicators] = useState(false);

  // Trend direction
  const [trend4h, setTrend4h] = useState<TrendDirection>('neutral');
  const [trend1h, setTrend1h] = useState<TrendDirection>('neutral');
  const [trend15m, setTrend15m] = useState<TrendDirection>('neutral');

  const [dragActive, setDragActive] = useState(false);
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
      const remaining = MAX_SCREENSHOTS - screenshots.length;
      const toProcess = Array.from(files).slice(0, remaining);
      try {
        const results = await Promise.all(toProcess.map(processFile));
        setScreenshots((prev) => [...prev, ...results].slice(0, MAX_SCREENSHOTS));
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Failed to add image');
      }
    },
    [screenshots.length, processFile],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
    },
    [addFiles],
  );

  const removeScreenshot = useCallback((index: number) => {
    setScreenshots((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();

    let indicators: Indicators | undefined;

    if (showIndicators) {
      indicators = {
        trend: { '4h': trend4h, '1h': trend1h, '15m': trend15m },
      };
    }

    onSubmit({
      symbol,
      screenshots,
      userReasoning: userReasoning.trim(),
      indicators,
    });
  }, [onSubmit, symbol, screenshots, userReasoning, showIndicators, trend4h, trend1h, trend15m]);

  const canSubmit = useMemo(() => 
    !isLoading && (screenshots.length > 0 || userReasoning.trim().length > 0),
    [isLoading, screenshots.length, userReasoning]
  );

  const handleSymbolChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setSymbol(e.target.value as Symbol);
  }, []);

  const handleUserReasoningChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setUserReasoning(e.target.value);
  }, []);

  const handleToggleIndicators = useCallback(() => {
    setShowIndicators((prev) => !prev);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragActive(false);
  }, []);

  const handleDropZoneClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(e.target.files);
  }, [addFiles]);

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Symbol */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1.5">Symbol</label>
        <select
          value={symbol}
          onChange={handleSymbolChange}
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
            ({screenshots.length}/{MAX_SCREENSHOTS})
          </span>
        </label>
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={handleDropZoneClick}
          className={`border-2 border-dashed rounded-lg p-5 text-center cursor-pointer transition-all ${
            dragActive
              ? 'border-blue-500 bg-blue-500/10'
              : 'border-gray-600 hover:border-gray-500 bg-gray-900/50'
          } ${screenshots.length >= MAX_SCREENSHOTS ? 'opacity-50 pointer-events-none' : ''}`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleFileInputChange}
          />
          <div className="text-gray-400 text-sm">
            <span className="text-2xl block mb-1">📸</span>
            {screenshots.length >= MAX_SCREENSHOTS
              ? 'Max screenshots reached'
              : 'Drop chart screenshots here or click to upload'}
          </div>
        </div>

        {screenshots.length > 0 && (
          <div className="flex gap-3 mt-3 flex-wrap">
            {screenshots.map((src, i) => (
              <ScreenshotThumbnail
                key={i}
                src={src}
                index={i}
                onRemove={removeScreenshot}
              />
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
          onChange={handleUserReasoningChange}
          placeholder="What do you see on the chart? e.g. 'RSI divergence on 1H, DRO showing cycle low approaching on 15m, I think price pushes up 0.5% within 10 min...'"
          rows={4}
          className="w-full px-4 py-3 bg-gray-900 border border-gray-600 rounded-lg text-white text-sm placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all resize-none"
        />
      </div>

      {/* Optional Indicators Toggle */}
      <div>
        <button
          type="button"
          onClick={handleToggleIndicators}
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
});
