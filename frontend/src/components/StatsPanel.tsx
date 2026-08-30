import type { StoredAnalysis } from '../types';
import type { PortfolioLedger } from '../lib/portfolioLedger';
import { ledgerReturnPct } from '../lib/portfolioLedger';
import { supportsLedger } from '../lib/tradeSizes';

interface StatsPanelProps {
  history: StoredAnalysis[];
  ledger: PortfolioLedger;
}

export function StatsPanel({ history, ledger }: StatsPanelProps) {
  const resolved = history.filter((h) => h.outcome === 'won' || h.outcome === 'lost');
  const pending = history.filter((h) => h.outcome === 'pending');
  const won = resolved.filter((h) => h.outcome === 'won');
  const lost = resolved.filter((h) => h.outcome === 'lost');

  const ledgerTrades = resolved.filter((h) => h.ledger?.closedAt != null);
  const totalNetBtc = ledgerTrades.reduce((s, h) => s + (h.ledger?.netPnlBtc ?? 0), 0);
  const totalFeesQuote = ledgerTrades.reduce((s, h) => s + (h.ledger?.totalFeeQuote ?? 0), 0);

  const winRate = resolved.length > 0 ? Math.round((won.length / resolved.length) * 100) : null;
  const returnPct = ledgerReturnPct(ledger);

  const hasData = history.length > 0;

  return (
    <div className="bg-gray-800/50 rounded-lg p-6 border border-gray-700">
      <h2 className="text-lg font-semibold text-gray-300 mb-4">
        Performance
        {pending.length > 0 && (
          <span className="ml-2 text-xs font-normal text-blue-400 animate-pulse">
            {pending.length} live
          </span>
        )}
      </h2>

      <div className="bg-gray-900/50 rounded-lg p-3 mb-4">
        <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">OKX Spot Portfolio (simulated)</p>
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="text-2xl font-bold text-white">{ledger.balanceBtc.toFixed(6)} BTC</span>
          <span className={`text-sm font-medium ${returnPct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {returnPct >= 0 ? '+' : ''}{returnPct.toFixed(2)}%
          </span>
          <span className="text-xs text-gray-500">from {ledger.initialCapitalBtc} BTC</span>
        </div>
        {ledgerTrades.length > 0 && (
          <p className="text-xs text-gray-500 mt-1">
            {ledgerTrades.length} ledger trades · net {totalNetBtc >= 0 ? '+' : ''}{totalNetBtc.toFixed(6)} BTC · fees ${totalFeesQuote.toFixed(2)}
          </p>
        )}
      </div>

      {!hasData ? (
        <p className="text-gray-500 text-center py-3 text-sm">No predictions yet</p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-3">
            <div className="bg-gray-900/50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-white">{history.length}</p>
              <p className="text-[10px] text-gray-400 uppercase tracking-wider">Total</p>
            </div>
            <div className="bg-gray-900/50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-emerald-400">{won.length}</p>
              <p className="text-[10px] text-gray-400 uppercase tracking-wider">Won</p>
            </div>
            <div className="bg-gray-900/50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-red-400">{lost.length}</p>
              <p className="text-[10px] text-gray-400 uppercase tracking-wider">Lost</p>
            </div>
            <div className="bg-gray-900/50 rounded-lg p-3 text-center">
              <p className={`text-2xl font-bold ${
                winRate === null ? 'text-gray-500' : winRate >= 50 ? 'text-emerald-400' : 'text-red-400'
              }`}>
                {winRate !== null ? `${winRate}%` : '—'}
              </p>
              <p className="text-[10px] text-gray-400 uppercase tracking-wider">Win Rate</p>
            </div>
          </div>

          {resolved.length > 0 && (
            <div className="h-2 bg-gray-700 rounded-full overflow-hidden flex">
              <div
                className="h-full bg-emerald-500 transition-all duration-500"
                style={{ width: `${(won.length / resolved.length) * 100}%` }}
              />
              <div
                className="h-full bg-red-500 transition-all duration-500"
                style={{ width: `${(lost.length / resolved.length) * 100}%` }}
              />
            </div>
          )}

          <p className="text-[10px] text-gray-500">
            Ledger tracks confirmed trades on {supportsLedger('BTCUSD') ? 'BTC/USD' : ''} & ETH/USDT with OKX EEA spot fees (taker 0.10% entry · maker 0.08% exit).
          </p>
        </div>
      )}
    </div>
  );
}
