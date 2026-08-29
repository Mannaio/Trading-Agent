import type {
  StoredPolymarketAnalysis,
  PolymarketOutcome,
  RsiReport,
  DroReport,
  EmaDpoReport,
} from '../../types-polymarket';
import { POLYMARKET_CALL_CONFIG, POLYMARKET_OUTCOME_CONFIG, formatPolymarketSymbolLabel } from '../../types-polymarket';

function formatValue(value: unknown): string {
  if (value == null) return '—';
  if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function ReportRows({ data, prefix = '' }: { data: Record<string, unknown>; prefix?: string }) {
  return (
    <ul className="space-y-1.5 text-sm text-gray-300">
      {Object.entries(data).map(([key, value]) => {
        const label = prefix ? `${prefix}.${key}` : key;
        if (value != null && typeof value === 'object' && !Array.isArray(value)) {
          return (
            <li key={label}>
              <span className="text-gray-500 uppercase text-xs tracking-wide">{key}</span>
              <div className="mt-1 ml-2 border-l border-gray-700 pl-2">
                <ReportRows data={value as Record<string, unknown>} prefix={label} />
              </div>
            </li>
          );
        }
        return (
          <li key={label} className="flex gap-2">
            <span className="text-gray-500 shrink-0 capitalize">{key.replace(/([A-Z])/g, ' $1')}</span>
            <span className="leading-relaxed">{formatValue(value)}</span>
          </li>
        );
      })}
    </ul>
  );
}

function SpecialistReport({
  title,
  report,
}: {
  title: string;
  report: RsiReport | DroReport | EmaDpoReport;
}) {
  return (
    <details className="bg-gray-900/50 rounded-lg border border-gray-700/50 group">
      <summary className="px-4 py-3 cursor-pointer text-sm font-medium text-gray-300 hover:text-white transition-colors list-none flex items-center justify-between">
        <span>{title}</span>
        <span className="text-gray-500 text-xs group-open:rotate-180 transition-transform">▼</span>
      </summary>
      <div className="px-4 pb-4 border-t border-gray-700/50 pt-3">
        <ReportRows data={report as unknown as Record<string, unknown>} />
      </div>
    </details>
  );
}

interface PolymarketResultProps {
  analysis: StoredPolymarketAnalysis | null;
  onOutcome?: (id: string, outcome: PolymarketOutcome) => void;
}

export function PolymarketResult({ analysis, onOutcome }: PolymarketResultProps) {
  if (!analysis) {
    return (
      <div className="bg-gray-800/50 rounded-lg p-6 border border-gray-700">
        <h2 className="text-lg font-semibold text-gray-300 mb-4">Polymarket Call</h2>
        <p className="text-gray-500 text-center py-8 text-sm">
          Capture a 5m chart, optionally enter market prices, then click Analyze Polymarket.
        </p>
      </div>
    );
  }

  const callConfig = POLYMARKET_CALL_CONFIG[analysis.call];
  const outcomeConfig = POLYMARKET_OUTCOME_CONFIG[analysis.outcome];
  const time = new Date(analysis.timestamp).toLocaleTimeString();
  const isReview = analysis.outcome === 'review';
  const isTook = analysis.outcome === 'took';

  return (
    <div className="bg-gray-800/50 rounded-lg p-6 border border-gray-700 space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-300">Polymarket Call</h2>
        <span
          className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${outcomeConfig.bg} ${outcomeConfig.color}`}
        >
          {outcomeConfig.emoji} {outcomeConfig.label}
        </span>
      </div>

      <div className="flex items-center gap-4">
        <span className="text-4xl">{callConfig.emoji}</span>
        <div className="flex-1">
          <h3 className={`text-3xl font-bold ${callConfig.color}`}>{callConfig.label}</h3>
          <p className="text-gray-400 text-sm">
            {formatPolymarketSymbolLabel(analysis.symbol)} &middot; {analysis.marketWindow} market &middot; {time}
          </p>
        </div>
        <div className="text-right">
          <p className="text-3xl font-bold text-white">{analysis.confidence}%</p>
          <p className="text-xs text-gray-400">confidence</p>
        </div>
      </div>

      <div>
        <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${
              analysis.confidence >= 70
                ? 'bg-emerald-500'
                : analysis.confidence >= 50
                  ? 'bg-yellow-500'
                  : 'bg-red-500'
            }`}
            style={{ width: `${analysis.confidence}%` }}
          />
        </div>
      </div>

      {(analysis.maxBuyUpCents != null || analysis.maxBuyDownCents != null || analysis.edgeNote) && (
        <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-700/50 space-y-2">
          <h4 className="text-sm font-medium text-gray-400">Max buy & edge</h4>
          <div className="grid grid-cols-2 gap-3">
            {analysis.maxBuyUpCents != null && (
              <div className="text-center">
                <p className="text-[10px] text-gray-500 uppercase tracking-wider">Max buy UP</p>
                <p className="text-lg font-semibold text-emerald-400">{analysis.maxBuyUpCents}¢</p>
              </div>
            )}
            {analysis.maxBuyDownCents != null && (
              <div className="text-center">
                <p className="text-[10px] text-gray-500 uppercase tracking-wider">Max buy DOWN</p>
                <p className="text-lg font-semibold text-red-400">{analysis.maxBuyDownCents}¢</p>
              </div>
            )}
          </div>
          {analysis.edgeNote && (
            <p className="text-sm text-gray-300 leading-relaxed">{analysis.edgeNote}</p>
          )}
          {analysis.marketPrices && (
            <p className="text-xs text-gray-500">
              Market: Up {analysis.marketPrices.upCents}¢ / Down {analysis.marketPrices.downCents}¢
            </p>
          )}
        </div>
      )}

      <div>
        <h4 className="text-sm font-medium text-gray-400 mb-2">Reasoning</h4>
        <p className="text-gray-300 text-sm leading-relaxed bg-gray-900/50 rounded-lg p-4">
          {analysis.reasoning}
        </p>
      </div>

      {analysis.vetoApplied && (
        <p className="text-xs text-amber-400 bg-amber-900/20 border border-amber-800/40 rounded-lg px-3 py-2">
          EMA+DPO soft veto applied (correlation call: {analysis.correlationCall})
        </p>
      )}

      <div className="space-y-2">
        <h4 className="text-sm font-medium text-gray-400">Specialist reports</h4>
        <SpecialistReport title="RSI Specialist" report={analysis.reports.rsi} />
        <SpecialistReport title="DRO Specialist" report={analysis.reports.dro} />
        <SpecialistReport title="EMA + DPO Specialist" report={analysis.reports.emaDpo} />
      </div>

      {analysis.notes && (
        <div>
          <h4 className="text-sm font-medium text-gray-400 mb-1.5">Your notes</h4>
          <p className="text-gray-300 text-sm leading-relaxed bg-blue-900/20 border border-blue-800/40 rounded-lg p-4">
            {analysis.notes}
          </p>
        </div>
      )}

      {onOutcome && (
        <div className="border-t border-gray-700 pt-4 space-y-3">
          {isReview && (
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => onOutcome(analysis.id, 'took')}
                className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg transition-colors text-sm"
              >
                Took trade
              </button>
              <button
                type="button"
                onClick={() => onOutcome(analysis.id, 'skipped')}
                className="flex-1 py-2.5 bg-gray-700 hover:bg-gray-600 text-gray-300 font-semibold rounded-lg transition-colors text-sm"
              >
                Skipped
              </button>
            </div>
          )}
          {isTook && (
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => onOutcome(analysis.id, 'won')}
                className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg transition-colors text-sm"
              >
                Mark won
              </button>
              <button
                type="button"
                onClick={() => onOutcome(analysis.id, 'lost')}
                className="flex-1 py-2.5 bg-red-600 hover:bg-red-500 text-white font-semibold rounded-lg transition-colors text-sm"
              >
                Mark lost
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
