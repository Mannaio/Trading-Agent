import OpenAI from 'openai';
import { callVisionJson } from '../../openai/vision-json';
import {
  applyCorrelationGate,
  applyMarketPriceEdge,
  applyRsiExtremityAdjustments,
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

    const { confidence: llmConfidence, reasoning } = await this.llmDecide(input, gateCall);
    const confidence = applyRsiExtremityAdjustments(llmConfidence, rsi, gateCall);
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
    const raw = await callVisionJson(this.client, 'DecisionAgent', {
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: this.systemPrompt(gateCall) },
        { role: 'user', content: this.buildUserMessage(input, gateCall) },
      ],
      temperature: 0.15,
      max_tokens: 600,
      response_format: { type: 'json_object' },
    });

    return this.parseLlmResponse(raw);
  }

  private systemPrompt(gateCall: PolymarketCall): string {
    return `You are the Decision Agent for Polymarket crypto Up/Down markets (ETH, BTC, BNB).
The correlation gate has already determined: ${gateCall}.

CORRELATION GATE (hard — already applied, do NOT override)
The user's manual edge pairs DRO dominance with RSI extremes:
- Green dominance + RSI peak → DOWN (fade the overbought spike)
- Red dominance + RSI trough → UP (fade the oversold dip)
- Any mismatch (e.g. green + trough, red + peak, unclear dominance, no RSI extreme) → SKIP

DRO DOMINANCE CLARIFICATION
Dominance color is the cycle/regime tint in the DRO pane background bands — it does NOT mean all 5m candles are the same color. Trust the DRO report's dominanceColor field.

EMA + DPO (final support check only)
RSI + DRO correlation is primary. EMA+DPO is a soft support/veto applied after the gate.
If EMA+DPO supportsCall is "no" and gate was UP or DOWN, the pipeline already downgrades to SKIP with vetoApplied — you will not see that case.
Your job: assign confidence 0-100 based on report quality, RSI roomToMove, DRO alert-cycle context, and EMA+DPO support alignment.
Higher confidence when: clear RSI extreme, fresh or stable dominance, roomToMove supports the fade direction, EMA+DPO supportsCall is "yes".
Lower confidence when: marginal extreme, unclear dominance notes, limited roomToMove, or EMA+DPO is "neutral".
RSI numeric extremity (rsiValue) is scored separately after your response — still report it accurately. Values near 99+ (peak) or below 2 (trough) are the strongest fade signals on RSI(2).
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
      `Symbol: ${request.symbol}`,
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
