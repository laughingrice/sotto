import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isRecordedInstrument } from './recordings';

const manifest = JSON.parse(readFileSync(new URL('../public/samples/manifest.json', import.meta.url), 'utf8'));
describe('bundled real instrument recordings', () => {
  it('keeps guitar, piano, and violin banks separate and covers the low guitar D', () => {
    expect(Object.keys(manifest.banks).sort()).toEqual(['guitar', 'piano', 'violin']);
    expect(manifest.banks.guitar.D2).toBe('guitar/D2.mp3');
    expect(manifest.banks.violin.A4).toBe('violin/A4.mp3');
    expect(isRecordedInstrument('violin')).toBe(true);
    expect(isRecordedInstrument('flute')).toBe(false);
    const fingerprints = new Set(manifest.files.map((file: { sha256: string }) => file.sha256));
    expect(fingerprints.size).toBe(manifest.files.length);
  });
  it('includes each original MP3 with its pinned hash and attribution', () => {
    expect(manifest.files).toHaveLength(29);
    for (const file of manifest.files) {
      const data = readFileSync(new URL(`../public/samples/${file.path}`, import.meta.url));
      expect(data.length).toBe(file.bytes);
      expect(createHash('sha256').update(data).digest('hex')).toBe(file.sha256);
    }
    expect(manifest.license).toBe('CC-BY-3.0');
    const credits = readFileSync(new URL('../public/samples/ATTRIBUTION.md', import.meta.url), 'utf8');
    expect(credits).toContain('Nicholaus P. Brosowsky');
    expect(credits).toContain('quartertone');
  });
});
