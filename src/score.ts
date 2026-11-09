export type Voice = { id: string; name: string; color: string };
export type ScoreNote = { id: string; voice: string; beat: number; grace: number; midi: number; duration: number; bar: number; tie: boolean };
export type Score = {
  format: 'sotto-score'; version: 1; title: string; composer: string; subtitle: string;
  beatsPerBar: number; beatUnit: number; bpm: number; description: string;
  voices: Voice[]; notes: ScoreNote[]; pages: string[];
  bars: { index: number; label: string }[]; sequence: number[];
};
export type PerformanceNote = ScoreNote & { start: number; end: number };
export type Measure = { index: number; written: number; label: string; occurrence: number; start: number; end: number };
export type Performance = { notes: PerformanceNote[]; sounds: PerformanceNote[]; measures: Measure[]; duration: number };

export function makePerformance(score: Score, repeats = true): Performance {
  const sequence = repeats ? score.sequence : score.bars.map(bar => bar.index);
  const occurrences = new Map<number, number>();
  const measures: Measure[] = sequence.map((written, index) => {
    const occurrence = (occurrences.get(written) ?? 0) + 1;
    occurrences.set(written, occurrence);
    return { index, written, label: score.bars[written].label, occurrence,
      start: index * score.beatsPerBar, end: (index + 1) * score.beatsPerBar };
  });
  const notes = measures.flatMap(measure => score.notes
    .filter(note => Math.floor((note.beat + 1e-6) / score.beatsPerBar) === measure.written)
    .map(note => {
      const start = Math.max(measure.start, measure.start + note.beat - measure.written * score.beatsPerBar + Math.max(-.16, note.grace));
      return { ...note, start, end: Math.min(measures.length * score.beatsPerBar, start + (note.grace ? .12 : note.duration)) };
    })).sort((a, b) => a.start - b.start);
  // Keep individual noteheads for highlighting, but sustain tied pitches once.
  const sounds: PerformanceNote[] = [];
  for (const note of notes) {
    const previous = sounds.findLast(candidate => candidate.voice === note.voice && candidate.midi === note.midi);
    if (previous?.tie && Math.abs(previous.end - note.start) < .001) {
      previous.end = note.end; previous.tie = note.tie;
    } else sounds.push({ ...note });
  }
  return { notes, sounds, measures, duration: measures.length * score.beatsPerBar };
}

export function measureAt(performance: Performance, beat: number): Measure {
  return performance.measures.find(m => beat >= m.start && beat < m.end) ?? performance.measures.at(-1)!;
}
export function activeNotes(performance: Performance, beat: number): PerformanceNote[] {
  return performance.notes.filter(note => beat >= note.start && beat < note.end);
}
export function clockTime(beat: number, bpm: number, beatUnit: number): string {
  const seconds = Math.floor(beat * 60 / (bpm * beatUnit));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function validateScore(value: unknown): asserts value is Score {
  const score = value as Score;
  if (!score || score.format !== 'sotto-score' || score.version !== 1 ||
      typeof score.title !== 'string' || !Array.isArray(score.pages) || !score.pages.length ||
      !Array.isArray(score.notes) || !score.notes.length || !Array.isArray(score.voices) || !score.voices.length ||
      !Array.isArray(score.bars) || !score.bars.length || !Array.isArray(score.sequence) || !score.sequence.length ||
      !Number.isFinite(score.beatsPerBar) || score.beatsPerBar <= 0 || !Number.isFinite(score.beatUnit) || score.beatUnit <= 0 ||
      !Number.isFinite(score.bpm) || score.bpm < 15 || score.bpm > 300 ||
      score.notes.some(n => !Number.isFinite(n.beat) || !Number.isFinite(n.grace) || !Number.isFinite(n.duration) || n.duration <= 0 || !Number.isFinite(n.midi) || n.midi < 0 || n.midi > 127 || typeof n.id !== 'string' || !score.voices.some(v => v.id === n.voice)) ||
      score.sequence.some(index => !Number.isInteger(index) || index < 0 || index >= score.bars.length) ||
      score.pages.some(page => typeof page !== 'string' || !page.includes('<svg'))) {
    throw new Error('This is not a valid Sotto score bundle. Open a .sotto.json file created by the score exporter.');
  }
}

/** SVG is inserted as DOM for highlighting; remove executable content on import. */
export function cleanSvg(source: string): string {
  const document = new DOMParser().parseFromString(source, 'image/svg+xml');
  if (document.querySelector('parsererror') || document.documentElement.localName !== 'svg') throw new Error('A score page contains invalid SVG.');
  const allowed = new Set(['svg','g','path','rect','circle','ellipse','line','polyline','polygon','text','tspan','defs','clipPath','use','title','desc']);
  for (const element of Array.from(document.querySelectorAll('*'))) {
    if (!allowed.has(element.localName)) { element.remove(); continue; }
    for (const attribute of Array.from(element.attributes)) {
      const key = attribute.localName.toLowerCase();
      const value = attribute.value;
      if (key.startsWith('on') || (key === 'href' && !value.startsWith('#')) ||
          (key === 'style' && /url\s*\(|expression|@import/i.test(value)) ||
          (key !== 'xmlns' && /(?:javascript:|data:|https?:|file:)/i.test(value)) ||
          (/url\s*\(/i.test(value) && !/^url\(#[\w-]+\)$/.test(value))) element.removeAttributeNode(attribute);
    }
  }
  document.documentElement.removeAttribute('width');
  document.documentElement.removeAttribute('height');
  return new XMLSerializer().serializeToString(document.documentElement);
}
