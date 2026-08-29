import { describe, expect, it } from 'vitest';
import { applySrGate, collectSrLevels, evaluateSrGate } from './sr-gate';
import type { ChartExtraction, SrLevel, StrategyResult } from '../types';

const baseExtraction = (over: Partial<ChartExtraction>): ChartExtraction => ({
  timeframe: '15m',
  ema50: null,
  ema200: null,
  rsi: 50,
  dro: null,
  currentPrice: 2500,
  extractionConfidence: 'high',
  srLevels: [],
  ...over,
});

const level = (over: Partial<SrLevel> & Pick<SrLevel, 'price' | 'kind'>): SrLevel => ({
  source: 'swing',
  timeframe: '15m',
  touches: 2,
  strength: 'medium',
  extractionConfidence: 'high',
  ...over,
});

const strategy = (over: Partial<StrategyResult> = {}): StrategyResult => ({
  entry: 2500,
  stopLoss: 2487.5,
  takeProfit: 2512.5,
  riskReward: 1,
  suggestedPositionSizeUsd: null,
  suggestedPositionSizePercent: null,
  tradeRecommendation: 'TAKE',
  recommendationReasoning: 'Probability is 70%.',
  ...over,
});

describe('collectSrLevels', () => {
  it('adds EMA50/EMA200 as dynamic S/R from extracted numbers', () => {
    const levels = collectSrLevels([
      baseExtraction({ ema50: 2490, ema200: 2470, srLevels: [] }),
    ]);
    expect(levels.some((l) => l.source === 'ema50' && l.kind === 'support')).toBe(true);
    expect(levels.some((l) => l.source === 'ema200' && l.kind === 'support')).toBe(true);
  });

  it('drops 4H levels that are far from price', () => {
    const levels = collectSrLevels([
      baseExtraction({
        timeframe: '4h',
        currentPrice: 2500,
        srLevels: [level({ price: 2800, kind: 'resistance', timeframe: '4h' })],
      }),
    ]);
    expect(levels).toHaveLength(0);
  });
});

