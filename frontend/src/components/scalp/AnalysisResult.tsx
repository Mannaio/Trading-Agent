import { useState, useEffect } from 'react';
import type { StoredAnalysis, Direction, TradeSize } from '../../types';
import { DIRECTION_CONFIG, OUTCOME_CONFIG } from '../../types';
import { calcSpotPnL, estimateEntryFees } from '../../lib/okxFees';
import type { PortfolioLedger } from '../../lib/portfolioLedger';
import { TRADE_SIZES, getSizeUnit, supportsLedger, formatSizeLabel } from '../../lib/tradeSizes';

function formatPrice(value: number, symbol: string): string {
  if (symbol === 'ETHBTC') {
    return value.toFixed(5);
  }
  if (value < 100) {
    return `$${value.toFixed(2)}`;
  }
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatSymbol(symbol: string): string {
  if (symbol === 'ETHBTC') return 'ETH/BTC';
  if (symbol === 'BTCUSD') return 'BTC/USD';
  return symbol.replace('USDT', '/USDT');
}

function calcUnrealizedPnL(
  analysis: StoredAnalysis,
  currentPrice: number,
  btcUsdPrice: number,
) {
  if (!analysis.tradeSize) {
    const entry = analysis.levels.entry;
    const pctChange = ((currentPrice - entry) / entry) * 100;
    const directedPct = analysis.direction === 'HIGHER' ? pctChange : -pctChange;
    return { hasAmount: false as const, pct: directedPct };
  }

  const pnl = calcSpotPnL(
    analysis.direction,
    analysis.tradeSize,
    analysis.levels.entry,
    currentPrice,
    btcUsdPrice,
  );

  const entry = analysis.levels.entry;
  const pctChange = ((currentPrice - entry) / entry) * 100;
  const directedPct = analysis.direction === 'HIGHER' ? pctChange : -pctChange;

  return {
    hasAmount: true as const,
    pct: directedPct,
    netQuote: pnl.netQuote,
    netBtc: pnl.netBtc,
  };
}

interface AnalysisResultProps {
  analysis: StoredAnalysis | null;
  livePrice?: number | null;
  ledger: PortfolioLedger;
  btcUsdPrice: number;
  onSaveFeedback?: (id: string, feedback: string) => void;
  onConfirmTrade?: (
    id: string,
    levels: { entry: number; stopLoss: number; takeProfit: number },
    direction: Direction,
    tradeSize: TradeSize,
  ) => void;
  onRefuseTrade?: (id: string) => void;
  onCancelTrade?: (id: string, exitPrice: number) => void;
}

export function AnalysisResult({
  analysis,
  livePrice,
  ledger,
  btcUsdPrice,
  onSaveFeedback,
  onConfirmTrade,
  onRefuseTrade,
  onCancelTrade,
}: AnalysisResultProps) {
  const [feedbackDraft, setFeedbackDraft] = useState('');
  const [feedbackSaved, setFeedbackSaved] = useState(false);

  const [editEntry, setEditEntry] = useState('');
  const [editStopLoss, setEditStopLoss] = useState('');
  const [editTakeProfit, setEditTakeProfit] = useState('');
  const [editSize, setEditSize] = useState<TradeSize>(1);
  const [editDirection, setEditDirection] = useState<Direction>('HIGHER');
  const [levelsError, setLevelsError] = useState<string | null>(null);

  useEffect(() => {
    if (analysis?.levels) {
      setEditEntry(String(analysis.levels.entry));
      setEditStopLoss(String(analysis.levels.stopLoss));
      setEditTakeProfit(String(analysis.levels.takeProfit));
    }
    if (analysis?.direction) {
      setEditDirection(analysis.direction);
    }
    setEditSize(1);
    setLevelsError(null);
  }, [analysis?.id]);

  if (!analysis) {
    return (
      <div className="bg-gray-800/50 rounded-lg p-6 border border-gray-700">
        <h2 className="text-lg font-semibold text-gray-300 mb-4">Prediction</h2>
        <p className="text-gray-500 text-center py-8 text-sm">
          Upload a chart screenshot or describe your setup, then click
          &quot;Predict 0.5% Move&quot; to get a scalp prediction.
        </p>
      </div>
    );
  }

  const config = DIRECTION_CONFIG[analysis.direction];
  const outcomeConfig = OUTCOME_CONFIG[analysis.outcome ?? 'pending'];
  const time = new Date(analysis.timestamp).toLocaleTimeString();
  const ledgerEnabled = supportsLedger(analysis.symbol);
  const entryNum = parseFloat(editEntry) || analysis.levels.entry;
  const feeEstimate = ledgerEnabled ? estimateEntryFees(editSize, entryNum) : null;

  return (
    <div className="bg-gray-800/50 rounded-lg p-6 border border-gray-700 space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-300">Prediction</h2>
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${outcomeConfig.bg} ${outcomeConfig.color} ${analysis.outcome === 'pending' ? 'animate-pulse' : ''}`}>
          {outcomeConfig.emoji} {outcomeConfig.label}
          {analysis.outcomePrice !== undefined && analysis.outcome !== 'pending' && (
            <span className="ml-1 opacity-75">@ {formatPrice(analysis.outcomePrice, analysis.symbol)}</span>
          )}
        </span>
      </div>

      {ledgerEnabled && (
        <div className="bg-gray-900/50 rounded-lg p-3 flex items-center justify-between text-sm">
          <span className="text-gray-400">Portfolio (simulated)</span>
          <span className="text-white font-semibold">
            {ledger.balanceBtc.toFixed(6)} BTC
            <span className="text-gray-500 font-normal ml-2 text-xs">
              start {ledger.initialCapitalBtc} BTC
            </span>
          </span>
        </div>
      )}

      <div className="flex items-center gap-4">
        <span className="text-4xl">{config.emoji}</span>
        <div className="flex-1">
          <h3 className={`text-2xl font-bold ${config.color}`}>{config.label}</h3>
          <p className="text-gray-400 text-sm">
            {formatSymbol(analysis.symbol)} &middot; {time}
          </p>
        </div>
        <div className="text-right">
          <p className="text-3xl font-bold text-white">{analysis.probability}%</p>
          <p className="text-xs text-gray-400">probability</p>
        </div>
      </div>

      <div>
        <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${
              analysis.probability >= 70
                ? 'bg-emerald-500'
                : analysis.probability >= 50
                ? 'bg-yellow-500'
                : 'bg-red-500'
            }`}
            style={{ width: `${analysis.probability}%` }}
          />
        </div>
        {analysis.timeframeEstimate && (
          <p className="text-xs text-gray-400 mt-1.5">
            Expected timeframe: <span className="text-gray-300">{analysis.timeframeEstimate}</span>
          </p>
        )}
      </div>

      <div>
        <h4 className="text-sm font-medium text-gray-400 mb-2">AI Reasoning</h4>
        {analysis.analysis ? (
          <div className="space-y-2">
            {(['4h', '1h', '15m'] as const).map((tf) => {
              const a = analysis.analysis[tf];
              if (!a) return null;
              const label = tf.toUpperCase().replace('M', 'm');
              return (
                <div key={tf} className="bg-gray-900/50 rounded-lg p-3 border border-gray-700/50">
                  <h5 className="text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2">{label}</h5>
                  <ul className="space-y-1.5 text-sm text-gray-300">
                    <li className="flex gap-2">
                      <span className="text-gray-500 shrink-0">EMA</span>
                      <span className="leading-relaxed">{a.ema}</span>
                    </li>
                    <li className="flex gap-2">
                      <span className="text-gray-500 shrink-0">RSI</span>
                      <span className="leading-relaxed">{a.rsi}</span>
                    </li>
                    <li className="flex gap-2">
                      <span className="text-gray-500 shrink-0">DRO</span>
                      <span className="leading-relaxed">{a.dro}</span>
                    </li>
                  </ul>
                </div>
              );
            })}
            {analysis.conclusion && (
              <div className="bg-gray-900/50 rounded-lg p-3 border border-blue-800/30">
                <h5 className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-1">Conclusion</h5>
                <p className="text-sm text-gray-300 leading-relaxed">{analysis.conclusion}</p>
              </div>
            )}
          </div>
        ) : (
          <p className="text-gray-300 text-sm leading-relaxed bg-gray-900/50 rounded-lg p-4">
            {analysis.reasoning}
          </p>
        )}
      </div>

      {analysis.thesisFeedback && (
        <div>
          <h4 className="text-sm font-medium text-gray-400 mb-1.5">Feedback on Your Thesis</h4>
          <p className="text-gray-300 text-sm leading-relaxed bg-blue-900/20 border border-blue-800/40 rounded-lg p-4">
            {analysis.thesisFeedback}
          </p>
        </div>
      )}

      {analysis.keyRisk && (
        <div>
          <h4 className="text-sm font-medium text-gray-400 mb-1.5">Key Risk</h4>
          <p className="text-sm leading-relaxed bg-red-900/20 border border-red-800/40 rounded-lg p-4 text-red-300">
            {analysis.keyRisk}
          </p>
        </div>
      )}

      {analysis.tradeRecommendation && (
        <div className={`rounded-lg p-4 border ${
          analysis.tradeRecommendation === 'TAKE'
            ? 'bg-emerald-900/40 border-emerald-700'
            : analysis.tradeRecommendation === 'SKIP'
            ? 'bg-red-900/40 border-red-700'
            : 'bg-yellow-900/40 border-yellow-700'
        }`}>
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-lg font-bold ${
              analysis.tradeRecommendation === 'TAKE' ? 'text-emerald-400'
              : analysis.tradeRecommendation === 'SKIP' ? 'text-red-400'
              : 'text-yellow-400'
            }`}>
              {analysis.tradeRecommendation === 'TAKE' ? '✅ TAKE TRADE'
                : analysis.tradeRecommendation === 'SKIP' ? '🚫 SKIP'
                : '⏳ WAIT'}
            </span>
            {analysis.riskReward != null && (
              <span className="text-xs text-gray-400">R:R {analysis.riskReward.toFixed(2)}</span>
            )}
          </div>
          {analysis.recommendationReasoning && (
            <p className="text-sm text-gray-300">{analysis.recommendationReasoning}</p>
          )}
        </div>
      )}

      {analysis.direction !== 'UNCLEAR' && (
        <div className="space-y-3">
          {analysis.outcome === 'pending' && livePrice != null && (() => {
            const unrealized = calcUnrealizedPnL(analysis, livePrice, btcUsdPrice);
            const isUp = unrealized.pct >= 0;

            return (
              <div className="bg-blue-900/20 border border-blue-700/40 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" />
                    <span className="text-xs text-blue-300 font-medium">Live Price</span>
                  </div>
                  <span className="text-lg font-bold text-white">
                    {formatPrice(livePrice, analysis.symbol)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">Unrealized P&L (est.)</span>
                  <div className="text-right">
                    {unrealized.hasAmount ? (
                      <span className={`text-sm font-bold ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
                        {unrealized.netBtc >= 0 ? '+' : ''}{unrealized.netBtc.toFixed(6)} BTC
                        <span className="text-xs font-normal ml-1 opacity-75">
                          ({isUp ? '+' : ''}{unrealized.pct.toFixed(2)}%)
                        </span>
                      </span>
                    ) : (
                      <span className={`text-sm font-bold ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
                        {isUp ? '+' : ''}{unrealized.pct.toFixed(2)}%
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => onCancelTrade?.(analysis.id, livePrice)}
                  className="w-full py-2 bg-orange-600/80 hover:bg-orange-500 text-white text-sm font-semibold rounded-lg transition-colors cursor-pointer"
                >
                  Cancel Trade
                </button>
              </div>
            );
          })()}

          {analysis.outcome === 'review' ? (
            <>
              <p className="text-xs text-amber-400">
                Review levels, pick size, then confirm or refuse.
              </p>

              <div className="flex items-center gap-2">
                <span className="text-[10px] text-gray-400 uppercase tracking-wider">Direction</span>
                <button
                  type="button"
                  onClick={() => {
                    const newDir = editDirection === 'HIGHER' ? 'LOWER' : 'HIGHER';
                    setEditDirection(newDir);
                    setEditStopLoss(editTakeProfit);
                    setEditTakeProfit(editStopLoss);
                    setLevelsError(null);
                  }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors cursor-pointer border ${
                    editDirection === 'HIGHER'
                      ? 'bg-emerald-900/30 border-emerald-600/50 text-emerald-400 hover:bg-emerald-900/50'
                      : 'bg-red-900/30 border-red-600/50 text-red-400 hover:bg-red-900/50'
                  }`}
                >
                  {editDirection === 'HIGHER' ? '🟢' : '🔴'}
                  {editDirection}
                </button>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="bg-gray-900/50 rounded-lg p-3 text-center">
                  <label className="text-[10px] text-gray-400 uppercase tracking-wider mb-1 block">Entry</label>
                  <input
                    type="number"
                    step="any"
                    value={editEntry}
                    onChange={(e) => setEditEntry(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-center text-white text-sm font-semibold focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                  />
                </div>
                <div className="bg-gray-900/50 rounded-lg p-3 text-center">
                  <label className="text-[10px] text-gray-400 uppercase tracking-wider mb-1 block">Stop Loss</label>
                  <input
                    type="number"
                    step="any"
                    value={editStopLoss}
                    onChange={(e) => setEditStopLoss(e.target.value)}
                    className="w-full bg-gray-800 border border-red-700/50 rounded px-2 py-1.5 text-center text-red-400 text-sm font-semibold focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  />
                </div>
                <div className="bg-gray-900/50 rounded-lg p-3 text-center">
                  <label className="text-[10px] text-gray-400 uppercase tracking-wider mb-1 block">Take Profit</label>
                  <input
                    type="number"
                    step="any"
                    value={editTakeProfit}
                    onChange={(e) => setEditTakeProfit(e.target.value)}
                    className="w-full bg-gray-800 border border-emerald-700/50 rounded px-2 py-1.5 text-center text-emerald-400 text-sm font-semibold focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                  />
                </div>
              </div>

              {ledgerEnabled ? (
                <div className="bg-gray-900/50 rounded-lg p-3 space-y-2">
                  <label className="text-[10px] text-gray-400 uppercase tracking-wider block">
                    Size (OKX spot)
                  </label>
                  <select
                    value={editSize}
                    onChange={(e) => setEditSize(Number(e.target.value) as TradeSize)}
                    className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-white text-sm font-semibold focus:ring-2 focus:ring-amber-500"
                  >
                    {TRADE_SIZES.map((s) => (
                      <option key={s} value={s}>
                        {formatSizeLabel(s, analysis.symbol)}
                      </option>
                    ))}
                  </select>
                  {feeEstimate && (
                    <p className="text-[10px] text-gray-500">
                      Est. fees (market entry + limit exit @ entry):{' '}
                      <span className="text-gray-300">
                        {feeEstimate.entryFeeBase.toFixed(6)} {getSizeUnit(analysis.symbol)} + $
                        {feeEstimate.totalFeeQuote.toFixed(2)}
                      </span>
                      <span className="block mt-0.5 text-gray-600">
                        OKX EEA spot: taker 0.10% · maker 0.08%
                      </span>
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-gray-500">
                  OKX ledger available for BTC/USD and ETH/USDT only.
                </p>
              )}

              {levelsError && (
                <p className="text-xs text-red-400 bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2">
                  {levelsError}
                </p>
              )}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    const entry = parseFloat(editEntry);
                    const sl = parseFloat(editStopLoss);
                    const tp = parseFloat(editTakeProfit);

                    if (!entry || !sl || !tp || entry <= 0 || sl <= 0 || tp <= 0) {
                      setLevelsError('Entry, Stop Loss, and Take Profit must be valid positive numbers.');
                      return;
                    }

                    if (editDirection === 'HIGHER') {
                      if (sl >= entry) {
                        setLevelsError('HIGHER trade: Stop Loss must be below Entry.');
                        return;
                      }
                      if (tp <= entry) {
                        setLevelsError('HIGHER trade: Take Profit must be above Entry.');
                        return;
                      }
                    } else {
                      if (sl <= entry) {
                        setLevelsError('LOWER trade: Stop Loss must be above Entry.');
                        return;
                      }
                      if (tp >= entry) {
                        setLevelsError('LOWER trade: Take Profit must be below Entry.');
                        return;
                      }
                    }

                    if (!ledgerEnabled) {
                      setLevelsError('Confirm trade requires BTC/USD or ETH/USDT.');
                      return;
                    }

                    setLevelsError(null);
                    onConfirmTrade?.(
                      analysis.id,
                      { entry, stopLoss: sl, takeProfit: tp },
                      editDirection,
                      editSize,
                    );
                  }}
                  disabled={!ledgerEnabled}
                  className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors text-sm"
                >
                  Confirm Trade
                </button>
                <button
                  type="button"
                  onClick={() => onRefuseTrade?.(analysis.id)}
                  className="flex-1 py-2.5 bg-gray-700 hover:bg-gray-600 text-gray-300 font-semibold rounded-lg transition-colors text-sm"
                >
                  Refuse
                </button>
              </div>
            </>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-gray-900/50 rounded-lg p-3 text-center">
                <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-0.5">Entry</p>
                <p className="text-base font-semibold text-white">
                  {formatPrice(analysis.levels.entry, analysis.symbol)}
                </p>
              </div>
              <div className="bg-gray-900/50 rounded-lg p-3 text-center">
                <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-0.5">Stop Loss</p>
                <p className="text-base font-semibold text-red-400">
                  {formatPrice(analysis.levels.stopLoss, analysis.symbol)}
                </p>
              </div>
              <div className="bg-gray-900/50 rounded-lg p-3 text-center">
                <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-0.5">Take Profit</p>
                <p className="text-base font-semibold text-emerald-400">
                  {formatPrice(analysis.levels.takeProfit, analysis.symbol)}
                </p>
              </div>
              {analysis.tradeSize != null && (
                <div className="col-span-3 bg-gray-900/50 rounded-lg p-3 text-center">
                  <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-0.5">Size</p>
                  <p className="text-base font-semibold text-white">
                    {formatSizeLabel(analysis.tradeSize, analysis.symbol)}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {(analysis.outcome === 'won' || analysis.outcome === 'lost') && analysis.ledger?.closedAt && analysis.tradeSize && analysis.outcomePrice && (
        <div className="border-t border-gray-700 pt-4">
          <h4 className="text-sm font-medium text-gray-400 mb-2">P&L Breakdown (OKX spot)</h4>
          <div className="bg-gray-900/50 rounded-lg p-4 space-y-2 text-xs">
            <div className="flex justify-between text-gray-400">
              <span>Size</span>
              <span className="text-gray-300">{formatSizeLabel(analysis.tradeSize, analysis.symbol)}</span>
            </div>
            <div className="flex justify-between text-gray-400">
              <span>Entry / Exit</span>
              <span className="text-gray-300">
                {formatPrice(analysis.levels.entry, analysis.symbol)} → {formatPrice(analysis.outcomePrice, analysis.symbol)}
              </span>
            </div>
            <div className="flex justify-between text-gray-400">
              <span>Gross P&L</span>
              <span className={analysis.ledger.grossPnlQuote! >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                {analysis.ledger.grossPnlQuote! >= 0 ? '+' : ''}${analysis.ledger.grossPnlQuote!.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between text-gray-400">
              <span>Fees (taker + maker)</span>
              <span className="text-red-400">-${analysis.ledger.totalFeeQuote!.toFixed(2)}</span>
            </div>
            <div className="border-t border-gray-700 pt-2 flex justify-between text-sm font-semibold">
              <span className="text-gray-300">Net P&L</span>
              <span className={analysis.ledger.netPnlBtc! >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                {analysis.ledger.netPnlBtc! >= 0 ? '+' : ''}{analysis.ledger.netPnlBtc!.toFixed(6)} BTC
                <span className="text-xs font-normal ml-1 opacity-75">
                  (${analysis.ledger.netPnlQuote!.toFixed(2)})
                </span>
              </span>
            </div>
            <div className="flex justify-between text-gray-500">
              <span>Balance after</span>
              <span>{analysis.ledger.balanceBtcAfter!.toFixed(6)} BTC</span>
            </div>
          </div>
        </div>
      )}

      {analysis.outcome === 'lost' && (
        <div className="border-t border-gray-700 pt-4">
          <h4 className="text-sm font-medium text-red-400 mb-2">Lesson Learned</h4>
          {analysis.feedback ? (
            <div className="bg-red-900/15 border border-red-800/30 rounded-lg p-4">
              <p className="text-sm text-gray-300 leading-relaxed">{analysis.feedback}</p>
            </div>
          ) : (
            <div className="space-y-2">
              <textarea
                value={feedbackDraft}
                onChange={(e) => { setFeedbackDraft(e.target.value); setFeedbackSaved(false); }}
                placeholder="What went wrong?"
                rows={3}
                className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white text-sm placeholder-gray-500 focus:ring-2 focus:ring-red-500 resize-none"
              />
              <button
                type="button"
                onClick={() => {
                  if (feedbackDraft.trim() && onSaveFeedback) {
                    onSaveFeedback(analysis.id, feedbackDraft.trim());
                    setFeedbackSaved(true);
                  }
                }}
                disabled={!feedbackDraft.trim() || feedbackSaved}
                className="px-4 py-1.5 bg-red-600 hover:bg-red-500 disabled:bg-gray-700 text-white text-sm font-medium rounded-lg"
              >
                {feedbackSaved ? 'Saved' : 'Save Lesson'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
