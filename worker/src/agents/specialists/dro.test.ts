import { describe, expect, it } from 'vitest';
import { applyCorrelationGate } from '../../polymarket/decision-gate';
import type { RsiReport } from '../../polymarket/types';
import { droSystemPrompt, unclearDroReport } from './dro';

const rsiPeak: RsiReport = {
  rsiValue: 90,
  zone: 'overbought',
  slope: 'falling',
  extreme: 'peak',
  roomToMove: 'drop',
  roomConfidence: 80,
  marginNotes: '',
  bias: 'bearish',
  caveats: [],
};

describe('droSystemPrompt', () => {
  it('stays on indicator description and avoids betting language', () => {
    const prompt = droSystemPrompt();
    expect(prompt).toMatch(/dominance/i);
    expect(prompt).not.toMatch(/Polymarket/i);
    expect(prompt).not.toMatch(/\bUP\b/);
    expect(prompt).not.toMatch(/\bDOWN\b/);
    expect(prompt).not.toMatch(/\bSKIP\b/);
    expect(prompt).not.toMatch(/fade-/i);
  });
});

describe('unclearDroReport', () => {
  it('forces the correlation gate to SKIP', () => {
    const dro = unclearDroReport('Vision model refused DRO read');
    expect(dro.dominanceColor).toBe('unclear');
    expect(applyCorrelationGate(rsiPeak, dro)).toBe('SKIP');
  });
});
