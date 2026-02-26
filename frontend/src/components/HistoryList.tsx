import type { StoredAnalysis } from '../types';
import { DIRECTION_CONFIG, OUTCOME_CONFIG } from '../types';

interface HistoryListProps {
  history: StoredAnalysis[];
  onSelect: (analysis: StoredAnalysis) => void;
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

export function HistoryList({ history, onSelect, selectedId }: HistoryListProps) {
  if (history.length === 0) {
    return (
      <div className="bg-gray-800/50 rounded-lg p-6 border border-gray-700">
        <h2 className="text-lg font-semibold text-gray-300 mb-4">History</h2>
        <p className="text-gray-500 text-center py-3 text-sm">No predictions yet</p>
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
          const cfg = DIRECTION_CONFIG[item.direction];
          const outCfg = OUTCOME_CONFIG[item.outcome ?? 'pending'];
          const selected = item.id === selectedId;

          return (
            <button
              key={item.id}
              onClick={() => onSelect(item)}
              className={`w-full text-left px-4 py-3 rounded-lg transition-all duration-150 flex items-center cursor-pointer gap-3 ${
                selected
                  ? 'bg-blue-900/40 border border-blue-600'
                  : 'bg-gray-900/50 border border-transparent hover:bg-gray-800 hover:border-gray-600'
              }`}
            >
              <span className="text-lg">{cfg.emoji}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white">
                    {item.symbol.replace('USDT', '')}
                  </span>
                  <span className={`text-sm font-semibold ${cfg.color}`}>{cfg.label}</span>
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${outCfg.bg} ${outCfg.color}`}>
                    {outCfg.emoji} {outCfg.label}
                  </span>
                </div>
                <p className="text-xs text-gray-400 truncate">
                  {timeAgo(item.timestamp)} &middot; {item.probability}%
                  {item.screenshotCount > 0 && ` · ${item.screenshotCount} 📸`}
                  {item.outcome === 'lost' && item.feedback && ' · 📝'}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
