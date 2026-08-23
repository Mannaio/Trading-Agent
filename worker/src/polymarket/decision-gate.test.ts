import { describe, expect, it } from 'vitest';
import {
  applyCorrelationGate,
  applyMarketPriceEdge,
  applyRsiExtremityAdjustments,
  computeMaxBuyCents,
  rsiExtremityBonus,
} from './decision-gate';
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

describe('rsiExtremityBonus', () => {
  it('DOWN peak at RSI 99 gets higher bonus than RSI 97', () => {
    const peak99 = rsiExtremityBonus(baseRsi({ rsiValue: 99.07, extreme: 'peak' }), 'DOWN');
    const peak97 = rsiExtremityBonus(baseRsi({ rsiValue: 97.85, extreme: 'peak' }), 'DOWN');
    expect(peak99).toBeGreaterThan(peak97);
    expect(peak99).toBe(15);
    expect(peak97).toBe(10);
  });

  it('UP trough at RSI 1.5 gets higher bonus than RSI 8', () => {
    const low = rsiExtremityBonus(baseRsi({ rsiValue: 1.5, extreme: 'trough', zone: 'oversold' }), 'UP');
    const mid = rsiExtremityBonus(baseRsi({ rsiValue: 8, extreme: 'trough', zone: 'oversold' }), 'UP');
    expect(low).toBeGreaterThan(mid);
    expect(low).toBe(12);
  });

  it('no bonus when gate call does not match extreme', () => {
    expect(rsiExtremityBonus(baseRsi({ rsiValue: 99, extreme: 'peak' }), 'UP')).toBe(0);
  });
});

describe('applyRsiExtremityAdjustments', () => {
  it('differentiates two DOWN setups at same LLM base confidence', () => {
    const base = 80;
    const at99 = applyRsiExtremityAdjustments(
      base,
      baseRsi({ rsiValue: 99.07, extreme: 'peak' }),
      'DOWN',
    );
    const at97 = applyRsiExtremityAdjustments(
      base,
      baseRsi({ rsiValue: 97.85, extreme: 'peak' }),
      'DOWN',
    );
    expect(at99).toBe(95);
    expect(at97).toBe(90);
    expect(at99).toBeGreaterThan(at97);
  });
});
