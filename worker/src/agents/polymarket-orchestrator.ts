import type { PolymarketRequest, PolymarketResponse } from '../polymarket/types';
import { applyCorrelationGate } from '../polymarket/decision-gate';
import { RsiAgent, RsiAgentError } from './specialists/rsi';
import { DroAgent, DroAgentError } from './specialists/dro';
import { EmaDpoAgent, EmaDpoAgentError } from './specialists/ema-dpo';
import { DecisionAgent, DecisionAgentError } from './specialists/decision';

export class PolymarketOrchestrator {
  private rsi: RsiAgent;
  private dro: DroAgent;
  private emaDpo: EmaDpoAgent;
  private decision: DecisionAgent;

  constructor(apiKey: string) {
    this.rsi = new RsiAgent(apiKey);
    this.dro = new DroAgent(apiKey);
    this.emaDpo = new EmaDpoAgent(apiKey);
    this.decision = new DecisionAgent(apiKey);
  }

  async run(req: PolymarketRequest): Promise<PolymarketResponse> {
    try {
      const [rsi, dro, emaDpo] = await Promise.all([
        this.rsi.analyze(req),
        this.dro.analyze(req),
        this.emaDpo.analyze(req),
      ]);
      const gateCall = applyCorrelationGate(rsi, dro);
      const decision = await this.decision.decide({
        request: req,
        reports: { rsi, dro, emaDpo },
        gateCall,
      });
      return { ...decision, timestamp: new Date().toISOString() };
    } catch (err) {
      if (err instanceof PolymarketPipelineError) throw err;
      if (
        err instanceof RsiAgentError ||
        err instanceof DroAgentError ||
        err instanceof EmaDpoAgentError ||
        err instanceof DecisionAgentError
      ) {
        throw new PolymarketPipelineError(err.message);
      }
      throw err;
    }
  }
}

export class PolymarketPipelineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PolymarketPipelineError';
  }
}
