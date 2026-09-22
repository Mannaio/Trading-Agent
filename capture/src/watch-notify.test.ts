import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatAlertEmail, shouldSendEmail, type WatchAlertInput } from './watch-notify.js';

function alert(overrides: Partial<WatchAlertInput> = {}): WatchAlertInput {
  return {
    call: 'UP',
    symbol: 'BTCUSD',
    marketWindow: '5m',
    confidence: 82,
    maxBuyUpCents: 70,
    maxBuyDownCents: 70,
    edgeNote: 'No market prices provided for edge check.',
    reasoning: 'Red dominance + RSI trough.',
    rsiValue: 4.2,
    dominanceColor: 'red',
    vetoApplied: false,
    timestamp: '2026-09-22T20:00:00.000Z',
    ...overrides,
  };
}

describe('shouldSendEmail', () => {
  it('sends for UP at 80%', () => {
    assert.equal(shouldSendEmail('UP', 80), true);
  });

  it('sends for DOWN above 80%', () => {
    assert.equal(shouldSendEmail('DOWN', 95), true);
  });

  it('stays quiet on UP below 80%', () => {
    assert.equal(shouldSendEmail('UP', 79), false);
  });

  it('stays quiet on SKIP even at 99%', () => {
    assert.equal(shouldSendEmail('SKIP', 99), false);
  });
});

describe('formatAlertEmail', () => {
  it('puts call, symbol, window, and confidence in the subject', () => {
    const { subject } = formatAlertEmail(alert());
    assert.equal(subject, '[Polymarket] UP BTCUSD 5m · 82%');
  });
});
