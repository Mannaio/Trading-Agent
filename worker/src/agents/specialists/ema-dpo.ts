import OpenAI from 'openai';
import type { EmaDpoReport, PolymarketRequest } from '../../polymarket/types';

/**
 * EmaDpoAgent — EMA + DPO specialist in the Polymarket pipeline.
 * Vision-only analysis of the price pane (EMA 50/200) and DPO zig-zag swings.
 * Emits structured EmaDpoReport — no UP/DOWN/SKIP trade calls.
 */
export class EmaDpoAgent {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async analyze(req: PolymarketRequest): Promise<EmaDpoReport> {
    const messages = this.buildMessages(req);

    const completion = await this.client.chat.completions.create({
      model: 'gpt-4o',
      messages,
      temperature: 0,
      max_tokens: 1500,
      response_format: { type: 'json_object' },
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new EmaDpoAgentError('Empty response from model');

    return this.parseResponse(raw);
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
      text: '5-minute ETH chart — analyze the price pane (EMA 50 / EMA 200) and DPO zig-zag swing distances:',
    });
    userContent.push({
      type: 'image_url',
      image_url: { url: req.screenshot, detail: 'high' },
    });

    const contextLines = [
      `Symbol: ${req.symbol}`,
      `Polymarket market window: ${req.marketWindow}`,
    ];
    if (req.notes?.trim()) {
      contextLines.push(`User notes: ${req.notes.trim()}`);
    }
    userContent.push({
      type: 'text',
      text: `${contextLines.join('. ')}. Return JSON matching EmaDpoReport schema exactly.`,
    });

    return [system, { role: 'user', content: userContent }];
  }

  // ─── System prompt ───
  private systemPrompt(): string {
    return `You analyze the price pane on a 5-minute ETH chart with EMA 50 and EMA 200 overlays,
plus the DPO (Detrended Price Oscillator) zig-zag tool showing swing distances on price.
Your job is to describe EMA structure and DPO swing context — NOT to recommend trades.

EMA BIAS (structure only — not a trade call)
- "bullish": EMA 50 above EMA 200, or price holding above both with upward slope
- "bearish": EMA 50 below EMA 200, or price holding below both with downward slope
- "neutral": flat/crossed EMAs, choppy overlap, or unclear

EMA GAP (distance between EMA 50 and EMA 200)
- "tight": EMAs close together (recent cross or consolidation)
- "moderate": visible separation but not stretched
- "wide": EMAs clearly separated with sustained trend

PRICE VS EMA (current price relative to EMA 50 and EMA 200)
- "extended_above": price notably above both EMAs (stretched upward)
- "between": price between EMA 50 and EMA 200, or hugging the band
- "extended_below": price notably below both EMAs (stretched downward)
- "unclear": price/EMA relationship unreadable

DPO SWING (zig-zag tool on price pane)
Read the DPO zig-zag labels or measure visually:
- lastHighHighDistance: numeric distance between the last two High pivots (High–High), or null if unreadable
- lastLowLowDistance: numeric distance between the last two Low pivots (Low–Low), or null if unreadable
- interpretation: describe swing symmetry, cycle length, or trend of distances if numbers are not readable

SUPPORTS CALL (alignment flag — NOT a direction)
Assess whether EMA structure and DPO swings together support taking a directional Polymarket bet.
You do NOT choose UP or DOWN — only flag structural alignment:
- "yes": EMA bias and DPO swing context align cleanly; structure supports a directional call
- "no": conflicting EMA/DPO signals, stretched against trend, or poor swing structure — soft veto
- "neutral": mixed, unclear, or insufficient data

notes: brief notes on EMA cross timing, gap trend, price extension, DPO cycle, or readability issues.

Do NOT recommend UP, DOWN, or SKIP.
Do NOT output trade calls or Polymarket directions.

RESPONSE FORMAT — respond ONLY with valid JSON:
{
  "emaBias": "bullish" | "bearish" | "neutral",
  "emaGap": "tight" | "moderate" | "wide",
  "priceVsEma": "extended_above" | "between" | "extended_below" | "unclear",
  "dpoSwing": {
    "lastHighHighDistance": <number or null>,
    "lastLowLowDistance": <number or null>,
    "interpretation": "<string>"
  },
  "supportsCall": "yes" | "no" | "neutral",
  "notes": "<string>"
}`;
  }

  // ─── Parse JSON response ───
  private parseResponse(raw: string): EmaDpoReport {
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new EmaDpoAgentError('Model returned invalid JSON');
    }

    const dpoSwingRaw =
      typeof json.dpoSwing === 'object' && json.dpoSwing !== null
        ? (json.dpoSwing as Record<string, unknown>)
        : {};

    return {
      emaBias: this.parseEmaBias(json.emaBias),
      emaGap: this.parseEmaGap(json.emaGap),
      priceVsEma: this.parsePriceVsEma(json.priceVsEma),
      dpoSwing: {
        lastHighHighDistance: this.nullableNumber(dpoSwingRaw.lastHighHighDistance),
        lastLowLowDistance: this.nullableNumber(dpoSwingRaw.lastLowLowDistance),
        interpretation:
          typeof dpoSwingRaw.interpretation === 'string' ? dpoSwingRaw.interpretation : '',
      },
      supportsCall: this.parseSupportsCall(json.supportsCall),
      notes: typeof json.notes === 'string' ? json.notes : '',
    };
  }

  private parseEmaBias(v: unknown): EmaDpoReport['emaBias'] {
    switch (v) {
      case 'bullish':
      case 'bearish':
      case 'neutral':
        return v;
      default: {
        const _exhaustive: never = v as never;
        throw new EmaDpoAgentError(`Invalid emaBias: ${String(_exhaustive)}`);
      }
    }
  }

  private parseEmaGap(v: unknown): EmaDpoReport['emaGap'] {
    switch (v) {
      case 'tight':
      case 'moderate':
      case 'wide':
        return v;
      default: {
        const _exhaustive: never = v as never;
        throw new EmaDpoAgentError(`Invalid emaGap: ${String(_exhaustive)}`);
      }
    }
  }

  private parsePriceVsEma(v: unknown): EmaDpoReport['priceVsEma'] {
    switch (v) {
      case 'extended_above':
      case 'between':
      case 'extended_below':
      case 'unclear':
        return v;
      default: {
        const _exhaustive: never = v as never;
        throw new EmaDpoAgentError(`Invalid priceVsEma: ${String(_exhaustive)}`);
      }
    }
  }

  private parseSupportsCall(v: unknown): EmaDpoReport['supportsCall'] {
    switch (v) {
      case 'yes':
      case 'no':
      case 'neutral':
        return v;
      default: {
        const _exhaustive: never = v as never;
        throw new EmaDpoAgentError(`Invalid supportsCall: ${String(_exhaustive)}`);
      }
    }
  }

  private nullableNumber(v: unknown): number | null {
    if (typeof v === 'number' && !isNaN(v)) return v;
    return null;
  }
}

export class EmaDpoAgentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmaDpoAgentError';
  }
}
