export type PolymarketCall = 'UP' | 'DOWN' | 'SKIP';
export type PolymarketMarketWindow = '5m' | '15m';

export const DEFAULT_MIN_CONFIDENCE = 80;

export interface WatchAlertInput {
  call: PolymarketCall;
  symbol: string;
  marketWindow: PolymarketMarketWindow;
  confidence: number;
  maxBuyUpCents: number | null;
  maxBuyDownCents: number | null;
  edgeNote: string;
  reasoning: string;
  rsiValue: number | null;
  dominanceColor: string;
  vetoApplied: boolean;
  timestamp: string;
}

export function shouldSendEmail(
  call: PolymarketCall,
  confidence: number,
  minConfidence = DEFAULT_MIN_CONFIDENCE,
): boolean {
  switch (call) {
    case 'UP':
    case 'DOWN':
      return confidence >= minConfidence;
    case 'SKIP':
      return false;
    default: {
      const _exhaustive: never = call;
      return _exhaustive;
    }
  }
}

function centsLabel(value: number | null): string {
  return value == null ? '—' : `${value}¢`;
}

function rsiLabel(value: number | null): string {
  return value == null ? '—' : String(value);
}

export function formatAlertEmail(input: WatchAlertInput): { subject: string; text: string } {
  const subject = `[Polymarket] ${input.call} ${input.symbol} ${input.marketWindow} · ${input.confidence}%`;
  const text = [
    `Call: ${input.call}`,
    `Symbol: ${input.symbol}`,
    `Window: ${input.marketWindow}`,
    `Confidence: ${input.confidence}%`,
    `Max buy UP: ${centsLabel(input.maxBuyUpCents)}`,
    `Max buy DOWN: ${centsLabel(input.maxBuyDownCents)}`,
    `RSI: ${rsiLabel(input.rsiValue)}`,
    `DRO dominance: ${input.dominanceColor}`,
    `Veto applied: ${input.vetoApplied ? 'yes' : 'no'}`,
    `Edge: ${input.edgeNote}`,
    '',
    input.reasoning,
    '',
    input.timestamp,
  ].join('\n');
  return { subject, text };
}
