import OpenAI from 'openai';
import type { EmaDpoReport, PolymarketRequest } from '../../polymarket/types';

/**
 * EmaDpoAgent — EMA + DPO specialist in the Polymarket pipeline.
 * Vision-only analysis of EMA 50/200 structure and DPO zig-zag swing distances on a 5-minute ETH chart.
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
      text: '5-minute ETH chart — analyze the price pane (EMA 50/200) and DPO zig-zag swing tool if visible:',
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
    return `You analyze EMA 50/200 structure and the DPO (Detrended Price Oscillator) zig-zag swing tool on a 5-minute ETH chart.
Your job is to describe trend structure and swing-cycle context — NOT to recommend trades or pick UP/DOWN/SKIP.

ROLE IN PIPELINE (final support check only)
RSI + DRO correlation is the primary signal. You are the FINAL soft support/veto check after that gate.
Do NOT infer UP or DOWN from EMA/DPO alone. supportsCall flags whether structure aligns with or warns against a directional scalp — Decision applies this as a soft veto only.

EMA STRUCTURE (price pane)
Read EMA 50 (fast) and EMA 200 (slow) from the chart legend or visible lines.

emaBias — crossover / trend structure:
- "bullish": EMA 50 above EMA 200 (golden cross structure)
- "bearish": EMA 50 below EMA 200 (death cross structure)
- "neutral": EMAs converging, recently crossed, or structure unclear

emaGap — distance between EMA 50 and EMA 200:
If legend values are readable, gap % = |EMA50 − EMA200| / min(EMA50, EMA200) × 100.
- "tight": < 1% or visually converging / recently crossed
- "moderate": ~1–3%
- "wide": > 3% or visually well separated in a strong trend

priceVsEma — price position relative to both EMAs:
- "extended_above": price clearly extended well above both EMAs (overextended risk)
- "between": price between EMA 50 and EMA 200, or hugging one EMA without clear extension
- "extended_below": price clearly extended well below both EMAs (overextended risk)
- "unclear": price pane unreadable or ambiguous

DPO SWING (zig-zag tool on price pane, if visible)
Measure or estimate the distance between the last two High–High pivots and the last two Low–Low pivots on the DPO zig-zag.
- lastHighHighDistance: numeric distance in price units if readable, else null
- lastLowLowDistance: numeric distance in price units if readable, else null
- interpretation: describe swing symmetry, cycle completion, or exhaustion even when exact numbers are unreadable (e.g. "High–High distance narrowing vs prior swing — cycle maturing")

SUPPORTS CALL (alignment flag only — NOT a trade direction)
Assess whether EMA + DPO structure coherently supports or warns against the correlation-gated setup.
This does NOT output UP or DOWN — it flags alignment quality for the Decision Agent's soft veto.
- "yes": EMA trend and DPO swing context align cleanly; structure supports taking a directional view after RSI+DRO correlation (healthy trend, mid-cycle, not overextended)
- "no": exhaustion or conflict — wide EMA gap + price extended, EMA/DPO disagree, or DPO cycle suggests reversal (soft veto signal; Decision may SKIP even if correlation gate passed)
- "neutral": mixed signals, unreadable inputs, or insufficient clarity

notes: brief notes on EMA curvature, extension risk, DPO swing readability, or alignment rationale.

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
