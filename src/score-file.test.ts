import { readFileSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { isScoreFile, readScoreFile, writeScoreFile, MAX_SCORE_BYTES } from './score-file';
import type { Score } from './score';

const original = readFileSync(new URL('../scripts/fixtures/julia-florida.sotto.json', import.meta.url), 'utf8');
const score: Score = JSON.parse(original);
describe('lossless score files', () => {
  it('opens legacy JSON and gzip by contents rather than filename or MIME type', async () => {
    expect(await readScoreFile(new Blob([original]))).toEqual(score);
    expect(await readScoreFile(new Blob([gzipSync(original)]))).toEqual(score);
  });
  it('preserves all SVG, timing and extra attribution fields when saving', async () => {
    const attributed = { ...score, provenance: { credit: 'Édition originale', license: 'CC BY-SA' } };
    const file = await writeScoreFile(attributed);
    expect(file.size).toBeLessThan(original.length / 5);
    expect(gunzipSync(new Uint8Array(await file.arrayBuffer())).toString()).toBe(JSON.stringify(attributed));
    expect(await readScoreFile(file)).toEqual(attributed);
  });
  it('reports damaged compressed files and invalid score data', async () => {
    const compressed = gzipSync(original);
    await expect(readScoreFile(new Blob([compressed.subarray(0, -8)]))).rejects.toThrow('damaged');
    await expect(readScoreFile(new Blob(['not JSON']))).rejects.toThrow('not a readable');
    await expect(readScoreFile(new Blob(['{}']))).rejects.toThrow('not a valid');
  });
  it('bounds both file size and expanded gzip data', async () => {
    const large = ' '.repeat(MAX_SCORE_BYTES + 1);
    await expect(readScoreFile(new Blob([large]))).rejects.toThrow('smaller than 15 MB');
    await expect(readScoreFile(new Blob([gzipSync(large)]))).rejects.toThrow('uncompressed limit');
  });
  it('recognizes both score extensions without matching unrelated JSON', () => {
    expect(['piece.sotto', 'piece.sotto.json', 'PIECE.SOTTO'].every(isScoreFile)).toBe(true);
    expect(['catalog.json', 'piece.sotto.zip'].some(isScoreFile)).toBe(false);
  });
});
