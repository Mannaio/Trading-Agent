import OpenAI from 'openai';
import type { PolymarketRequest, RsiReport } from '../../polymarket/types';

/**
 * RsiAgent — RSI specialist in the Polymarket pipeline.
 * Vision-only analysis of the RSI pane on a 5-minute ETH chart.
 * Emits structured RsiReport — no UP/DOWN/SKIP trade calls.
 */
export class RsiAgent {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async analyze(req: PolymarketRequest): Promise<RsiReport> {
    const messages = this.buildMessages(req);

    const completion = await this.client.chat.completions.create({
      model: 'gpt-4o',
      messages,
      temperature: 0,
      max_tokens: 1500,
      response_format: { type: 'json_object' },
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new RsiAgentError('Empty response from model');

    return this.parseResponse(raw, req);
  }

  // ─── Build multi-modal messages ───
  private buildMessages(
    req: PolymarketRequest,
  ): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    const system: OpenAI.Chat.Completions.ChatCompletionSystemMessageParam = {
      role: 'system',
      content: this.systemPrompt(),
    };

    const userContent: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [];

    userContent.push({
      type: 'text',
      text: '5-minute ETH chart — analyze ONLY the RSI pane:',
    });
    userContent.push({
      type: 'image_url',
      image_url: { url: req.screenshot, detail: 'high' },
    });

    const meta = req.screenshotsMeta;

    if (typeof meta?.rsi === 'number') {
      userContent.push({
        type: 'text',
        text: `AUTHORITATIVE RSI (read from TradingView DOM — use this value exactly, do NOT override it from the image): ${meta.rsi}`,
      });
    }

    if (meta?.rsiCrop) {
      userContent.push({
        type: 'text',
        text: 'RSI legend crop (for visual reference only — the numeric value above is authoritative if provided):',
      });
      userContent.push({
        type: 'image_url',
        image_url: { url: meta.rsiCrop, detail: 'high' },
      });
    }

    const contextLines = [
      `Symbol: ${req.symbol}`,
      `Polymarket market window: ${req.marketWindow}`,
    ];
    if (req.notes?.trim()) {
      contextLines.push(`User notes: ${req.notes.trim()}`);
    }
    userContent.push({
      type: 'text',
      text: `${contextLines.join('. ')}. Return JSON matching RsiReport schema exactly.`,
    });

    return [system, { role: 'user', content: userContent }];
  }

  // ─── System prompt ───
  private systemPrompt(): string {
    return `You analyze ONLY the RSI pane on a 5-minute ETH chart.
Settings: RSI(2), close, SMA(14) smoothing. Divergence labels are OFF.

Your job is to describe RSI state — NOT to recommend trades.

ZONE (visual thresholds ~30 / 70 for RSI 2)
- "oversold": RSI line near or below the lower band (~30 or below)
- "overbought": RSI line near or above the upper band (~70 or above)
- "mid": RSI line between bands, not at an extreme

SLOPE
- "rising": RSI line trending upward over the last few bars
- "falling": RSI line trending downward over the last few bars
- "flat": RSI line roughly horizontal or choppy with no clear direction

EXTREME
- "peak": RSI shows a clear overbought spike (green fill / near upper band)
- "trough": RSI shows a clear oversold dip (red fill / near lower band)
- "none": otherwise (mid-range, no visible spike or trough)

ROOM TO MOVE
Judge whether the RSI line has travel before hitting the next band:
- "spike": mid/low RSI rising with clear path toward the upper band (~70)
- "drop": mid/high RSI rolling with clear path toward the lower band (~30)
- "both": meaningful room in both directions (not pinned)
- "none": pinned at 70/30 or otherwise little room to move

RSI VALUE
If the input contains "AUTHORITATIVE RSI (read from TradingView DOM — use this value exactly, do NOT override it from the image): X", use X verbatim.
Otherwise read from the RSI legend crop or chart. Return null if unreadable.

BIAS (indicator-only, not a trade call)
- "bullish": RSI structure favors upward mean reversion or bounce
- "bearish": RSI structure favors downward mean reversion or fade
- "neutral": mixed or unclear

roomConfidence: 0–100 integer — how confident you are in the roomToMove assessment.
marginNotes: brief notes on band proximity, fill color, or margin to next band.
caveats: array of strings listing any readability issues or ambiguities.

Do NOT recommend UP, DOWN, or SKIP.
Do NOT output trade calls or Polymarket directions.

RESPONSE FORMAT — respond ONLY with valid JSON:
{
  "rsiValue": <number or null>,
  "zone": "oversold" | "mid" | "overbought",
  "slope": "rising" | "falling" | "flat",
  "extreme": "peak" | "trough" | "none",
  "roomToMove": "spike" | "drop" | "both" | "none",
  "roomConfidence": <integer 0-100>,
  "marginNotes": "<string>",
  "bias": "bullish" | "bearish" | "neutral",
  "caveats": ["<string>", ...]
}`;
  }

