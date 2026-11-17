import { describe, expect, it } from 'vitest';
import { audibleContextTime, audioOutputDelay } from './output-clock';
describe('audible output clock', () => {
  it('maps the hardware timestamp to the current animation frame', () => {
    const context = { currentTime: 5.3, state: 'running', getOutputTimestamp: () => ({ contextTime: 5, performanceTime: 1000 }) };
    expect(audibleContextTime(context, 1008)).toBeCloseTo(5.008);
    expect(audibleContextTime({ currentTime: 5.3, _nativeAudioContext: context } as typeof context, 1008)).toBeCloseTo(5.008);
  });
  it('uses reported latency when the device timestamp is absent, stale or uninitialized', () => {
    const context = { currentTime: 5.3, state: 'running', baseLatency: .01, outputLatency: .19 };
    expect(audibleContextTime(context, 2000)).toBeCloseTo(5.1);
    expect(audibleContextTime({ ...context, getOutputTimestamp: () => ({ contextTime: 0, performanceTime: 0 }) }, 2000)).toBeCloseTo(5.1);
    expect(audibleContextTime({ ...context, getOutputTimestamp: () => ({ contextTime: 5, performanceTime: 500 }) }, 2000)).toBeCloseTo(5.1);
  });
  it('does not advance suspended audio or return negative/future times', () => {
    expect(audibleContextTime({ currentTime: .1, outputLatency: .2 }, 1000)).toBe(0);
    expect(audibleContextTime({ currentTime: 5, state: 'suspended', outputLatency: .2 }, 1000)).toBe(5);
    expect(audibleContextTime({ currentTime: 5, getOutputTimestamp: () => ({ contextTime: 4.99, performanceTime: 1000 }) }, 1100)).toBe(5);
  });
  it('keeps the full reported visual delay for the first click after context startup', () => {
    expect(audioOutputDelay({ currentTime: .01, baseLatency: .006, outputLatency: .192 })).toBeCloseTo(.198);
  });
});
