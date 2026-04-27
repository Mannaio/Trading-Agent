import OpenAI from 'openai';
import type { PortfolioContext, StrategyResult, SynthesisResult, Symbol } from '../types';

/**
 * StrategyAgent — Agent 4 in the multi-agent trading pipeline.
 * Pure text reasoning: given a SynthesisResult and market context, produces
 * precise trade levels (entry/SL/TP), R:R, TAKE/SKIP/WAIT recommendation,
 * and optional position sizing.
 */
export class StrategyAgent {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async plan(
    synthesis: SynthesisResult,
    symbol: Symbol,
    currentPrice: number | null,
    portfolioContext?: PortfolioContext,
  ): Promise<StrategyResult> {
    const priceRef =
      currentPrice ??
      (symbol === 'BTCUSDT' ? 95000 : symbol === 'ETHBTC' ? 0.0265 : 2500);

    const completion = await this.client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: this.systemPrompt() },
        { role: 'user', content: this.buildUserMessage(synthesis, symbol, priceRef, portfolioContext) },
      ],
      temperature: 0.1,
      max_tokens: 600,
      response_format: { type: 'json_object' },
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new StrategyError('Empty response from model');

    return this.parseResponse(raw, synthesis, symbol, priceRef);
  }

  // ─── Build plain-text user message ───
  private buildUserMessage(
    s: SynthesisResult,
    symbol: Symbol,
    priceRef: number,
    p?: PortfolioContext,
  ): string {
    const lines: string[] = [
      'SYNTHESIS RESULT:',
      `Direction: ${s.direction}`,
      `Probability: ${s.probability}%`,
      `Timeframe estimate: ${s.timeframeEstimate}`,
      `Key risk: ${s.keyRisk}`,
      '',
      'MARKET:',
      `Symbol: ${symbol}`,
      `Current price: ${priceRef}`,
    ];

    if (p && p.portfolioSizeUsd > 0) {
      const prob = s.probability;
      const band: '75+' | '65-75' | '55-65' =
        prob >= 75 ? '75+' : prob >= 65 ? '65-75' : '55-65';

      const bandRateRaw = p.winRateByProbabilityBand[band];
      const bandRateStr =
        bandRateRaw === null
          ? 'insufficient data (< 3 trades)'
          : `${(bandRateRaw * 100).toFixed(0)}%`;

      lines.push(
        '',
        'PORTFOLIO CONTEXT:',
        `Portfolio size: $${p.portfolioSizeUsd}`,
        `Max risk per trade: ${p.maxRiskPerTradePercent}%`,
        `Historical win rate overall: ${(p.winRate * 100).toFixed(0)}% (${p.totalTrades} trades)`,
        `Historical win rate for ${band}% probability trades: ${bandRateStr}`,
        `Recent streak: ${p.recentStreak}`,
      );
    }

    lines.push('', 'Provide the trade strategy.');

    return lines.join('\n');
  }

  // ─── System prompt ───
  private systemPrompt(): string {
    return `You are a crypto scalp trading strategy assistant. Given a synthesis result and market context, produce precise trade levels and a recommendation.

STOP-LOSS AND TAKE-PROFIT RULES
- Stop-loss: place 0.4–0.6% from entry (in the direction against the trade).
- Take-profit: place 0.5–0.7% from entry (in the direction of the trade).
- Target R:R ≥ 1.0 (risk:reward ratio = TP distance / SL distance).

ETHBTC PRECISION
- For ETHBTC (price ~0.026), use 5 decimal places. A 0.5% move ≈ 0.00013.
- Entry, SL, and TP must differ by at least 0.00013.

TRADE RECOMMENDATION
- "TAKE": probability ≥ 65% AND R:R ≥ 1.0 AND (no portfolio context provided OR historical band win rate ≥ 50% OR overall win rate ≥ 50%).
- "SKIP": probability < 60% OR direction is UNCLEAR OR (portfolio context is provided AND historical band win rate for this probability band < 40%).
- "WAIT": everything else — marginal setup (probability 60–65%, R:R slightly below 1.0, or a losing streak).

POSITION SIZING (only when portfolio size is provided)
- maxRisk$ = portfolioSizeUsd × (maxRiskPerTradePercent / 100)
- positionSize$ = maxRisk$ / (SL distance as a fraction of entry, e.g. 0.005 for 0.5%)
- Reduce position by 50% if recentStreak includes 3 or more losses OR historical band win rate < 50%.
- Cap position at 10% of portfolio.
- Round suggestedPositionSizeUsd to nearest $10.
- suggestedPositionSizePercent = (positionSizeUsd / portfolioSizeUsd) × 100, rounded to 1 decimal.
- If no portfolio context: set both to null.

RECOMMENDATION REASONING
- Provide 1–2 sentences explaining the TAKE/SKIP/WAIT decision and position size logic.

RESPONSE FORMAT — respond ONLY with valid JSON:
{
  "entry": <number>,
  "stopLoss": <number>,
  "takeProfit": <number>,
  "riskReward": <number, 2 decimal places>,
  "suggestedPositionSizeUsd": <number | null>,
  "suggestedPositionSizePercent": <number | null>,
  "tradeRecommendation": "TAKE" | "SKIP" | "WAIT",
  "recommendationReasoning": "<string>"
}`;
  }

  // ─── Parse and validate JSON response ───
  private parseResponse(
    raw: string,
    synthesis: SynthesisResult,
    symbol: Symbol,
    priceRef: number,
  ): StrategyResult {
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new StrategyError('Model returned invalid JSON');
    }

    const entry = this.roundPrice(json.entry, priceRef);

    const slFallback =
      synthesis.direction === 'LOWER' ? priceRef * 1.005 : priceRef * 0.995;
    const tpFallback =
      synthesis.direction === 'LOWER' ? priceRef * 0.995 : priceRef * 1.005;

    let stopLoss = this.roundPrice(json.stopLoss, slFallback);
    let takeProfit = this.roundPrice(json.takeProfit, tpFallback);

    // Enforce minimum 0.3% separation between entry and SL/TP
    const minSep = entry * 0.003;
    if (Math.abs(stopLoss - entry) < minSep) {
      stopLoss = this.roundPrice(slFallback, slFallback);
    }
    if (Math.abs(takeProfit - entry) < minSep) {
      takeProfit = this.roundPrice(tpFallback, tpFallback);
    }

    const slDist = Math.abs(stopLoss - entry);
    const tpDist = Math.abs(takeProfit - entry);
    const riskReward =
      slDist > 0
        ? parseFloat((tpDist / slDist).toFixed(2))
        : this.safeNumber(json.riskReward, 1.0, 2);

    const suggestedPositionSizeUsd =
      typeof json.suggestedPositionSizeUsd === 'number' &&
      !isNaN(json.suggestedPositionSizeUsd)
        ? json.suggestedPositionSizeUsd
        : null;

    const suggestedPositionSizePercent =
      typeof json.suggestedPositionSizePercent === 'number' &&
      !isNaN(json.suggestedPositionSizePercent)
        ? json.suggestedPositionSizePercent
        : null;

    const validRecommendations: Array<'TAKE' | 'SKIP' | 'WAIT'> = ['TAKE', 'SKIP', 'WAIT'];
    const tradeRecommendation: 'TAKE' | 'SKIP' | 'WAIT' = validRecommendations.includes(
      json.tradeRecommendation as 'TAKE' | 'SKIP' | 'WAIT',
    )
      ? (json.tradeRecommendation as 'TAKE' | 'SKIP' | 'WAIT')
      : 'WAIT';

    const recommendationReasoning =
      typeof json.recommendationReasoning === 'string'
        ? json.recommendationReasoning
        : '';

    // Suppress unused symbol warning — kept for future per-symbol validation
    void symbol;

    return {
      entry,
      stopLoss,
      takeProfit,
      riskReward,
      suggestedPositionSizeUsd,
      suggestedPositionSizePercent,
      tradeRecommendation,
      recommendationReasoning,
    };
  }

  private roundPrice(v: unknown, fallback: number): number {
    const val = typeof v === 'number' && v > 0 && !isNaN(v) ? v : fallback;
    if (val < 1) return Math.round(val * 1_000_000) / 1_000_000;
    return Math.round(val * 100) / 100;
  }

  private safeNumber(v: unknown, fallback: number, decimals: number): number {
    if (typeof v !== 'number' || isNaN(v)) return fallback;
    const factor = Math.pow(10, decimals);
    return Math.round(v * factor) / factor;
  }
}

export class StrategyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StrategyError';
  }
}