  // ─── Parse JSON response ───
  private parseResponse(raw: string, req: PolymarketRequest): RsiReport {
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new RsiAgentError('Model returned invalid JSON');
    }

    const meta = req.screenshotsMeta;
    const rsiValue =
      typeof meta?.rsi === 'number' ? meta.rsi : this.nullableNumber(json.rsiValue);

    return {
      rsiValue,
      zone: this.parseZone(json.zone),
      slope: this.parseSlope(json.slope),
      extreme: this.parseExtreme(json.extreme),
      roomToMove: this.parseRoomToMove(json.roomToMove),
      roomConfidence: this.clampConfidence(json.roomConfidence),
      marginNotes: typeof json.marginNotes === 'string' ? json.marginNotes : '',
      bias: this.parseBias(json.bias),
      caveats: this.parseCaveats(json.caveats),
    };
  }

  private parseZone(v: unknown): RsiReport['zone'] {
    switch (v) {
      case 'oversold':
      case 'mid':
      case 'overbought':
        return v;
      default: {
        const _exhaustive: never = v as never;
        throw new RsiAgentError(`Invalid zone: ${String(_exhaustive)}`);
      }
    }
  }

  private parseSlope(v: unknown): RsiReport['slope'] {
    switch (v) {
      case 'rising':
      case 'falling':
      case 'flat':
        return v;
      default: {
        const _exhaustive: never = v as never;
        throw new RsiAgentError(`Invalid slope: ${String(_exhaustive)}`);
      }
    }
  }

  private parseExtreme(v: unknown): RsiReport['extreme'] {
    switch (v) {
      case 'peak':
      case 'trough':
      case 'none':
        return v;
      default: {
        const _exhaustive: never = v as never;
        throw new RsiAgentError(`Invalid extreme: ${String(_exhaustive)}`);
      }
    }
  }

  private parseRoomToMove(v: unknown): RsiReport['roomToMove'] {
    switch (v) {
      case 'spike':
      case 'drop':
      case 'both':
      case 'none':
        return v;
      default: {
        const _exhaustive: never = v as never;
        throw new RsiAgentError(`Invalid roomToMove: ${String(_exhaustive)}`);
      }
    }
  }

  private parseBias(v: unknown): RsiReport['bias'] {
    switch (v) {
      case 'bullish':
      case 'bearish':
      case 'neutral':
        return v;
      default: {
        const _exhaustive: never = v as never;
        throw new RsiAgentError(`Invalid bias: ${String(_exhaustive)}`);
      }
    }
  }

  private parseCaveats(v: unknown): string[] {
    if (!Array.isArray(v)) return [];
    return v.filter((item): item is string => typeof item === 'string');
  }

  private clampConfidence(v: unknown): number {
    const n = this.nullableNumber(v);
    if (n === null) return 0;
    return Math.max(0, Math.min(100, Math.round(n)));
  }

  private nullableNumber(v: unknown): number | null {
    if (typeof v === 'number' && !isNaN(v)) return v;
    return null;
  }
}

export class RsiAgentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RsiAgentError';
  }
}
