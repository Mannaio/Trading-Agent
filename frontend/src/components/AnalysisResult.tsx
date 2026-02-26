import { useState, useEffect } from 'react';
import type { StoredAnalysis, Direction } from '../types';
import { DIRECTION_CONFIG, OUTCOME_CONFIG } from '../types';

/** Format price with appropriate precision based on symbol and magnitude */
function formatPrice(value: number, symbol: string): string {
  // ETHBTC needs high precision, no $ prefix
  if (symbol === 'ETHBTC') {
    return value.toFixed(5);
  }

  // USDT pairs use $ prefix
  if (value < 100) {
    return `$${value.toFixed(2)}`;
  }
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Format symbol for display */
function formatSymbol(symbol: string): string {
  if (symbol === 'ETHBTC') return 'ETH/BTC';
  return symbol.replace('USDT', '/USDT');
}

const FEE_RATE = 0.001; // 0.1% per trade

/** Calculate P&L for a resolved trade */
function calcPnL(analysis: StoredAnalysis) {
  if (!analysis.tradeAmount || !analysis.outcomePrice) return null;

  const amount = analysis.tradeAmount;
  const entry = analysis.levels.entry;
  const exit = analysis.outcomePrice;

  // Gross P&L depends on direction
  const gross = analysis.direction === 'HIGHER'
    ? amount * (exit - entry)
    : amount * (entry - exit);

  // Fees: 0.1% on entry + 0.1% on exit (based on notional value)
  const entryFee = amount * entry * FEE_RATE;
  const exitFee = amount * exit * FEE_RATE;
  const totalFees = entryFee + exitFee;

  const net = gross - totalFees;

  return { gross, totalFees, net, amount, entry, exit };
}

/** Format a currency value for P&L display */
function formatPnL(value: number, symbol: string): string {
  const sign = value >= 0 ? '+' : '';
  if (symbol === 'ETHBTC') {
    return `${sign}${value.toFixed(6)} BTC`;
  }
  return `${sign}$${value.toFixed(2)}`;
}

/** Get the base asset label for the amount input */
function assetLabel(symbol: string): string {
  if (symbol === 'ETHBTC') return 'ETH';
  if (symbol === 'BTCUSDT') return 'BTC';
  return 'ETH';
}

/** Calculate unrealized P&L for a live trade given the current price */
function calcUnrealizedPnL(analysis: StoredAnalysis, currentPrice: number) {
  const entry = analysis.levels.entry;
  const pctChange = ((currentPrice - entry) / entry) * 100;
  const directedPct = analysis.direction === 'HIGHER' ? pctChange : -pctChange;

  if (!analysis.tradeAmount) {
    // No amount — return percentage only
    return { hasAmount: false as const, pct: directedPct };
  }

  const amount = analysis.tradeAmount;
  const gross = analysis.direction === 'HIGHER'
    ? amount * (currentPrice - entry)
    : amount * (entry - currentPrice);
  const entryFee = amount * entry * FEE_RATE;
  const exitFee = amount * currentPrice * FEE_RATE;
  const net = gross - entryFee - exitFee;

  return { hasAmount: true as const, pct: directedPct, gross, net };
}

interface AnalysisResultProps {
  analysis: StoredAnalysis | null;
  livePrice?: number | null;
  onSaveFeedback?: (id: string, feedback: string) => void;
  onConfirmTrade?: (id: string, levels: { entry: number; stopLoss: number; takeProfit: number }, direction: Direction, tradeAmount?: number) => void;
  onRefuseTrade?: (id: string) => void;
  onCancelTrade?: (id: string, exitPrice: number) => void;
}

export function AnalysisResult({ analysis, livePrice, onSaveFeedback, onConfirmTrade, onRefuseTrade, onCancelTrade }: AnalysisResultProps) {
  const [feedbackDraft, setFeedbackDraft] = useState('');
  const [feedbackSaved, setFeedbackSaved] = useState(false);

  // Editable levels for review mode
  const [editEntry, setEditEntry] = useState('');
  const [editStopLoss, setEditStopLoss] = useState('');
  const [editTakeProfit, setEditTakeProfit] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editDirection, setEditDirection] = useState<Direction>('HIGHER');
  const [levelsError, setLevelsError] = useState<string | null>(null);

  // Sync editable fields when a new analysis is selected
  useEffect(() => {
    if (analysis?.levels) {
      setEditEntry(String(analysis.levels.entry));
      setEditStopLoss(String(analysis.levels.stopLoss));
      setEditTakeProfit(String(analysis.levels.takeProfit));
    }
    if (analysis?.direction) {
      setEditDirection(analysis.direction);
    }
    // Amount always starts empty (no persist)
    setEditAmount('');
    setLevelsError(null);
  }, [analysis?.id]);

  if (!analysis) {
    return (
      <div className="bg-gray-800/50 rounded-lg p-6 border border-gray-700">
        <h2 className="text-lg font-semibold text-gray-300 mb-4">Prediction</h2>
        <p className="text-gray-500 text-center py-8 text-sm">
          Upload a chart screenshot or describe your setup, then click
          "Predict 0.5% Move" to get a scalp prediction.
        </p>
      </div>
    );
  }

  const config = DIRECTION_CONFIG[analysis.direction];
  const outcomeConfig = OUTCOME_CONFIG[analysis.outcome ?? 'pending'];
  const time = new Date(analysis.timestamp).toLocaleTimeString();

  return (
    <div className="bg-gray-800/50 rounded-lg p-6 border border-gray-700 space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-300">Prediction</h2>
        {/* Outcome Badge */}
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${outcomeConfig.bg} ${outcomeConfig.color} ${analysis.outcome === 'pending' ? 'animate-pulse' : ''}`}>
          {outcomeConfig.emoji} {outcomeConfig.label}
          {analysis.outcomePrice !== undefined && analysis.outcome !== 'pending' && (
            <span className="ml-1 opacity-75">@ {formatPrice(analysis.outcomePrice, analysis.symbol)}</span>
          )}
        </span>
      </div>

      {/* Direction + Probability */}
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

      {/* Probability Bar */}
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

      {/* AI Reasoning */}
      <div>
        <h4 className="text-sm font-medium text-gray-400 mb-1.5">AI Reasoning</h4>
        <p className="text-gray-300 text-sm leading-relaxed bg-gray-900/50 rounded-lg p-4">
          {analysis.reasoning}
        </p>
      </div>

      {/* Thesis Feedback */}
      {analysis.thesisFeedback && (
        <div>
          <h4 className="text-sm font-medium text-gray-400 mb-1.5">Feedback on Your Thesis</h4>
          <p className="text-gray-300 text-sm leading-relaxed bg-blue-900/20 border border-blue-800/40 rounded-lg p-4">
            {analysis.thesisFeedback}
          </p>
        </div>
      )}

      {/* Key Risk */}
      {analysis.keyRisk && (
        <div>
          <h4 className="text-sm font-medium text-gray-400 mb-1.5">Key Risk</h4>
          <p className="text-sm leading-relaxed bg-red-900/20 border border-red-800/40 rounded-lg p-4 text-red-300">
            {analysis.keyRisk}
          </p>
        </div>
      )}

      {/* Trade Levels */}
      {analysis.direction !== 'UNCLEAR' && (
        <div className="space-y-3">
          {/* Live price tracker + realtime P&L + cancel for pending trades */}
          {analysis.outcome === 'pending' && livePrice != null && (() => {
            const unrealized = calcUnrealizedPnL(analysis, livePrice);
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

                {/* Unrealized P&L */}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">Unrealized P&L</span>
                  <div className="text-right">
                    {unrealized.hasAmount ? (
                      <span className={`text-sm font-bold ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
                        {formatPnL(unrealized.net, analysis.symbol)}
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

                {/* Cancel Trade button */}
                <button
                  onClick={() => {
                    if (onCancelTrade) {
                      onCancelTrade(analysis.id, livePrice);
                    }
                  }}
                  className="w-full py-2 bg-orange-600/80 hover:bg-orange-500 text-white text-sm font-semibold rounded-lg transition-colors cursor-pointer"
                >
                  Cancel Trade
                </button>
              </div>
            );
          })()}

          {/* Review mode — editable levels */}
          {analysis.outcome === 'review' ? (
            <>
              <p className="text-xs text-amber-400">
                Review the AI levels below. Adjust if needed, then confirm or refuse.
              </p>

              {/* Direction toggle */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-gray-400 uppercase tracking-wider">Direction</span>
                <button
                  onClick={() => {
                    const newDir = editDirection === 'HIGHER' ? 'LOWER' : 'HIGHER';
                    setEditDirection(newDir);
                    // Auto-swap SL and TP when flipping direction
                    const oldSL = editStopLoss;
                    const oldTP = editTakeProfit;
                    setEditStopLoss(oldTP);
                    setEditTakeProfit(oldSL);
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
                  <span className="text-[10px] opacity-60 ml-1">(click to flip)</span>
                </button>
                {editDirection !== analysis.direction && (
                  <span className="text-[10px] text-amber-400">overridden from {analysis.direction}</span>
                )}
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

              {/* Trade Amount */}
              <div className="bg-gray-900/50 rounded-lg p-3">
                <label className="text-[10px] text-gray-400 uppercase tracking-wider mb-1 block">
                  Amount ({assetLabel(analysis.symbol)})
                </label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={editAmount}
                  onChange={(e) => setEditAmount(e.target.value)}
                  placeholder={`e.g. 0.2 ${assetLabel(analysis.symbol)}`}
                  className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-white text-sm font-semibold focus:ring-2 focus:ring-amber-500 focus:border-transparent placeholder-gray-500"
                />
                <p className="text-[10px] text-gray-500 mt-1">Optional — used for P&L calculation</p>
              </div>

              {/* Validation error */}
              {levelsError && (
                <p className="text-xs text-red-400 bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2">
                  {levelsError}
                </p>
              )}

              {/* Confirm / Refuse buttons */}
              <div className="flex gap-3">
                <button
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

                    setLevelsError(null);
                    if (onConfirmTrade) {
                      const amt = parseFloat(editAmount);
                      onConfirmTrade(
                        analysis.id,
                        { entry, stopLoss: sl, takeProfit: tp },
                        editDirection,
                        amt > 0 ? amt : undefined,
                      );
                    }
                  }}
                  className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg transition-colors text-sm"
                >
                  Confirm Trade
                </button>
                <button
                  onClick={() => {
                    if (onRefuseTrade) {
                      onRefuseTrade(analysis.id);
                    }
                  }}
                  className="flex-1 py-2.5 bg-gray-700 hover:bg-gray-600 text-gray-300 font-semibold rounded-lg transition-colors text-sm"
                >
                  Refuse
                </button>
              </div>
            </>
          ) : (
            /* Non-review — static levels */
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
            </div>
          )}
        </div>
      )}

      {/* P&L Breakdown — for resolved trades with a trade amount */}
      {(analysis.outcome === 'won' || analysis.outcome === 'lost' || analysis.outcome === 'cancelled') && (() => {
        const pnl = calcPnL(analysis);
        if (!pnl) return null;

        return (
          <div className="border-t border-gray-700 pt-4">
            <h4 className="text-sm font-medium text-gray-400 mb-2">P&L Breakdown</h4>
            <div className="bg-gray-900/50 rounded-lg p-4 space-y-2">
              <div className="flex justify-between text-xs text-gray-400">
                <span>Amount</span>
                <span className="text-gray-300">{pnl.amount} {assetLabel(analysis.symbol)}</span>
              </div>
              <div className="flex justify-between text-xs text-gray-400">
                <span>Entry</span>
                <span className="text-gray-300">{formatPrice(pnl.entry, analysis.symbol)}</span>
              </div>
              <div className="flex justify-between text-xs text-gray-400">
                <span>Exit</span>
                <span className="text-gray-300">{formatPrice(pnl.exit, analysis.symbol)}</span>
              </div>
              <div className="border-t border-gray-700 pt-2 flex justify-between text-xs text-gray-400">
                <span>Gross P&L</span>
                <span className={pnl.gross >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                  {formatPnL(pnl.gross, analysis.symbol)}
                </span>
              </div>
              <div className="flex justify-between text-xs text-gray-400">
                <span>Fees (0.1% x2)</span>
                <span className="text-red-400">
                  -{analysis.symbol === 'ETHBTC' ? pnl.totalFees.toFixed(6) + ' BTC' : '$' + pnl.totalFees.toFixed(2)}
                </span>
              </div>
              <div className="border-t border-gray-700 pt-2 flex justify-between text-sm font-semibold">
                <span className="text-gray-300">Net P&L</span>
                <span className={pnl.net >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                  {formatPnL(pnl.net, analysis.symbol)}
                </span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Lesson Learned — feedback for lost trades */}
      {analysis.outcome === 'lost' && (
        <div className="border-t border-gray-700 pt-4">
          <h4 className="text-sm font-medium text-red-400 mb-2">Lesson Learned</h4>
          {analysis.feedback ? (
            <div className="bg-red-900/15 border border-red-800/30 rounded-lg p-4">
              <p className="text-sm text-gray-300 leading-relaxed">{analysis.feedback}</p>
              <p className="text-[10px] text-gray-500 mt-2">This lesson will be used to improve future predictions.</p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-gray-500">
                What went wrong? Your feedback will be sent to the AI on future predictions so it learns from this mistake.
              </p>
              <textarea
                value={feedbackDraft}
                onChange={(e) => { setFeedbackDraft(e.target.value); setFeedbackSaved(false); }}
                placeholder='e.g. "Ignored the 4H overbought RSI divergence and entered too early before the 15m pullback completed."'
                rows={3}
                className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white text-sm placeholder-gray-500 focus:ring-2 focus:ring-red-500 focus:border-transparent resize-none"
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    if (feedbackDraft.trim() && onSaveFeedback) {
                      onSaveFeedback(analysis.id, feedbackDraft.trim());
                      setFeedbackSaved(true);
                    }
                  }}
                  disabled={!feedbackDraft.trim() || feedbackSaved}
                  className="px-4 py-1.5 bg-red-600 hover:bg-red-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
                >
                  {feedbackSaved ? 'Saved' : 'Save Lesson'}
                </button>
                {feedbackSaved && (
                  <span className="text-xs text-emerald-400">Lesson saved — the AI will learn from this.</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
