import OpenAI from 'openai';
import { callVisionJson, isVisionRefusal } from '../../openai/vision-json';
import type { DroReport, PolymarketRequest } from '../../polymarket/types';

export function droSystemPrompt(): string {
  return `You describe the Detrended Rhythm Oscillator (DRO) with Alerts on a 5-minute crypto chart.
Report only what is visible in the DRO panes. Do not give financial advice.

DOMINANCE (primary read)
Lookback: rolling last 70 minutes (1h 10m, ~14 bars on 5m). lookbackWindow must always be "last_70_minutes".

Dominance color = the color of the LATEST green or red stretch touching the LIVE EDGE (rightmost bar) of the DRO dominance pane.
- "green": latest stretch at the live edge is green
- "red": latest stretch at the live edge is red
- "unclear": dominance pane unreadable or ambiguous

WHAT DOMINANCE IS NOT
Dominance color is the cycle/regime tint in the DRO pane background bands — it does NOT mean all 5m candles are green or red.
Do NOT infer dominance from candle colors on the price chart. Read only the DRO dominance pane background.

Do NOT use majority vote across the 70-minute lookback. Only the stretch at the live edge counts.
If dominance flipped recently (fresh flip), report the new color immediately and set dominanceSinceBars to how many 5m bars the current stretch has been active (count from the flip bar). Use null if unreadable.

DRO ALERT (secondary — zigzag pane)
Read the DRO Alert zigzag for cycle context:
- pivotDirection: "LOW" if the most recent pivot is a low, "HIGH" if a high, "unclear" if unreadable
- mean: numeric mean value shown in the alert pane, or null if unreadable
- barsSincePivot: bars since the most recent pivot, or null if unreadable

notes: brief notes on dominance flip timing, stretch length, alert-cycle alignment, or readability issues.

RESPONSE FORMAT — respond ONLY with valid JSON:
{
  "dominanceColor": "green" | "red" | "unclear",
  "dominanceSinceBars": <integer or null>,
  "lookbackWindow": "last_70_minutes",
  "alertCycle": {
    "pivotDirection": "LOW" | "HIGH" | "unclear",
    "mean": <number or null>,
    "barsSincePivot": <integer or null>
  },
  "notes": "<string>"
}`;
}

export function unclearDroReport(notes: string): DroReport {
  return {
    dominanceColor: 'unclear',
    dominanceSinceBars: null,
    lookbackWindow: 'last_70_minutes',
    alertCycle: { pivotDirection: 'unclear', mean: null, barsSincePivot: null },
    notes,
  };
}

/**
 * DroAgent — DRO specialist in the Polymarket pipeline.
 * Vision-only analysis of DRO dominance and DRO Alert panes on a 5-minute ETH chart.
 * Emits structured DroReport — no UP/DOWN/SKIP trade calls.
 */
export class DroAgent {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async analyze(req: PolymarketRequest): Promise<DroReport> {
    const messages = this.buildMessages(req);

    try {
      const raw = await callVisionJson(this.client, 'DroAgent', {
        model: 'gpt-4o',
        messages,
        temperature: 0,
        max_tokens: 1500,
        response_format: { type: 'json_object' },
      });
      return this.parseResponse(raw);
    } catch (err) {
      if (isVisionRefusal(err)) {
        return unclearDroReport(
          'Vision model refused the DRO pane read; treating dominance as unclear.',
        );
      }
      throw err;
    }
  }

  // ─── Build multi-modal messages ───
  private buildMessages(
    req: PolymarketRequest,
  ): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    const system: OpenAI.Chat.Completions.ChatCompletionSystemMessageParam = {
      role: 'system',
      content: droSystemPrompt(),
    };

    const userContent: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [];

    userContent.push({
      type: 'text',
      text: `5-minute ${req.symbol} chart — analyze DRO dominance and DRO Alert panes:`,
    });
    userContent.push({
      type: 'image_url',
      image_url: { url: req.screenshot, detail: 'high' },
    });

    const meta = req.screenshotsMeta;

    if (meta?.droDominanceCrop) {
      userContent.push({
        type: 'text',
        text: 'DRO dominance pane crop (preferred for green/red dominance read — bottom band in DRO pane):',
      });
      userContent.push({
        type: 'image_url',
        image_url: { url: meta.droDominanceCrop, detail: 'low' },
      });
    }

    if (meta?.droCrop) {
      userContent.push({
        type: 'text',
        text: 'DRO Alert pane crop (zigzag cycle context — pivot direction, mean, bars since pivot):',
      });
      userContent.push({
        type: 'image_url',
        image_url: { url: meta.droCrop, detail: 'low' },
      });
    }

    const contextLines = [
      `Symbol: ${req.symbol}`,
      `Chart interval: ${req.marketWindow}`,
    ];
    if (req.notes?.trim()) {
      contextLines.push(`User notes: ${req.notes.trim()}`);
    }
    userContent.push({
      type: 'text',
      text: `${contextLines.join('. ')}. Return JSON matching DroReport schema exactly.`,
    });

    return [system, { role: 'user', content: userContent }];
  }

  // ─── Parse JSON response ───
  private parseResponse(raw: string): DroReport {
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new DroAgentError('Model returned invalid JSON');
    }

    const alertCycleRaw =
      typeof json.alertCycle === 'object' && json.alertCycle !== null
        ? (json.alertCycle as Record<string, unknown>)
        : {};

    return {
      dominanceColor: this.parseDominanceColor(json.dominanceColor),
      dominanceSinceBars: this.nullableInteger(json.dominanceSinceBars),
      lookbackWindow: 'last_70_minutes',
      alertCycle: {
        pivotDirection: this.parsePivotDirection(alertCycleRaw.pivotDirection),
        mean: this.nullableNumber(alertCycleRaw.mean),
        barsSincePivot: this.nullableInteger(alertCycleRaw.barsSincePivot),
      },
      notes: typeof json.notes === 'string' ? json.notes : '',
    };
  }

  private parseDominanceColor(v: unknown): DroReport['dominanceColor'] {
    switch (v) {
      case 'green':
      case 'red':
      case 'unclear':
        return v;
      default: {
        const _exhaustive: never = v as never;
        throw new DroAgentError(`Invalid dominanceColor: ${String(_exhaustive)}`);
      }
    }
  }

  private parsePivotDirection(v: unknown): DroReport['alertCycle']['pivotDirection'] {
    switch (v) {
      case 'LOW':
      case 'HIGH':
      case 'unclear':
        return v;
      default: {
        const _exhaustive: never = v as never;
        throw new DroAgentError(`Invalid pivotDirection: ${String(_exhaustive)}`);
      }
    }
  }

  private nullableNumber(v: unknown): number | null {
    if (typeof v === 'number' && !isNaN(v)) return v;
    return null;
  }

  private nullableInteger(v: unknown): number | null {
    const n = this.nullableNumber(v);
    if (n === null) return null;
    return Math.max(0, Math.round(n));
  }
}

export class DroAgentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DroAgentError';
  }
}
