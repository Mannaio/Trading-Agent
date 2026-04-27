import OpenAI from 'openai';
import type { Direction, SynthesisResult, TimeframeAnalysisResult } from '../types';

/**
 * SynthesisAgent — Agent 3 in the multi-agent pipeline.
 * Pure text reasoning: synthesizes all three timeframe analysis results,
 * user reasoning, and past lessons into a directional probability call.
 * Receives NO images.
 */
export class SynthesisAgent {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async synthesize(
    analyses: TimeframeAnalysisResult[],
    userReasoning: string,
    pastLessons: string[],
  ): Promise<SynthesisResult> {
    const completion = await this.client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: this.systemPrompt() },
        { role: 'user', content: this.buildUserMessage(analyses, userReasoning, pastLessons) },
      ],
      temperature: 0.15,
      max_tokens: 800,
      response_format: { type: 'json_object' },
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new SynthesisError('Empty response from model');

    return this.parseResponse(raw);
  }

  // ─── Build plain-text user message ───
  private buildUserMessage(
    analyses: TimeframeAnalysisResult[],
    userReasoning: string,
    pastLessons: string[],
  ): string {
    const lines: string[] = ['TIMEFRAME ANALYSES:'];

    for (const a of analyses) {
      const tfLabel = a.timeframe.toUpperCase().replace('M', 'm');
      const emaLine =
        a.emaGapPercent !== null
          ? `${a.emaBias}, gap ${a.emaGapPercent.toFixed(2)}% (${a.emaGapClassification})`
          : `${a.emaBias}, gap N/A% (${a.emaGapClassification})`;
      const rsiLine =
        a.rsiValue !== null ? `${a.rsiSignal} (${a.rsiValue})` : `${a.rsiSignal}`;
      const droLine =
        a.droCycleProgressPercent !== null
          ? `${a.droBias}, cycle ${a.droCycleProgressPercent}% complete`
          : `${a.droBias}, cycle unknown`;

      lines.push(
        `\n[${tfLabel}]`,
        `  Overall bias: ${a.overallBias} (confidence: ${a.confidence}%)`,
        `  EMA: ${emaLine}`,
        `  RSI: ${rsiLine}`,
        `  DRO: ${droLine}`,
        `  Summary: ${a.summary}`,
      );
    }

    if (userReasoning.trim()) {
      lines.push(`\nUSER'S THESIS:\n${userReasoning.trim()}`);
    }

    if (pastLessons.length > 0) {
      lines.push('\nPAST LESSONS FROM LOST TRADES:');
      for (const lesson of pastLessons) {
        lines.push(`• ${lesson}`);
      }
    }

    lines.push('\nSynthesize into an overall scalp direction prediction.');

    return lines.join('\n');
  }

  // ─── System prompt ───
  private systemPrompt(): string {
    return `You are a crypto scalp trading synthesis assistant. You receive interpreted indicator data from three timeframes (4H, 1H, 15m) and must synthesize them into a single directional probability call.

TIMEFRAME WEIGHTING
- 4H carries the most weight (macro trend). A bearish/bullish 4H bias strongly anchors the direction.
- 1H carries medium weight (intermediate trend confirmation).
- 15m carries the least weight (entry timing only — cannot override higher timeframes alone).

CONSENSUS REQUIREMENT
- Require at least 2 of 3 timeframes to agree for a high-confidence call (probability >65%).
- If only 1 timeframe agrees with the predicted direction, probability must stay 40–60%.

CONFLICT RULE
- If 4H and 1H disagree strongly → output direction: "UNCLEAR" with probability 40–55%.
- Exception: if 15m breaks the tie convincingly AND the resulting probability stays below 65%, you may call the 15m direction. Otherwise output UNCLEAR.

EMA EXHAUSTION SIGNAL
- Wide EMA gap + DRO cycle progress >90% = strong reversal signal.
- If this pattern appears on 2 or more timeframes simultaneously, increase confidence by 10–15 probability points.

PAST LESSONS
- If the current setup pattern matches a past lesson (same indicator state, same setup type), name the match explicitly in your conclusion and reduce probability by 10–15 points.

THESIS FEEDBACK
- Evaluate the user's reasoning against each timeframe's data. Agree or disagree honestly with evidence from the analysis.
- If the user provided no reasoning, set thesisFeedback to "".

PROBABILITY DEFINITION
- probability = likelihood (0–100) that a 0.5% move in the predicted direction happens BEFORE a 0.5% move in the opposite direction.
- A probability of 50 means genuine uncertainty. Do not inflate or deflate artificially.

GENUINE CONFLICT → UNCLEAR
- If signals genuinely conflict (e.g. 4H bullish, 1H bearish, 15m unclear), return direction: "UNCLEAR" with probability 40–55%.

RESPONSE FORMAT — respond ONLY with valid JSON:
{
  "direction": "HIGHER" | "LOWER" | "UNCLEAR",
  "probability": <integer 0-100>,
  "timeframeEstimate": "<estimated time for move, e.g. '5-15 minutes'>",
  "conclusion": "<concise synthesis of all timeframes and key signals, 2-4 sentences>",
  "thesisFeedback": "<evaluation of user's thesis, or empty string if no thesis provided>",
  "keyRisk": "<the most important scenario that would invalidate this prediction>"
}`;
  }

  // ─── Parse and validate JSON response ───
  private parseResponse(raw: string): SynthesisResult {
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new SynthesisError('Model returned invalid JSON');
    }

    const directionOptions: Direction[] = ['HIGHER', 'LOWER', 'UNCLEAR'];
    const direction: Direction = directionOptions.includes(json.direction as Direction)
      ? (json.direction as Direction)
      : 'UNCLEAR';

    const rawProbability = this.nullableNumber(json.probability);
    const probability =
      rawProbability !== null ? Math.max(0, Math.min(100, Math.round(rawProbability))) : 50;

    const timeframeEstimate =
      typeof json.timeframeEstimate === 'string' ? json.timeframeEstimate : '5-15 minutes';

    const conclusion = typeof json.conclusion === 'string' ? json.conclusion : '';
    const thesisFeedback = typeof json.thesisFeedback === 'string' ? json.thesisFeedback : '';
    const keyRisk = typeof json.keyRisk === 'string' ? json.keyRisk : '';

    return { direction, probability, timeframeEstimate, conclusion, thesisFeedback, keyRisk };
  }

  private nullableNumber(v: unknown): number | null {
    if (typeof v === 'number' && !isNaN(v)) return v;
    return null;
  }
}

export class SynthesisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SynthesisError';
  }
}
