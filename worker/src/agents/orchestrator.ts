import type { AnalysisRequest, AnalysisResponse, Timeframe, TimeframeAnalysis } from '../types';
import { ChartExtractionAgent } from './extraction';
import { TimeframeAnalysisAgent } from './timeframe';
import { SynthesisAgent } from './synthesis';
import { StrategyAgent } from './strategy';

export class AnalysisPipelineOrchestrator {
  private extraction: ChartExtractionAgent;
  private timeframe: TimeframeAnalysisAgent;
  private synthesis: SynthesisAgent;
  private strategy: StrategyAgent;

  constructor(apiKey: string) {
    this.extraction = new ChartExtractionAgent(apiKey);
    this.timeframe = new TimeframeAnalysisAgent(apiKey);
    this.synthesis = new SynthesisAgent(apiKey);
    this.strategy = new StrategyAgent(apiKey);
  }

  async run(req: AnalysisRequest): Promise<AnalysisResponse> {
    // Stage 1: extract raw indicator values from chart images
    const extractions = await this.extraction.extract(req);

    // Stage 2: analyze each timeframe in parallel
    const tfAnalyses = await Promise.all(extractions.map((e) => this.timeframe.analyze(e)));

    // Stage 3: synthesize across all timeframes
    const synthesis = await this.synthesis.synthesize(
      tfAnalyses,
      req.userReasoning,
      req.pastLessons ?? [],
    );

    // Stage 4: build trade strategy
    const latestPrice = extractions.find((e) => e.currentPrice != null)?.currentPrice ?? null;
    const strategyResult = await this.strategy.plan(
      synthesis,
      req.symbol,
      latestPrice,
      req.portfolioContext,
    );

    // Build tfAnalysisMap: Record<Timeframe, TimeframeAnalysis>
    const fallback: TimeframeAnalysis = { ema: 'N/A', rsi: 'N/A', dro: 'N/A' };
    const tfAnalysisMap: Record<Timeframe, TimeframeAnalysis> = {
      '4h': { ...fallback },
      '1h': { ...fallback },
      '15m': { ...fallback },
    };

    for (const a of tfAnalyses) {
      tfAnalysisMap[a.timeframe] = { ema: a.ema, rsi: a.rsi, dro: a.dro };
    }

    // Build backward-compatible reasoning string
    const tfParts = (['4h', '1h', '15m'] as Timeframe[]).map((tf) => {
      const a = tfAnalysisMap[tf];
      return `[${tf.toUpperCase().replace('M', 'm')}] EMA: ${a.ema}. RSI: ${a.rsi}. DRO: ${a.dro}.`;
    });
    const reasoning = synthesis.conclusion
      ? `${tfParts.join(' ')} Conclusion: ${synthesis.conclusion}`
      : tfParts.join(' ');

    return {
      direction: synthesis.direction,
      probability: synthesis.probability,
      timeframeEstimate: synthesis.timeframeEstimate,
      analysis: tfAnalysisMap,
      conclusion: synthesis.conclusion,
      reasoning,
      thesisFeedback: synthesis.thesisFeedback,
      keyRisk: synthesis.keyRisk,
      levels: {
        entry: strategyResult.entry,
        stopLoss: strategyResult.stopLoss,
        takeProfit: strategyResult.takeProfit,
      },
      tradeRecommendation: strategyResult.tradeRecommendation,
      recommendationReasoning: strategyResult.recommendationReasoning,
      suggestedPositionSizeUsd: strategyResult.suggestedPositionSizeUsd ?? undefined,
      suggestedPositionSizePercent: strategyResult.suggestedPositionSizePercent ?? undefined,
      riskReward: strategyResult.riskReward,
      extractions,
      timestamp: new Date().toISOString(),
    };
  }
}

export class PipelineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PipelineError';
  }
}
