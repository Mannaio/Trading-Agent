import type { PolymarketRequest, PolymarketResponse } from '../polymarket/types';
import { applyCorrelationGate } from '../polymarket/decision-gate';
import { VisionJsonError } from '../openai/vision-json';
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
      const rsiPromise = this.rsi.analyze(req).catch((err) => {
        throw this.wrapAgentError('RSI specialist', err);
      });
      const droPromise = this.dro.analyze(req).catch((err) => {
        throw this.wrapAgentError('DRO specialist', err);
      });
      const emaDpoPromise = this.emaDpo.analyze(req).catch((err) => {
        throw this.wrapAgentError('EMA+DPO specialist', err);
      });

      const [rsi, dro, emaDpo] = await Promise.all([rsiPromise, droPromise, emaDpoPromise]);
      const gateCall = applyCorrelationGate(rsi, dro);
      const decision = await this.decision.decide({
        request: req,
        reports: { rsi, dro, emaDpo },
        gateCall,
      }).catch((err) => {
        throw this.wrapAgentError('Decision agent', err);
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

  private wrapAgentError(stage: string, err: unknown): PolymarketPipelineError {
    if (err instanceof PolymarketPipelineError) return err;
    if (
      err instanceof RsiAgentError ||
      err instanceof DroAgentError ||
      err instanceof EmaDpoAgentError ||
      err instanceof DecisionAgentError ||
      err instanceof VisionJsonError
    ) {
      return new PolymarketPipelineError(`${stage}: ${err.message}`);
    }
    if (err instanceof Error) {
      return new PolymarketPipelineError(`${stage}: ${err.message}`);
    }
    return new PolymarketPipelineError(`${stage}: unknown error`);
  }
}

export class PolymarketPipelineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PolymarketPipelineError';
  }
}
