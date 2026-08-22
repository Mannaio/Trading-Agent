import { describe, expect, it } from 'vitest';
import { applyCorrelationGate, applyMarketPriceEdge, computeMaxBuyCents } from './decision-gate';
import type { DroReport, RsiReport } from './types';

const baseRsi = (over: Partial<RsiReport>): RsiReport => ({
  rsiValue: 72,
  zone: 'overbought',
  slope: 'falling',
  extreme: 'peak',
  roomToMove: 'drop',
  roomConfidence: 80,
  marginNotes: '',
  bias: 'bearish',
  caveats: [],
  ...over,
});

const baseDro = (over: Partial<DroReport>): DroReport => ({
  dominanceColor: 'green',
  dominanceSinceBars: 3,
  lookbackWindow: 'last_70_minutes',
  alertCycle: { pivotDirection: 'HIGH', mean: 57, barsSincePivot: 12 },
  notes: '',
  ...over,
});

describe('applyCorrelationGate', () => {
  it('green + peak → DOWN', () => {
    expect(applyCorrelationGate(baseRsi({ extreme: 'peak' }), baseDro({ dominanceColor: 'green' }))).toBe('DOWN');
  });
  it('red + trough → UP', () => {
    expect(
      applyCorrelationGate(
        baseRsi({ extreme: 'trough', zone: 'oversold', rsiValue: 25 }),
        baseDro({ dominanceColor: 'red' }),
      ),
    ).toBe('UP');
  });
  it('green + trough → SKIP', () => {
    expect(
      applyCorrelationGate(baseRsi({ extreme: 'trough' }), baseDro({ dominanceColor: 'green' })),
    ).toBe('SKIP');
  });
  it('unclear dominance → SKIP', () => {
    expect(applyCorrelationGate(baseRsi({}), baseDro({ dominanceColor: 'unclear' }))).toBe('SKIP');
  });
});

describe('computeMaxBuyCents', () => {
  it('70 confidence → 58 max with 12 buffer', () => {
    expect(computeMaxBuyCents(70).maxBuyUpCents).toBe(58);
  });
});

describe('applyMarketPriceEdge', () => {
  it('skips when market price too high', () => {
    const r = applyMarketPriceEdge('UP', 55, 55, { upCents: 60, downCents: 41 });
    expect(r.call).toBe('SKIP');
  });
});
