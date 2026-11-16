import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCatalog } from './catalog';
import { validateScore, makePerformance, type Score } from './score';

describe('published public-domain samples', () => {
  const index = JSON.parse(readFileSync(new URL('../public/scores/samples/catalog.json', import.meta.url), 'utf8'));
  const catalog = parseCatalog(index, 'https://laughingrice.github.io/sotto/scores/samples/catalog.json');
  it('lists all seven editions with provenance and portable source archives', () => {
    expect(catalog.scores).toHaveLength(7);
    expect(catalog.scores.map(score => score.id)).toContain('entertainer');
    for (const score of catalog.scores) {
      expect(score.online.license).toBe('Public Domain');
      expect(score.online.source).toContain('mutopiaproject.org/cgibin/piece-info.cgi?id=');
      expect(readFileSync(new URL(`../public/scores/samples/${score.id}-source.zip`, import.meta.url)).length).toBeGreaterThan(1000);
    }
  });
  for (const entry of index.scores) it(`${entry.id}: valid timing, sounding pitches and visible note identities`, () => {
    const score: Score = JSON.parse(readFileSync(new URL(`../public/scores/samples/${entry.file}`, import.meta.url), 'utf8'));
    validateScore(score);
    const svg = score.pages.join('');
    for (const note of score.notes) {
      expect(svg).toContain(`id="${note.id}"`);
      expect(svg).toContain(`data-voice="${note.voice}"`);
    }
    expect(makePerformance(score).duration).toBeGreaterThan(0);
    expect(new Set(score.voices.map(voice => voice.id)).size).toBe(score.voices.length);
    if (entry.id === 'carcassi') expect(score.notes[0].midi).toBe(48);
    if (entry.id === 'invention-8') expect(score.notes[0].midi).toBe(65);
    if (entry.id === 'entertainer') { expect(score.voices).toHaveLength(2); expect(score.sequence).toHaveLength(152); }
    if (entry.id === 'lagrima') { expect(score.voices).toHaveLength(2); expect(score.sequence).toEqual([...Array(8).keys(), ...Array(8).keys(), ...Array.from({ length: 8 }, (_, i) => i + 8), ...Array.from({ length: 8 }, (_, i) => i + 8), ...Array(8).keys()]); }
    if (entry.id === 'double-concerto') expect(score.voices).toHaveLength(6);
  });
});