describe('evaluateSrGate', () => {
  it('is CLEAR with no levels', () => {
    const snap = evaluateSrGate({
      currentPrice: 2500,
      direction: 'HIGHER',
      extractions: [baseExtraction({})],
    });
    expect(snap.gate).toBe('CLEAR');
    expect(snap.pathClearToTp).toBe(true);
    expect(snap.blocking).toBeNull();
  });

  it('is CLEAR when direction is UNCLEAR', () => {
    const snap = evaluateSrGate({
      currentPrice: 2500,
      direction: 'UNCLEAR',
      extractions: [
        baseExtraction({
          srLevels: [level({ price: 2505, kind: 'resistance' })],
        }),
      ],
    });
    expect(snap.gate).toBe('CLEAR');
  });

  it('WAIT_FOR_BREAK when resistance sits inside the 0.5% long path', () => {
    const wall = 2500 * 1.003; // 0.3% above
    const snap = evaluateSrGate({
      currentPrice: 2500,
      direction: 'HIGHER',
      extractions: [
        baseExtraction({
          srLevels: [level({ price: wall, kind: 'resistance' })],
        }),
      ],
    });
    expect(snap.gate).toBe('WAIT_FOR_BREAK');
    expect(snap.pathClearToTp).toBe(false);
    expect(snap.blocking?.price).toBe(wall);
    expect(snap.triggerPrice).toBe(wall);
    expect(snap.triggerCondition).toContain('15m close above');
  });

  it('CLEAR when resistance is beyond the 0.5% path', () => {
    const wall = 2500 * 1.008; // 0.8% above
    const snap = evaluateSrGate({
      currentPrice: 2500,
      direction: 'HIGHER',
      extractions: [
        baseExtraction({
          srLevels: [level({ price: wall, kind: 'resistance' })],
        }),
      ],
    });
    expect(snap.gate).toBe('CLEAR');
    expect(snap.pathClearToTp).toBe(true);
  });

  it('WAIT_FOR_BREAK when support sits inside the 0.5% short path', () => {
    const floor = 2500 * 0.997; // 0.3% below
    const snap = evaluateSrGate({
      currentPrice: 2500,
      direction: 'LOWER',
      extractions: [
        baseExtraction({
          srLevels: [level({ price: floor, kind: 'support' })],
        }),
      ],
    });
    expect(snap.gate).toBe('WAIT_FOR_BREAK');
    expect(snap.pathClearToTp).toBe(false);
    expect(snap.triggerCondition).toContain('15m close below');
  });

  it('WAIT_FOR_PULLBACK when long is chasing far from backing support', () => {
    const snap = evaluateSrGate({
      currentPrice: 2500,
      direction: 'HIGHER',
      extractions: [
        baseExtraction({
          srLevels: [
            level({ price: 2490, kind: 'support' }), // 0.4% below
            level({ price: 2525, kind: 'resistance' }), // 1% above — path clear
          ],
        }),
      ],
    });
    expect(snap.gate).toBe('WAIT_FOR_PULLBACK');
    expect(snap.pathClearToTp).toBe(true);
    expect(snap.backing?.price).toBe(2490);
    expect(snap.triggerCondition).toContain('touch support');
  });

  it('WAIT_FOR_BREAK (chop) when both walls are inside 0.35%', () => {
    const snap = evaluateSrGate({
      currentPrice: 2500,
      direction: 'HIGHER',
      extractions: [
        baseExtraction({
          srLevels: [
            level({ price: 2504, kind: 'resistance' }),
            level({ price: 2496, kind: 'support' }),
          ],
        }),
      ],
    });
    expect(snap.gate).toBe('WAIT_FOR_BREAK');
    expect(snap.triggerPrice).toBe(2504);
  });

  it('CLEAR when sitting on nearby support with a clear path to TP', () => {
    const snap = evaluateSrGate({
      currentPrice: 2500,
      direction: 'HIGHER',
      extractions: [
        baseExtraction({
          srLevels: [
            level({ price: 2498, kind: 'support' }), // 0.08% below
            level({ price: 2520, kind: 'resistance' }),
          ],
        }),
      ],
    });
    expect(snap.gate).toBe('CLEAR');
    expect(snap.pathClearToTp).toBe(true);
  });
});

describe('applySrGate', () => {
  it('downgrades TAKE to WAIT on WAIT_FOR_BREAK and keeps SKIP', () => {
    const snap = evaluateSrGate({
      currentPrice: 2500,
      direction: 'HIGHER',
      extractions: [
        baseExtraction({
          srLevels: [level({ price: 2507, kind: 'resistance' })],
        }),
      ],
    });
    expect(applySrGate(strategy(), snap, 'HIGHER').tradeRecommendation).toBe('WAIT');
    expect(
      applySrGate(strategy({ tradeRecommendation: 'SKIP' }), snap, 'HIGHER').tradeRecommendation,
    ).toBe('SKIP');
  });

  it('snaps entry to backing on WAIT_FOR_PULLBACK', () => {
    const snap = evaluateSrGate({
      currentPrice: 2500,
      direction: 'HIGHER',
      extractions: [
        baseExtraction({
          srLevels: [
            level({ price: 2490, kind: 'support' }),
            level({ price: 2525, kind: 'resistance' }),
          ],
        }),
      ],
    });
    const gated = applySrGate(strategy(), snap, 'HIGHER');
    expect(gated.tradeRecommendation).toBe('WAIT');
    expect(gated.entry).toBe(2490);
    expect(gated.takeProfit).toBeCloseTo(2490 * 1.005, 5);
  });

  it('forces SKIP when gate is BLOCKED', () => {
    const blocked = evaluateSrGate({
      currentPrice: 2500,
      direction: 'HIGHER',
      extractions: [baseExtraction({})],
    });
    blocked.gate = 'BLOCKED';
    expect(applySrGate(strategy(), blocked, 'HIGHER').tradeRecommendation).toBe('SKIP');
  });
});
