import type { StoredAnalysis } from '../types';

const FEE_RATE = 0.001; // 0.1% per trade

/** Calculate net P&L for a single resolved trade (returns null if no amount/exit) */
function tradeNetPnL(h: StoredAnalysis): { net: number; currency: string } | null {
  if (!h.tradeAmount || !h.outcomePrice) return null;
  const amount = h.tradeAmount;
  const entry = h.levels.entry;
  const exit = h.outcomePrice;
  const gross = h.direction === 'HIGHER'
    ? amount * (exit - entry)
    : amount * (entry - exit);
  const fees = amount * entry * FEE_RATE + amount * exit * FEE_RATE;
  const currency = h.symbol === 'ETHBTC' ? 'BTC' : 'USD';
  return { net: gross - fees, currency };
}

interface StatsPanelProps {
  history: StoredAnalysis[];
}

export function StatsPanel({ history }: StatsPanelProps) {
  const resolved = history.filter((h) => h.outcome === 'won' || h.outcome === 'lost');
  const cancelled = history.filter((h) => h.outcome === 'cancelled');
  const pending = history.filter((h) => h.outcome === 'pending');
  const won = resolved.filter((h) => h.outcome === 'won');
  const lost = resolved.filter((h) => h.outcome === 'lost');
  const expired = history.filter((h) => h.outcome === 'expired');

  // Aggregate net P&L by currency (includes won, lost, and cancelled trades)
  const pnlByCurrency: Record<string, number> = {};
  for (const h of [...resolved, ...cancelled]) {
    const r = tradeNetPnL(h);
    if (r) {
      pnlByCurrency[r.currency] = (pnlByCurrency[r.currency] ?? 0) + r.net;
    }
  }
  const pnlEntries = Object.entries(pnlByCurrency);

  const winRate = resolved.length > 0 ? Math.round((won.length / resolved.length) * 100) : null;

  // Average probability of won vs lost
  const avgProbWon = won.length > 0
    ? Math.round(won.reduce((s, h) => s + h.probability, 0) / won.length)
    : null;
  const avgProbLost = lost.length > 0
    ? Math.round(lost.reduce((s, h) => s + h.probability, 0) / lost.length)
    : null;

  // Per-symbol breakdown
  const symbols = [...new Set(history.map((h) => h.symbol))];
  const symbolStats = symbols.map((sym) => {
    const symResolved = resolved.filter((h) => h.symbol === sym);
    const symWon = symResolved.filter((h) => h.outcome === 'won');
    return {
      symbol: sym,
      total: history.filter((h) => h.symbol === sym).length,
      resolved: symResolved.length,
      won: symWon.length,
      winRate: symResolved.length > 0 ? Math.round((symWon.length / symResolved.length) * 100) : null,
    };
  });

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

      {!hasData ? (
        <p className="text-gray-500 text-center py-3 text-sm">No predictions yet</p>
      ) : (
        <div className="space-y-4">
          {/* Main stats row */}
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

          {/* Win rate bar */}
          {resolved.length > 0 && (
            <div>
              <div className="flex justify-between text-[10px] text-gray-400 mb-1">
                <span>{won.length}W / {lost.length}L / {cancelled.length}C / {expired.length}E</span>
                <span>{resolved.length} resolved</span>
              </div>
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
            </div>
          )}

          {/* Total Net P&L */}
          {pnlEntries.length > 0 && (
            <div className="bg-gray-900/50 rounded-lg p-3">
              <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1.5">Total Net P&L</p>
              <div className="flex items-center gap-4">
                {pnlEntries.map(([currency, net]) => (
                  <div key={currency} className="flex items-center gap-1.5">
                    <span className={`text-lg font-bold ${net >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {net >= 0 ? '+' : ''}
                      {currency === 'BTC' ? net.toFixed(6) : net.toFixed(2)}
                    </span>
                    <span className="text-xs text-gray-400">{currency}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Avg confidence */}
          {(avgProbWon !== null || avgProbLost !== null) && (
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-gray-900/50 rounded-lg p-2.5">
                <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-0.5">Avg Confidence (Won)</p>
                <p className="text-sm font-semibold text-emerald-400">
                  {avgProbWon !== null ? `${avgProbWon}%` : '—'}
                </p>
              </div>
              <div className="bg-gray-900/50 rounded-lg p-2.5">
                <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-0.5">Avg Confidence (Lost)</p>
                <p className="text-sm font-semibold text-red-400">
                  {avgProbLost !== null ? `${avgProbLost}%` : '—'}
                </p>
              </div>
            </div>
          )}

          {/* Per-symbol breakdown */}
          {symbolStats.length > 1 && (
            <div>
              <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-2">By Symbol</p>
              <div className="space-y-1.5">
                {symbolStats.map((s) => (
                  <div key={s.symbol} className="flex items-center gap-2 text-xs">
                    <span className="text-gray-300 font-medium w-16">{s.symbol.replace('USDT', '')}</span>
                    <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                      {s.resolved > 0 && (
                        <div
                          className={`h-full rounded-full ${s.winRate! >= 50 ? 'bg-emerald-500' : 'bg-red-500'}`}
                          style={{ width: `${s.winRate}%` }}
                        />
                      )}
                    </div>
                    <span className="text-gray-400 w-20 text-right">
                      {s.winRate !== null ? `${s.winRate}%` : '—'} ({s.won}/{s.resolved})
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
}
