import type {
  DroReport,
  PolymarketCall,
  PolymarketMarketPrices,
  RsiReport,
} from './types';

const DEFAULT_BUFFER_CENTS = 12;

export function applyCorrelationGate(rsi: RsiReport, dro: DroReport): PolymarketCall {
  if (dro.dominanceColor === 'unclear') return 'SKIP';
  if (dro.dominanceColor === 'green' && rsi.extreme === 'peak') return 'DOWN';
  if (dro.dominanceColor === 'red' && rsi.extreme === 'trough') return 'UP';
  return 'SKIP';
}

export function computeMaxBuyCents(
  confidence: number,
  bufferCents = DEFAULT_BUFFER_CENTS,
): { maxBuyUpCents: number | null; maxBuyDownCents: number | null } {
  const clamped = Math.max(0, Math.min(100, Math.round(confidence)));
  const max = Math.max(1, clamped - bufferCents);
  return { maxBuyUpCents: max, maxBuyDownCents: max };
}

export function applyMarketPriceEdge(
  call: PolymarketCall,
  maxBuyUpCents: number | null,
  maxBuyDownCents: number | null,
  prices?: PolymarketMarketPrices,
): { call: PolymarketCall; edgeNote: string } {
  if (call === 'SKIP' || !prices) {
    return { call, edgeNote: call === 'SKIP' ? 'No trade setup.' : 'No market prices provided for edge check.' };
  }
  if (call === 'UP') {
    if (maxBuyUpCents != null && prices.upCents > maxBuyUpCents) {
      return {
        call: 'SKIP',
        edgeNote: `Market Up ${prices.upCents}¢ exceeds max ${maxBuyUpCents}¢ — skip.`,
      };
    }
    return {
      call: 'UP',
      edgeNote: `Buy Up only ≤ ${maxBuyUpCents}¢ (market Up ${prices.upCents}¢).`,
    };
  }
  if (call === 'DOWN') {
    if (maxBuyDownCents != null && prices.downCents > maxBuyDownCents) {
      return {
        call: 'SKIP',
        edgeNote: `Market Down ${prices.downCents}¢ exceeds max ${maxBuyDownCents}¢ — skip.`,
      };
    }
    return {
      call: 'DOWN',
      edgeNote: `Buy Down only ≤ ${maxBuyDownCents}¢ (market Down ${prices.downCents}¢).`,
    };
  }
  return { call: 'SKIP', edgeNote: 'No trade setup.' };
}
