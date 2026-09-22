import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AnalyzeResult, CaptureResult, TickDeps } from './watch-tick.js';
import { runTick } from './watch-tick.js';

function captureResult(overrides: Partial<CaptureResult> = {}): CaptureResult {
  return {
    screenshot: 'data:image/png;base64,aaa',
    rsi: 4.2,
    rsiCrop: 'data:image/png;base64,rsi',
    droCrop: 'data:image/png;base64,dro',
    droDominanceCrop: 'data:image/png;base64,dom',
    ...overrides,
  };
}

function analyzeResult(overrides: Partial<AnalyzeResult> = {}): AnalyzeResult {
  return {
    call: 'UP',
    confidence: 82,
    marketWindow: '5m',
    maxBuyUpCents: 70,
    maxBuyDownCents: 70,
    edgeNote: 'No market prices provided for edge check.',
    reasoning: 'Red dominance + RSI trough.',
    reports: {
      rsi: { rsiValue: 4.2 },
      dro: { dominanceColor: 'red' },
    },
    vetoApplied: false,
    timestamp: '2026-09-22T20:00:00.000Z',
    ...overrides,
  };
}

function deps(overrides: Partial<TickDeps> = {}): TickDeps & { sent: { subject: string; text: string }[] } {
  const sent: { subject: string; text: string }[] = [];
  return {
    sent,
    capture: async () => captureResult(),
    analyze: async () => analyzeResult(),
    sendEmail: async (msg) => {
      sent.push(msg);
    },
    log: () => {},
    ...overrides,
  };
}

describe('runTick', () => {
  it('emails on UP at 80%+', async () => {
    const d = deps();
    const status = await runTick({ symbol: 'BTCUSD', marketWindow: '5m' }, d);
    assert.equal(status, 'sent');
    assert.equal(d.sent.length, 1);
    assert.equal(d.sent[0].subject, '[Polymarket] UP BTCUSD 5m · 82%');
  });

  it('stays silent on UP below 80%', async () => {
    const d = deps({
      analyze: async () => analyzeResult({ call: 'UP', confidence: 72 }),
    });
    const status = await runTick({ symbol: 'BTCUSD', marketWindow: '5m' }, d);
    assert.equal(status, 'skip');
    assert.equal(d.sent.length, 0);
  });

  it('stays silent on SKIP', async () => {
    const d = deps({
      analyze: async () => analyzeResult({ call: 'SKIP', confidence: 40 }),
    });
    const status = await runTick({ symbol: 'BTCUSD', marketWindow: '5m' }, d);
    assert.equal(status, 'skip');
    assert.equal(d.sent.length, 0);
  });
});
