import OpenAI from 'openai';
import type { AnalysisRequest, ChartExtraction, Timeframe } from '../types';

/**
 * ChartExtractionAgent — Agent 1 in the multi-agent pipeline.
 * Pure OCR/vision step: reads raw numeric indicator values from chart images.
 * No interpretation, no prediction — numbers only.
 */
export class ChartExtractionAgent {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async extract(req: AnalysisRequest): Promise<ChartExtraction[]> {
    const messages = this.buildMessages(req);

    const completion = await this.client.chat.completions.create({
      model: 'gpt-4o',
      messages,
      temperature: 0,
      max_tokens: 1500,
      response_format: { type: 'json_object' },
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new ExtractionError('Empty response from model');

    return this.parseResponse(raw, req);
  }

  // ─── Build multi-modal messages ───
  private buildMessages(
    req: AnalysisRequest,
  ): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    const system: OpenAI.Chat.Completions.ChatCompletionSystemMessageParam = {
      role: 'system',
      content: this.systemPrompt(),
    };

    const userContent: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [];

    for (let i = 0; i < req.screenshots.length; i++) {
      const m = req.screenshotsMeta?.[i];
      const tfLabel = m?.timeframe ?? `chart_${i + 1}`;

      userContent.push({ type: 'text', text: `CHART ${i + 1} — Timeframe: ${tfLabel}` });
      userContent.push({
        type: 'image_url',
        image_url: { url: req.screenshots[i], detail: 'high' },
      });

      if (m?.rsiCrop) {
        userContent.push({ type: 'text', text: `RSI legend crop for ${tfLabel}:` });
        userContent.push({
          type: 'image_url',
          image_url: { url: m.rsiCrop, detail: 'high' },
        });
      }

      if (m?.droCrop) {
        userContent.push({ type: 'text', text: `DRO Alert pane crop for ${tfLabel}:` });
        userContent.push({
          type: 'image_url',
          image_url: { url: m.droCrop, detail: 'high' },
        });
      }

      if (m?.droPivot) {
        userContent.push({
          type: 'text',
          text: `User-confirmed DRO pivot for ${tfLabel}: ${m.droPivot}`,
        });
      }
    }

    userContent.push({
      type: 'text',
      text: `Symbol: ${req.symbol}. Extract raw indicator values only. Return JSON.`,
    });

    return [system, { role: 'user', content: userContent }];
  }

  // ─── System prompt ───
  private systemPrompt(): string {
    return `You are a chart data extraction assistant. Your ONLY job is to read numbers from trading chart images. Do NOT interpret, predict, or draw any conclusions. Extract raw values exactly as displayed.

For each chart provided, extract the following fields and return them in a JSON object with a "charts" array.

EMA VALUES
Read from the chart header legend line. The legend typically reads like:
  "RSI2 (2, 200, 50, EMA, ...) 0.02981 0.03000"
The first numeric value after the indicator params = EMA 200, the second = EMA 50.
Return null for either if not readable.

RSI VALUE
If an RSI legend crop image is provided, read the value from it (e.g. "RSI 2 close 52.96" → 52.96).
If no crop is provided, attempt to read from the chart directly.
Return null if not readable.

DRO PIVOT (rightmostCycleNumberBelowZero)
If the input for this chart contains "User-confirmed DRO pivot for ... : LOW" → true (LOW = below zero = bullish).
If "User-confirmed DRO pivot for ... : HIGH" → false.
Otherwise, look at the DRO Alert pane crop (if provided):
  - Find the RIGHTMOST cycle number on the zigzag dotted line (NOT the "Mean: N" green box — ignore the Mean for direction).
  - If that number is BELOW the 0 axis → true. If ABOVE → false. If genuinely unclear → null.

DRO CYCLE NUMBER (rightmostCycleNumber)
Read the numeric value of the rightmost cycle number on the zigzag dotted line in the DRO pane.
Return null if not visible.

DRO MEAN
Read the number from the green "Mean: N" box on the DRO pane.
Return null if not visible.

BARS SINCE PIVOT (barsSincePivot)
Count the number of bars from the rightmost pivot turning point to the right edge of the chart.
Do NOT use the numbers printed between past pivots — those are completed cycle lengths.
Return null if not countable.

CURRENT PRICE (currentPrice)
Read the last candle's close price or the price scale value at the rightmost bar.
Return null if not readable.

EXTRACTION CONFIDENCE
"high" — all key values (EMA, RSI, DRO direction, currentPrice) are readable.
"medium" — 1–2 key values are uncertain or null.
"low" — most key values are null or unreadable.

RESPONSE FORMAT — respond ONLY with valid JSON:
{
  "charts": [
    {
      "timeframe": "<timeframe string from label, e.g. '4h'>",
      "ema50": <number or null>,
      "ema200": <number or null>,
      "rsi": <number or null>,
      "dro": {
        "rightmostCycleNumberBelowZero": <boolean or null>,
        "rightmostCycleNumber": <number or null>,
        "mean": <number or null>,
        "barsSincePivot": <number or null>
      },
      "currentPrice": <number or null>,
      "extractionConfidence": "high" | "medium" | "low"
    }
  ]
}

Return one object per chart in the order they were provided. If the entire DRO block is unreadable, set "dro" to null.`;
  }

