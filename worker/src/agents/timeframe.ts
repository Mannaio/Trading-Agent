import OpenAI from 'openai';
import type { ChartExtraction, Timeframe, TimeframeAnalysisResult } from '../types';

/**
 * TimeframeAnalysisAgent — Agent 2 in the multi-agent pipeline.
 * Text-only interpretation of a single timeframe's extracted indicator data.
 * Run three instances in parallel via Promise.all — one per timeframe.
 */
export class TimeframeAnalysisAgent {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  /** Analyze a single timeframe. Run three of these in parallel with Promise.all. */
  async analyze(extraction: ChartExtraction): Promise<TimeframeAnalysisResult> {
    const completion = await this.client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: this.systemPrompt() },
        { role: 'user', content: this.buildUserMessage(extraction) },
      ],
      temperature: 0.1,
      max_tokens: 600,
      response_format: { type: 'json_object' },
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new TimeframeAnalysisError('Empty response from model');

    return this.parseResponse(raw, extraction.timeframe);
  }

  // ─── Build plain-text user message from ChartExtraction ───
  private buildUserMessage(e: ChartExtraction): string {
    const tfLabel = e.timeframe.toUpperCase().replace('M', 'm');
    const ema50 = e.ema50 !== null ? e.ema50 : 'N/A';
    const ema200 = e.ema200 !== null ? e.ema200 : 'N/A';
    const rsi = e.rsi !== null ? e.rsi : 'N/A';

    let droDirection = 'unclear';
    let droMean = 'N/A';
    let droBarsSince = 'N/A';
    let droProgress = 'unknown';

    if (e.dro !== null) {
      if (e.dro.rightmostCycleNumberBelowZero === true) {
        droDirection = 'LOW pivot (bullish, heading up)';
      } else if (e.dro.rightmostCycleNumberBelowZero === false) {
        droDirection = 'HIGH pivot (bearish, heading down)';
      }

      if (e.dro.mean !== null) droMean = String(e.dro.mean);
      if (e.dro.barsSincePivot !== null) droBarsSince = String(e.dro.barsSincePivot);

      if (e.dro.barsSincePivot !== null && e.dro.mean !== null) {
        droProgress = Math.round((e.dro.barsSincePivot / e.dro.mean) * 100) + '%';
      }
    }

    return `Timeframe: ${tfLabel}
EMA 50: ${ema50}
EMA 200: ${ema200}
RSI: ${rsi}
DRO last pivot direction: ${droDirection}
DRO Mean (half-cycle): ${droMean} bars
DRO bars since last pivot: ${droBarsSince}
DRO cycle progress: ${droProgress}
Extraction confidence: ${e.extractionConfidence}

Analyze this single timeframe.`;
  }

  // ─── System prompt ───
  private systemPrompt(): string {
    return `You are a technical analysis assistant. Your job is to interpret indicator data for a single timeframe and report what the indicators show — WITHOUT making a trade direction call.

CRITICAL RULE: DO NOT say this trade should be LONG or SHORT. Do not recommend a trading action. That is done by a separate Synthesis Agent. Your job is only to interpret what each indicator shows.

ANALYSIS RULES

EMA GAP
Compute: |EMA50 - EMA200| / min(EMA50, EMA200) × 100
Classify strictly:
  - tight: gap < 1%
  - moderate: gap 1–3%
  - wide: gap > 3%
Return the computed percentage as emaGapPercent (number). If EMA values are unavailable, return null.
emaBias: "bullish" if EMA50 > EMA200, "bearish" if EMA50 < EMA200, "neutral" if equal or unavailable.

RSI
  - rsiSignal: "overbought" if RSI > 70, "oversold" if RSI < 30, "neutral" otherwise
  - rsiValue: the numeric RSI value, or null if N/A

DRO
  - droBias: "bullish" if last pivot is LOW, "bearish" if HIGH, "unclear" if neither
  - droCycleProgressPercent: integer percentage from the cycle progress field, or null if unknown
  Cycle progress interpretation:
    - >100%: overdue for reversal
    - 80–100%: approaching pivot
    - 50–80%: mid-to-late cycle
    - <50%: mid-cycle

CONFIDENCE (0–100)
Start at 100. Deduct 15 for each of the following that is null/N/A:
  - EMA50
  - EMA200
  - RSI
  - DRO direction (unclear counts as null)
Deduct additional 20 if extractionConfidence is "low".
Clamp result to 0–100.

OVERALL BIAS
Summarize across EMA, RSI, and DRO. Use "bullish", "bearish", or "unclear" if signals conflict or are insufficient.

RESPONSE FORMAT — respond ONLY with valid JSON:
{
  "emaBias": "bullish" | "bearish" | "neutral",
  "emaGapClassification": "tight" | "moderate" | "wide",
  "emaGapPercent": <number or null>,
  "rsiSignal": "overbought" | "oversold" | "neutral",
  "rsiValue": <number or null>,
  "droBias": "bullish" | "bearish" | "unclear",
  "droCycleProgressPercent": <integer or null>,
  "overallBias": "bullish" | "bearish" | "unclear",
  "confidence": <integer 0-100>,
  "summary": "<one concise sentence describing what the indicators show, no trade direction>",
  "ema": "<brief EMA description, e.g. 'EMA50: 0.02981, EMA200: 0.03000, gap: 1.16% (moderate), death cross'>",
  "rsi": "<brief RSI description>",
  "dro": "<brief DRO description>"
}`;
  }

  // ─── Parse and validate JSON response ───
  private parseResponse(raw: string, tf: Timeframe): TimeframeAnalysisResult {
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new TimeframeAnalysisError('Model returned invalid JSON');
    }

    const emaBiasOptions = ['bullish', 'bearish', 'neutral'] as const;
    const emaBias = emaBiasOptions.includes(json.emaBias as (typeof emaBiasOptions)[number])
      ? (json.emaBias as 'bullish' | 'bearish' | 'neutral')
      : 'neutral';

    const emaGapClassOptions = ['tight', 'moderate', 'wide'] as const;
    const emaGapClassification = emaGapClassOptions.includes(
      json.emaGapClassification as (typeof emaGapClassOptions)[number],
    )
      ? (json.emaGapClassification as 'tight' | 'moderate' | 'wide')
      : 'tight';

    const emaGapPercent = this.nullableNumber(json.emaGapPercent);

    const rsiSignalOptions = ['overbought', 'oversold', 'neutral'] as const;
    const rsiSignal = rsiSignalOptions.includes(json.rsiSignal as (typeof rsiSignalOptions)[number])
      ? (json.rsiSignal as 'overbought' | 'oversold' | 'neutral')
      : 'neutral';

    const rsiValue = this.nullableNumber(json.rsiValue);

    const droBiasOptions = ['bullish', 'bearish', 'unclear'] as const;
    const droBias = droBiasOptions.includes(json.droBias as (typeof droBiasOptions)[number])
      ? (json.droBias as 'bullish' | 'bearish' | 'unclear')
      : 'unclear';

    const droCycleProgressPercent = this.nullableNumber(json.droCycleProgressPercent);

    const overallBiasOptions = ['bullish', 'bearish', 'unclear'] as const;
    const overallBias = overallBiasOptions.includes(
      json.overallBias as (typeof overallBiasOptions)[number],
    )
      ? (json.overallBias as 'bullish' | 'bearish' | 'unclear')
      : 'unclear';

    const rawConfidence = this.nullableNumber(json.confidence);
    const confidence =
      rawConfidence !== null ? Math.max(0, Math.min(100, Math.round(rawConfidence))) : 50;

    const summary = typeof json.summary === 'string' ? json.summary : '';
    const ema = typeof json.ema === 'string' ? json.ema : 'N/A';
    const rsi = typeof json.rsi === 'string' ? json.rsi : 'N/A';
    const dro = typeof json.dro === 'string' ? json.dro : 'N/A';

    return {
      timeframe: tf,
      emaBias,
      emaGapClassification,
      emaGapPercent,
      rsiSignal,
      rsiValue,
      droBias,
      droCycleProgressPercent,
      overallBias,
      confidence,
      summary,
      ema,
      rsi,
      dro,
    };
  }

  private nullableNumber(v: unknown): number | null {
    if (typeof v === 'number' && !isNaN(v)) return v;
    return null;
  }
}

export class TimeframeAnalysisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeframeAnalysisError';
  }
}
