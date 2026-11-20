import { describe, expect, it } from 'vitest';
import { AdaptiveTrace, adaptiveTraceLevel, feedbackX, ScoreFeedbackHistory } from './score-feedback';
import type { Measure } from './score';
const measure = (index = 0, written = 0, start = 0): Measure => ({ index, written, start, end: start + 4, label: '1', occurrence: index + 1 });
const frame = (time: number, peak = .1) => ({ time, peak, rms: peak / 3 });

describe('feedback under the score', () => {
  it('keeps up to five previous bar visits across repeats and new takes, without audio storage', () => {
    const history = new ScoreFeedbackHistory();
    for (let run = 0; run < 8; run++) {
      history.beginPass();
      for (let i = 0; i < 1000; i++) history.push(measure(), i / 250, frame(i / 250, .01 * (run + 1)));
    }
    const takes = history.visible(0, 5);
    expect(takes).toHaveLength(6);
    expect(takes.every(take => take.points.size <= 256)).toBe(true);
    expect(history.visible(0, 1)).toHaveLength(2);
    expect(history.visible(0, 0)[0].points.get(0)?.peak).toBe(.08);
    // A notated repeat can revisit a written bar within the same playback run.
    history.push(measure(4, 0, 16), 16.5, frame(5));
    expect(history.visible(0, 1)[1].points.get(32)?.beat).toBe(.5);
    history.clear(); expect(history.bars.size).toBe(0);
  });
  it('retains peak transients, attack timing and stable pitch judgments at score positions', () => {
    const history = new ScoreFeedbackHistory();
    history.push(measure(), 1, frame(1, .8), { beat: 1, expectedBeat: .9, kind: 'late', errorMs: 50 });
    history.push(measure(), 1.001, frame(1.001, .1));
    history.pitch(measure(), 'note@1', 1, false); history.pitch(measure(), 'note@1', 1, true);
    const take = history.visible(0, 0)[0];
    expect(take.points.get(64)?.peak).toBe(.8);
    expect(take.attacks[0]).toMatchObject({ position: 1, errorMs: 50 });
    expect([...take.pitches.values()]).toEqual([{ beat: 1, matching: true }]);
  });
  it('aligns to nonuniform engraving, including rests between anchors and final bar boundaries', () => {
    const anchors = [{ beat: 0, x: 12 }, { beat: 1, x: 30 }, { beat: 3, x: 90 }, { beat: 4, x: 100 }];
    expect(feedbackX(anchors, 1)).toBe(30); expect(feedbackX(anchors, 2)).toBe(60);
    expect(feedbackX(anchors, 3.5)).toBe(95); expect(feedbackX(anchors, -1)).toBe(12);
    expect(feedbackX(anchors, 5)).toBe(100);
  });
  it('adapts to quieter and louder playing, leaves headroom and does not pump during silence', () => {
    const scale = new AdaptiveTrace();
    const feed = (start: number, end: number, peak: number) => { for (let time = start; time < end; time += .01) scale.push(frame(time, peak), .0001); };
    feed(0, 2, .002);
    const quietCeiling = scale.ceilingDb;
    expect(adaptiveTraceLevel(.002, 12, .0001, quietCeiling)).toBeGreaterThan(.5);
    expect(adaptiveTraceLevel(.002, 12, .0001, quietCeiling)).toBeLessThan(.95);
    feed(2, 4, .3); expect(scale.ceilingDb).toBeGreaterThan(quietCeiling + 30);
    expect(adaptiveTraceLevel(.3, 12, .0001, scale.ceilingDb)).toBeLessThan(.95);
    feed(4, 24, .002); expect(scale.ceilingDb).toBeCloseTo(quietCeiling);
    feed(24, 40, .0001); expect(scale.ceilingDb).toBeCloseTo(quietCeiling);
    expect(adaptiveTraceLevel(.00012, 12, .0001, scale.ceilingDb)).toBe(0);
    expect(Number.isFinite(adaptiveTraceLevel(0, 12, 0, -90))).toBe(true);
  });
});
