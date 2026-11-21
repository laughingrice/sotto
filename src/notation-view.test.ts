import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { availableViews, renderingPages, validateScore, makePerformance, type Score } from './score';

describe('four-bar tab prototypes', () => {
  for (const [instrument, count, low, strings] of [['guitar', 11, 40, 6], ['bass', 10, 28, 4]] as const) {
    const score = JSON.parse(gunzipSync(readFileSync(new URL(`../public/scores/prototypes/${instrument}.sotto`, import.meta.url))).toString()) as Score;
    it(`${instrument}: shares semantic events across three views, preserves tuning, ties, rests and repeats`, () => {
      validateScore(score);
      expect(availableViews(score)).toEqual(['notation', 'tabs', 'both']);
      expect(score.notes).toHaveLength(count);
      for (const note of score.notes) expect(score.pages.join('')).toContain(`id="${note.id}"`);
      expect(score.notes[0]).toMatchObject({ midi: low, string: strings, fret: 0 });
      for (const note of score.notes) expect(score.parts![0].tuning[note.string! - 1] + note.fret!).toBe(note.midi);
      for (const view of availableViews(score)) {
        const svg = renderingPages(score, view).join('');
        for (const note of score.notes) expect(svg.match(new RegExp(`data-event-id="${note.id}"`, 'g'))).toHaveLength(view === 'both' ? 2 : 1);
        const ids = [...svg.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
        expect(new Set(ids).size).toBe(ids.length);
        expect(svg).toContain('sotto-staff-geometry'); expect(svg).toContain('data-boundary="4"');
      }
      expect(score.notes.filter(note => note.measure === 3)).toHaveLength(0);
      const performance = makePerformance(score);
      expect(performance.duration).toBe(32);
      expect(performance.measures.map(measure => measure.written)).toEqual([0, 1, 2, 3, 0, 1, 2, 3]);
      expect(performance.sounds).toHaveLength((count - 1) * 2);
      expect(performance.sounds.find(note => note.start === 6)?.end).toBe(9);
      const legacy = { ...score, renderings: undefined };
      expect(availableViews(legacy)).toEqual(['notation']);
      expect(renderingPages(legacy, 'tabs')).toEqual(legacy.pages);
      expect(() => validateScore({ ...score, renderings: { tabs: { pages: [] } } })).toThrow('rendering');
    });
  }
});
