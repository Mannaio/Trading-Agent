import { describe, expect, it } from 'vitest';
import { isVisionRefusal, VisionJsonError } from './vision-json';

describe('isVisionRefusal', () => {
  it('detects a model refusal in VisionJsonError', () => {
    const err = new VisionJsonError(
      "Empty response from model (agent=DroAgent, finish=stop, refusal=I'm sorry, I can't assist with that.)",
    );
    expect(isVisionRefusal(err)).toBe(true);
  });

  it('is false for empty responses without a refusal', () => {
    expect(isVisionRefusal(new VisionJsonError('Empty response from model (agent=DroAgent, finish=stop)'))).toBe(
      false,
    );
  });
});
