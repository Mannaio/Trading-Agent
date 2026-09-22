import type { StoredAnalysis } from '../types';
import { DIRECTION_CONFIG, OUTCOME_CONFIG } from '../types';
import type { PortfolioLedger } from '../lib/portfolioLedger';
import { ledgerReturnPct } from '../lib/portfolioLedger';
import { formatSizeLabel } from '../lib/tradeSizes';

interface HistoryListProps {
  history: StoredAnalysis[];
  ledger: PortfolioLedger;
  onSelect: (analysis: StoredAnalysis) => void;
  selectedId: string | null;
}

function formatSymbol(symbol: string): string {
  if (symbol === 'BTCUSD') return 'BTC/USD';
  if (symbol === 'ETHBTC') return 'ETH/BTC';
  return symbol.replace('USDT', '/USDT');
}

function formatDate(ts: string): string {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatPrice(value: number | undefined, symbol: string): string {
  if (value == null) return '—';
  if (symbol === 'ETHBTC') return value.toFixed(5);
  if (value < 100) return `$${value.toFixed(2)}`;
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function HistoryList({ history, ledger, onSelect, selectedId }: HistoryListProps) {
  const confirmed = history.filter((h) => h.tradeSize != null && h.outcome !== 'expired' && h.outcome !== 'review');
  const returnPct = ledgerReturnPct(ledger);

  if (history.length === 0) {
    return (
      <div className="bg-gray-800/50 rounded-lg p-6 border border-gray-700">
        <h2 className="text-lg font-semibold text-gray-300 mb-4">Transaction History</h2>
        <p className="text-gray-500 text-center py-3 text-sm">No predictions yet</p>
      </div>
    );
  }

  return (
    <div className="bg-gray-800/50 rounded-lg p-6 border border-gray-700">
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <h2 className="text-lg font-semibold text-gray-300">
          Transaction History
          <span className="text-gray-500 font-normal text-sm ml-2">({confirmed.length} trades)</span>
        </h2>
        <div className="text-xs text-gray-400">
          Balance: <span className="text-white font-semibold">{ledger.balanceBtc.toFixed(4)} BTC</span>
          <span className={`ml-2 ${returnPct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            ({returnPct >= 0 ? '+' : ''}{returnPct.toFixed(2)}%)
          </span>
        </div>
      </div>

      <div className="overflow-x-auto -mx-2">
        <table className="w-full text-xs min-w-[720px]">
          <thead>
            <tr className="text-gray-500 border-b border-gray-700">
              <th className="text-left py-2 px-2 font-medium">Date</th>
              <th className="text-left py-2 px-2 font-medium">Symbol</th>
              <th className="text-left py-2 px-2 font-medium">Dir</th>
              <th className="text-right py-2 px-2 font-medium">Size</th>
              <th className="text-right py-2 px-2 font-medium">Entry</th>
              <th className="text-right py-2 px-2 font-medium">Exit</th>
              <th className="text-right py-2 px-2 font-medium">Fee</th>
              <th className="text-right py-2 px-2 font-medium">Net P&L</th>
              <th className="text-right py-2 px-2 font-medium">Balance</th>
              <th className="text-center py-2 px-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {history.map((item) => {
              const cfg = DIRECTION_CONFIG[item.direction];
              const outCfg = OUTCOME_CONFIG[item.outcome ?? 'pending'];
              const selected = item.id === selectedId;
              const hasLedger = item.tradeSize != null;
              const closed = item.ledger?.closedAt != null;

              return (
                <tr
                  key={item.id}
                  onClick={() => onSelect(item)}
                  className={`border-b border-gray-700/50 cursor-pointer transition-colors ${
                    selected ? 'bg-blue-900/30' : 'hover:bg-gray-900/50'
                  }`}
                >
                  <td className="py-2.5 px-2 text-gray-400 whitespace-nowrap">
                    {formatDate(item.ledger?.confirmedAt ?? item.timestamp)}
                  </td>
                  <td className="py-2.5 px-2 text-white font-medium">{formatSymbol(item.symbol)}</td>
                  <td className={`py-2.5 px-2 font-semibold ${cfg.color}`}>{cfg.label.split(' ')[0]}</td>
                  <td className="py-2.5 px-2 text-right text-gray-300">
                    {hasLedger ? formatSizeLabel(item.tradeSize!, item.symbol) : '—'}
                  </td>
                  <td className="py-2.5 px-2 text-right text-gray-300">
                    {hasLedger ? formatPrice(item.levels.entry, item.symbol) : '—'}
                  </td>
                  <td className="py-2.5 px-2 text-right text-gray-300">
                    {closed ? formatPrice(item.outcomePrice, item.symbol) : item.outcome === 'pending' ? '…' : '—'}
                  </td>
                  <td className="py-2.5 px-2 text-right text-red-400/80">
                    {closed && item.ledger?.totalFeeQuote != null
                      ? `$${item.ledger.totalFeeQuote.toFixed(2)}`
                      : hasLedger && item.ledger?.entryFeeQuote != null
                      ? `~$${(item.ledger.entryFeeQuote * 2).toFixed(2)}`
                      : '—'}
                  </td>
                  <td className={`py-2.5 px-2 text-right font-semibold ${
                    closed && item.ledger?.netPnlBtc != null
                      ? item.ledger.netPnlBtc >= 0 ? 'text-emerald-400' : 'text-red-400'
                      : 'text-gray-500'
                  }`}>
                    {closed && item.ledger?.netPnlBtc != null
                      ? `${item.ledger.netPnlBtc >= 0 ? '+' : ''}${item.ledger.netPnlBtc.toFixed(6)}`
                      : '—'}
                  </td>
                  <td className="py-2.5 px-2 text-right text-gray-300">
                    {closed && item.ledger?.balanceBtcAfter != null
                      ? item.ledger.balanceBtcAfter.toFixed(4)
                      : '—'}
                  </td>
                  <td className="py-2.5 px-2 text-center">
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${outCfg.bg} ${outCfg.color}`}>
                      {outCfg.emoji}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
