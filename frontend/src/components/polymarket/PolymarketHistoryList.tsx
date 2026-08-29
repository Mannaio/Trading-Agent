import type { StoredPolymarketAnalysis } from '../../types-polymarket';
import { POLYMARKET_CALL_CONFIG, POLYMARKET_OUTCOME_CONFIG, polymarketSymbolShort } from '../../types-polymarket';

interface PolymarketHistoryListProps {
  history: StoredPolymarketAnalysis[];
  onSelect: (analysis: StoredPolymarketAnalysis) => void;
  selectedId: string | null;
}

function timeAgo(timestamp: string): string {
  const diffMs = Date.now() - new Date(timestamp).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function PolymarketHistoryList({ history, onSelect, selectedId }: PolymarketHistoryListProps) {
  if (history.length === 0) {
    return (
      <div className="bg-gray-800/50 rounded-lg p-6 border border-gray-700">
        <h2 className="text-lg font-semibold text-gray-300 mb-4">History</h2>
        <p className="text-gray-500 text-center py-3 text-sm">No Polymarket analyses yet</p>
      </div>
    );
  }

  return (
    <div className="bg-gray-800/50 rounded-lg p-6 border border-gray-700">
      <h2 className="text-lg font-semibold text-gray-300 mb-4">
        History <span className="text-gray-500 font-normal text-sm">({history.length})</span>
      </h2>

      <div className="space-y-2">
        {history.map((item) => {
          const callCfg = POLYMARKET_CALL_CONFIG[item.call];
          const outCfg = POLYMARKET_OUTCOME_CONFIG[item.outcome];
          const selected = item.id === selectedId;

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item)}
              className={`w-full text-left px-4 py-3 rounded-lg transition-all duration-150 flex items-center cursor-pointer gap-3 ${
                selected
                  ? 'bg-blue-900/40 border border-blue-600'
                  : 'bg-gray-900/50 border border-transparent hover:bg-gray-800 hover:border-gray-600'
              }`}
            >
              <span className="text-lg">{callCfg.emoji}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-white">
                    {polymarketSymbolShort(item.symbol ?? 'ETHUSDT')}
                  </span>
                  <span className={`text-sm font-semibold ${callCfg.color}`}>{callCfg.label}</span>
                  <span className="text-xs text-gray-500">{item.marketWindow}</span>
                  <span
                    className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${outCfg.bg} ${outCfg.color}`}
                  >
                    {outCfg.emoji} {outCfg.label}
                  </span>
                </div>
                <p className="text-xs text-gray-400 truncate">
                  {timeAgo(item.timestamp)} &middot; {item.confidence}% confidence
                  {item.marketPrices &&
                    ` · Up ${item.marketPrices.upCents}¢ / Down ${item.marketPrices.downCents}¢`}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
