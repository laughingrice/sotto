export type Voice = { id: string; name: string; color: string };
export type ScoreNote = { id: string; voice: string; beat: number; grace: number; midi: number; duration: number; bar: number; tie: boolean; measure?: number };
export type ScoreBar = { index: number; label: string; start?: number; duration?: number; meter?: [number, number] };
export type Score = {
  format: 'sotto-score'; version: 1; title: string; composer: string; subtitle: string;
  beatsPerBar: number; beatUnit: number; bpm: number; description: string;
  voices: Voice[]; notes: ScoreNote[]; pages: string[];
  bars: ScoreBar[]; sequence: number[];
};
export type PerformanceNote = ScoreNote & { start: number; end: number };
export type Measure = { index: number; written: number; label: string; occurrence: number; start: number; end: number; meter?: [number, number] };
export type Performance = { notes: PerformanceNote[]; sounds: PerformanceNote[]; measures: Measure[]; duration: number };

export function barTiming(score: Score, index: number) {
  const bar = score.bars[index];
  return { start: bar.start ?? index * score.beatsPerBar, duration: bar.duration ?? score.beatsPerBar };
}
export function noteMeasure(score: Score, note: ScoreNote): number {
  if (note.measure !== undefined) return note.measure;
  // Older bundles have a single meter. New bundles can omit the redundant
  // measure field and still resolve membership from the explicit boundaries.
  if (score.bars[0].start === undefined) return Math.floor((note.beat + 1e-6) / score.beatsPerBar);
  return score.bars.findLastIndex((bar, index) => note.beat >= barTiming(score, index).start - 1e-6);
}

export function makePerformance(score: Score, repeats = true): Performance {
  const sequence = repeats ? score.sequence : score.bars.map(bar => bar.index);
  const first = barTiming(score, 0), meter = score.bars[0].meter;
  // Older exports labeled both the pickup and first full measure as 1.
  const pickup = score.bars[0].label === '1' && score.bars[1]?.label === '1' &&
    first.duration < (meter ? meter[0] * 4 / meter[1] : score.beatsPerBar) - 1e-6;
  const occurrences = new Map<number, number>();
  let position = 0;
  const measures: Measure[] = sequence.map((written, index) => {
    const occurrence = (occurrences.get(written) ?? 0) + 1;
    occurrences.set(written, occurrence);
    const start = position;
    position += barTiming(score, written).duration;
    return { index, written, label: pickup && written === 0 ? '0' : score.bars[written].label, occurrence,
      start, end: position, meter: score.bars[written].meter };
  });
  const notes = measures.flatMap(measure => score.notes
    .filter(note => noteMeasure(score, note) === measure.written)
    .map(note => {
      const start = Math.max(measure.start, measure.start + note.beat - barTiming(score, measure.written).start + Math.max(-.16, note.grace));
      return { ...note, start, end: Math.min(position, start + (note.grace ? .12 : note.duration)) };
    })).sort((a, b) => a.start - b.start);
  // Keep individual noteheads for highlighting, but sustain tied pitches once.
  const sounds: PerformanceNote[] = [];
  for (const note of notes) {
    const previous = sounds.findLast(candidate => candidate.voice === note.voice && candidate.midi === note.midi);
    if (previous?.tie && Math.abs(previous.end - note.start) < .001) {
      previous.end = note.end; previous.tie = note.tie;
    } else sounds.push({ ...note });
  }
  return { notes, sounds, measures, duration: position };
}

/** Hold the last loop bar while the audio scheduler catches up to a wrap.
 * The upper bound is exclusive, so a transient end tick cannot select the next bar.
 */
export function loopDisplayBeat(beat: number, start: number, end: number): number {
  return Math.max(start, Math.min(beat, end - 1e-6));
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
      score.bars.some((bar, index) => !bar || bar.index !== index || typeof bar.label !== 'string' ||
        (bar.start !== undefined && (!Number.isFinite(bar.start) || bar.start < 0 || Math.abs(bar.start - (index ? barTiming(score, index - 1).start + barTiming(score, index - 1).duration : 0)) > 1e-5)) ||
        (bar.duration !== undefined && (!Number.isFinite(bar.duration) || bar.duration <= 0)) ||
        ((bar.start === undefined) !== (bar.duration === undefined)) ||
        ((bar.start === undefined) !== (score.bars[0].start === undefined)) ||
        (bar.meter !== undefined && (!Array.isArray(bar.meter) || bar.meter.length !== 2 || bar.meter.some(n => !Number.isInteger(n) || n <= 0)))) ||
      score.notes.some(n => !Number.isFinite(n.beat) || !Number.isFinite(n.grace) || !Number.isFinite(n.duration) || n.duration <= 0 || !Number.isFinite(n.midi) || n.midi < 0 || n.midi > 127 || typeof n.id !== 'string' || !score.voices.some(v => v.id === n.voice) ||
        (n.measure !== undefined && (!Number.isInteger(n.measure) || n.measure < 0 || n.measure >= score.bars.length || n.beat < barTiming(score, n.measure).start - 1e-5 || n.beat >= barTiming(score, n.measure).start + barTiming(score, n.measure).duration - 1e-5))) ||
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