  // ─── Parse JSON response ───
  private parseResponse(raw: string, req: AnalysisRequest): ChartExtraction[] {
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new ExtractionError('Model returned invalid JSON');
    }

    const modelCharts = Array.isArray(json.charts) ? json.charts : [];
    const count = req.screenshots.length;
    const results: ChartExtraction[] = [];

    for (let i = 0; i < count; i++) {
      const c = (modelCharts[i] ?? {}) as Record<string, unknown>;
      const meta = req.screenshotsMeta?.[i];

      const timeframe = this.resolveTimeframe(meta?.timeframe, c.timeframe);
      const ema50 = this.nullableNumber(c.ema50);
      const ema200 = this.nullableNumber(c.ema200);
      const rsi = this.nullableNumber(c.rsi);
      const currentPrice = this.nullableNumber(c.currentPrice);
      const extractionConfidence = this.resolveConfidence(c.extractionConfidence);
      const dro = this.parseDro(c.dro);

      results.push({ timeframe, ema50, ema200, rsi, dro, currentPrice, extractionConfidence });
    }

    return results;
  }

  private resolveTimeframe(metaTf: Timeframe | undefined, modelTf: unknown): Timeframe {
    if (metaTf) return metaTf;
    const valid: Timeframe[] = ['4h', '1h', '15m'];
    if (typeof modelTf === 'string' && valid.includes(modelTf as Timeframe)) {
      return modelTf as Timeframe;
    }
    return '15m';
  }

  private resolveConfidence(v: unknown): 'high' | 'medium' | 'low' {
    if (v === 'high' || v === 'medium' || v === 'low') return v;
    return 'low';
  }

  private nullableNumber(v: unknown): number | null {
    if (typeof v === 'number' && !isNaN(v)) return v;
    return null;
  }

  private parseDro(v: unknown): ChartExtraction['dro'] {
    if (!v || typeof v !== 'object') return null;
    const d = v as Record<string, unknown>;

    const rightmostCycleNumberBelowZero = this.nullableBoolean(d.rightmostCycleNumberBelowZero);
    const rightmostCycleNumber = this.nullableNumber(d.rightmostCycleNumber);
    const mean = this.nullableNumber(d.mean);
    const barsSincePivot = this.nullableNumber(d.barsSincePivot);

    // If all fields are null, treat block as unreadable
    if (
      rightmostCycleNumberBelowZero === null &&
      rightmostCycleNumber === null &&
      mean === null &&
      barsSincePivot === null
    ) {
      return null;
    }

    return { rightmostCycleNumberBelowZero, rightmostCycleNumber, mean, barsSincePivot };
  }

  private nullableBoolean(v: unknown): boolean | null {
    if (typeof v === 'boolean') return v;
    return null;
  }
}

export class ExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExtractionError';
  }
}
