import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadWatchConfig } from './watch-config.js';

const validEnv = {
  ALERT_TO: 'me@example.com',
  SMTP_USER: 'me@gmail.com',
  SMTP_PASS: 'app-password',
};

describe('loadWatchConfig', () => {
  it('defaults min confidence to 80', () => {
    const config = loadWatchConfig(validEnv);
    assert.equal(config.minConfidence, 80);
  });

  it('reads MIN_CONFIDENCE from env', () => {
    const config = loadWatchConfig({ ...validEnv, MIN_CONFIDENCE: '90' });
    assert.equal(config.minConfidence, 90);
  });
});
