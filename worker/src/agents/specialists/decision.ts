import OpenAI from 'openai';
import {
  applyCorrelationGate,
  applyMarketPriceEdge,
  computeMaxBuyCents,
} from '../../polymarket/decision-gate';
import type {
  PolymarketAnalysisInput,
  PolymarketCall,
  PolymarketResponse,
} from '../../polymarket/types';

/**
 * DecisionAgent — final Polymarket pipeline stage.
 * Applies correlation gate, EMA+DPO veto, LLM confidence scoring, and market price edge.
 */
export class DecisionAgent {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async decide(
    input: PolymarketAnalysisInput,
  ): Promise<Omit<PolymarketResponse, 'timestamp'>> {
    const { request, reports } = input;
    const { rsi, dro, emaDpo } = reports;
    const gateCall = input.gateCall ?? applyCorrelationGate(rsi, dro);

    const base = {
      marketWindow: request.marketWindow,
      reports,
      correlationCall: gateCall,
    };

    if (gateCall === 'SKIP') {
      return {
        ...base,
        call: 'SKIP',
        confidence: 40,
        maxBuyUpCents: null,
        maxBuyDownCents: null,
        edgeNote: 'No trade setup.',
        reasoning: 'Correlation gate: SKIP',
        vetoApplied: false,
      };
    }

    if (emaDpo.supportsCall === 'no') {
      return {
        ...base,
        call: 'SKIP',
        confidence: 40,
        maxBuyUpCents: null,
        maxBuyDownCents: null,
        edgeNote: 'No trade setup.',
        reasoning: `EMA+DPO veto: supportsCall is "no" — correlation gate was ${gateCall} but structure lacks alignment support.`,
        vetoApplied: true,
      };
    }

    const { confidence, reasoning } = await this.llmDecide(input, gateCall);
    const { maxBuyUpCents, maxBuyDownCents } = computeMaxBuyCents(confidence);
    const { call, edgeNote } = applyMarketPriceEdge(
      gateCall,
      maxBuyUpCents,
      maxBuyDownCents,
      request.marketPrices,
    );

    return {
      ...base,
      call,
      confidence,
      maxBuyUpCents,
      maxBuyDownCents,
      edgeNote,
      reasoning,
      vetoApplied: false,
    };
  }

  private async llmDecide(
    input: PolymarketAnalysisInput,
    gateCall: PolymarketCall,
  ): Promise<{ confidence: number; reasoning: string }> {
    const completion = await this.client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: this.systemPrompt(gateCall) },
        { role: 'user', content: this.buildUserMessage(input, gateCall) },
      ],
      temperature: 0.15,
      max_tokens: 600,
      response_format: { type: 'json_object' },
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new DecisionAgentError('Empty response from model');

    return this.parseLlmResponse(raw);
  }

  private systemPrompt(gateCall: PolymarketCall): string {
    return `You are the Decision Agent for Polymarket ETH Up/Down.
The correlation gate has already determined: ${gateCall}.
Rules you must NOT override:
- green dominance + RSI peak → DOWN only
- red dominance + RSI trough → UP only
- mismatches → SKIP
Your job: assign confidence 0-100 based on report quality and EMA+DPO support.
If EMA+DPO supportsCall is "no" and gate was UP or DOWN, output SKIP with vetoApplied.
Do not invent indicator values not in the reports.

RESPONSE FORMAT — respond ONLY with valid JSON:
{
  "confidence": <integer 0-100>,
  "reasoning": "<2-4 sentences explaining confidence based on report quality and EMA+DPO support>"
}`;
  }

  private buildUserMessage(input: PolymarketAnalysisInput, gateCall: PolymarketCall): string {
    const { request, reports } = input;
    const lines = [
      `Polymarket market window: ${request.marketWindow}`,
      `Correlation gate call: ${gateCall}`,
      '',
      'SPECIALIST REPORTS (JSON):',
      JSON.stringify(reports, null, 2),
    ];

    if (request.marketPrices) {
      lines.push(
        '',
        `Market prices: Up ${request.marketPrices.upCents}¢, Down ${request.marketPrices.downCents}¢`,
      );
    }

    if (request.notes?.trim()) {
      lines.push('', `User notes: ${request.notes.trim()}`);
    }

    lines.push('', 'Assign confidence 0-100 and provide reasoning for the gated call.');

    return lines.join('\n');
  }

  private parseLlmResponse(raw: string): { confidence: number; reasoning: string } {
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new DecisionAgentError('Model returned invalid JSON');
    }

    const confidence = this.clampConfidence(json.confidence);
    const reasoning = typeof json.reasoning === 'string' ? json.reasoning : '';

    return { confidence, reasoning };
  }

  private clampConfidence(v: unknown): number {
    if (typeof v !== 'number' || isNaN(v)) return 50;
    return Math.max(0, Math.min(100, Math.round(v)));
  }
}

export class DecisionAgentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecisionAgentError';
  }
}
