import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { PitchAnalysis, shortPitchWindow } from './pitch-detect';
import { PitchPass, targetPitch, frequencyMidi, pitchName, pitchGate, type PitchFrame } from './pitch';
import type { PerformanceNote } from './score';
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
function tone(frequency: number, rate: number, harmonics = false) {
  return Float32Array.from({ length: rate > 64000 ? 8192 : 4096 }, (_, i) => {
    const phase = 2 * Math.PI * frequency * i / rate;
    return harmonics ? .07 * Math.sin(phase) + .22 * Math.sin(phase * 2) + .12 * Math.sin(phase * 3) : .2 * Math.sin(phase);
  });
}
const note = (start: number, end: number, midi = 60, extra = {}): PerformanceNote => ({ id: `note-${start}-${midi}`, voice: 'solo', beat: start, start, end, midi, duration: end - start, grace: 0, bar: 1, tie: false, ...extra });
const frame = (midi: number | null, extra = {}): PitchFrame => ({ time: 1, frequency: midi === null ? null : hz(midi), clarity: .99, rms: .1, windowSeconds: .085, ...extra });

describe('single-note pitch estimates', () => {
  it('detects bass, guitar and violin ranges at common device sample rates', () => {
    const analysis = new PitchAnalysis();
    for (const rate of [44100, 48000, 96000]) for (const midi of [23, 28, 40, 55, 69, 88, 100]) {
      const result = analysis.analyze(tone(hz(midi), rate), rate, 2);
      expect(result.frequency, `${rate} Hz / MIDI ${midi}`).not.toBeNull();
      expect(frequencyMidi(result.frequency!), `${rate} Hz / MIDI ${midi}`).toBeCloseTo(midi, 1);
      expect(result.time).toBe(2);
    }
  });
  it('keeps the fundamental when upper harmonics are louder and preserves cents', () => {
    const analysis = new PitchAnalysis();
    for (const midi of [28, 40, 55, 69]) {
      const result = analysis.analyze(tone(hz(midi), 48000, true), 48000, 0);
      expect(result.frequency).not.toBeNull(); expect(frequencyMidi(result.frequency!)).toBeCloseTo(midi, 1);
    }
    const result = analysis.analyze(tone(hz(69) * 2 ** (23 / 1200), 48000), 48000, 0);
    expect((frequencyMidi(result.frequency!) - 69) * 100).toBeCloseTo(23, 0);
    expect(pitchName(40)).toBe('E2'); expect(pitchName(61)).toBe('C♯4');
  });
  it.each([28, 40])('recovers a decaying low E (MIDI %s) with room noise using the longer window', midi => {
    const rate = 48000, frequency = hz(midi); let seed = 123;
    const samples = Float32Array.from({ length: 8192 }, (_, i) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const t = i / rate, phase = 2 * Math.PI * frequency * t;
      return (.04 * Math.sin(phase) + .12 * Math.sin(2 * phase) + .05 * Math.sin(3 * phase)) * Math.exp(-12 * t) + (seed / 4294967296 - .5) * .03;
    });
    const analysis = new PitchAnalysis();
    expect(analysis.analyze(samples.subarray(4096), rate, 1).frequency).toBeNull();
    const recovered = analysis.analyze(samples, rate, 1);
    expect(frequencyMidi(recovered.frequency!)).toBeCloseTo(midi, 1);
    expect(recovered.windowSeconds).toBe(8192 / rate);
    expect(recovered.time).toBe(1);
    // Longer analysis must also require a longer sustained score target.
    expect(targetPitch([note(.95, 1.05, midi)], 'solo', recovered.time, recovered.windowSeconds)).toEqual({ kind: 'transition' });
  });
  it('keeps short-window timing for clear notes, without imposing bass latency on quick passages', () => {
    for (const rate of [16000, 44100, 48000, 96000]) {
      const size = shortPitchWindow(rate);
      const samples = Float32Array.from({ length: size * 2 }, (_, i) => .2 * Math.sin(2 * Math.PI * 440 * i / rate));
      const result = new PitchAnalysis().analyze(samples, rate, 2);
      expect(result.windowSeconds).toBe(size / rate);
      expect(result.time).toBeCloseTo(2 + size / (2 * rate));
      expect(frequencyMidi(result.frequency!)).toBeCloseTo(69, 1);
    }
  });
  it('does not guess from silence, clipping, quiet input or noise', () => {
    const analysis = new PitchAnalysis();
    const quiet = tone(440, 48000).map(n => n * .00001);
    let seed = 1234;
    const noise = Float32Array.from({ length: 4096 }, () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed / 4294967296 - .5) * .2; });
    for (const input of [new Float32Array(4096), new Float32Array(4096).fill(.99), quiet, noise]) expect(analysis.analyze(input, 48000, 0).frequency).toBeNull();
  });
  it('compares only sustained single pitches, including playback octave, and skips chords and transitions', () => {
    expect(targetPitch([note(0, 1)], 'solo', .5, .2, 12)).toMatchObject({ kind: 'note', midi: 72 });
    expect(targetPitch([note(0, 1), note(0, 1, 64)], 'solo', .5, .2)).toEqual({ kind: 'chord' });
    expect(targetPitch([note(0, 1), note(1, 2, 64)], 'solo', .98, .2)).toEqual({ kind: 'transition' });
    expect(targetPitch([note(0, .05)], 'solo', .025, .09)).toEqual({ kind: 'transition' });
    expect(targetPitch([note(0, 1)], 'all', .5, .2)).toMatchObject({ kind: 'notes', midis: [60] });
    expect(targetPitch([note(0, 1, 35, { percussion: true })], 'solo', .5, .2)).toEqual({ kind: 'percussion' });
    expect(targetPitch([note(0, 1)], 'solo', 2, .2)).toEqual({ kind: 'rest' });
  });
  it('scores one heard pitch against all sounding voices without claiming a complete chord', () => {
    const notes = [note(0, 2, 48, { voice: 'bass' }), note(.5, 1.5, 64), note(.5, 1.5, 67, { voice: 'inner' }), note(.5, 1.5, 35, { voice: 'drums', percussion: true })];
    const target = targetPitch(notes, 'all', 1, .2);
    expect(target).toMatchObject({ kind: 'notes', midis: [48, 64, 67], beat: .5 });
    const pass = new PitchPass();
    pass.push(target, frame(67), -42); pass.push(target, frame(67), -42);
    expect(pass.stats).toEqual({ matching: 1, different: 0 });
    const wrong = new PitchPass();
    wrong.push(target, frame(66), -42); wrong.push(target, frame(66), -42);
    expect(wrong.stats).toEqual({ matching: 0, different: 1 });
    expect(targetPitch(notes, 'all', .5, .2)).toEqual({ kind: 'transition' });
    expect(targetPitch(notes, 'all', 1, .2, 12)).toMatchObject({ midis: [60, 76, 79] });
    expect(targetPitch([notes[3]], 'all', 1, .2)).toEqual({ kind: 'percussion' });
    expect(targetPitch(notes, 'solo', 1, .2)).toMatchObject({ kind: 'note', midi: 64 });
  });
  it('counts targets once after stable frames and leaves ambiguous or missing input unscored', () => {
    const pass = new PitchPass(), target = targetPitch([note(0, 1)], 'solo', .5, .2);
    pass.push(target, frame(60), -42); expect(pass.stats.matching).toBe(0);
    pass.push(target, frame(60), -42); expect(pass.stats.matching).toBe(1);
    for (let i = 0; i < 10; i++) pass.push(target, frame(60), -42);
    expect(pass.stats).toEqual({ matching: 1, different: 0 });
    const next = targetPitch([note(1, 2, 64)], 'solo', 1.5, .2);
    pass.push(next, frame(65), -42); pass.push(next, frame(65), -42);
    expect(pass.stats).toEqual({ matching: 1, different: 1 });
    for (const weak of [frame(null), frame(64, { clarity: .5 }), frame(64, { rms: .00001 })]) pass.push(next, weak, -42);
    pass.push({ kind: 'chord' }, frame(60), -42);
    expect(pass.stats).toEqual({ matching: 1, different: 1 });
    expect(new PitchPass().stats).toEqual({ matching: 0, different: 0 });
  });
  it('revises a target’s stable majority without counting it twice, including octave errors', () => {
    const pass = new PitchPass(), target = targetPitch([note(0, 1, 40)], 'solo', .5, .2);
    pass.push(target, frame(52), -42); pass.push(target, frame(52), -42);
    expect(pass.stats).toEqual({ matching: 0, different: 1 });
    for (let i = 0; i < 4; i++) pass.push(target, frame(40), -42);
    expect(pass.stats).toEqual({ matching: 1, different: 0 });
  });
  it('keeps a stable background hum below the pitch scoring gate', () => {
    const gate = pitchGate(-42, .01);
    expect(gate).toBeCloseTo(-34);
    expect(pitchGate(-30, .001)).toBe(-30);
    const pass = new PitchPass(), target = targetPitch([note(0, 1)], 'solo', .5, .2);
    pass.push(target, frame(60, { rms: .01 }), gate); pass.push(target, frame(60, { rms: .01 }), gate);
    expect(pass.stats).toEqual({ matching: 0, different: 0 });
  });
  it('emits chronological, centered pitch windows only when opted in, without microphone monitoring', () => {
    let Processor: any;
    const messages: any[] = [];
    const context = { AudioWorkletProcessor: class { port = { postMessage: (value: unknown) => messages.push(value), onmessage: undefined }; },
      sampleRate: 48000, currentFrame: 0, registerProcessor: (_name: string, processor: any) => { Processor = processor; } };
    vm.runInNewContext(readFileSync(new URL('../public/rhythm-worklet.js', import.meta.url), 'utf8'), context);
    const processor = new Processor();
    function run(blocks: number) {
      for (let i = 0; i < blocks; i++) {
        const samples = Float32Array.from({ length: 128 }, (_, j) => ((context.currentFrame + j) % 1000) / 1000);
        const output = new Float32Array(128).fill(1);
        processor.process([[samples]], [[output]]);
        expect(output.every(value => value === 0)).toBe(true);
        context.currentFrame += 128;
      }
    }
    run(35); expect(messages.some(message => message.type === 'pitch')).toBe(false);
    processor.port.onmessage({ data: { type: 'pitch', enabled: true, epoch: 7 } });
    const start = context.currentFrame; run(32);
    const window = messages.find(message => message.type === 'pitch');
    expect(window.epoch).toBe(7); expect(window.samples.length).toBe(4096);
    expect(window.time).toBeCloseTo((start + 2048) / 48000);
    expect(window.samples[0]).toBeCloseTo((start % 1000) / 1000);
    expect(window.samples[4095]).toBeCloseTo(((start + 4095) % 1000) / 1000);
    run(50);
    const extended = messages.find(message => message.type === 'pitch' && message.samples.length === 8192);
    expect(extended).toBeDefined();
    const leftSample = Math.round(extended.time * 48000 - 4096);
    expect(extended.samples[0]).toBeCloseTo((leftSample % 1000) / 1000);
    expect(extended.samples[8191]).toBeCloseTo(((leftSample + 8191) % 1000) / 1000);
    processor.port.onmessage({ data: { type: 'pitch', enabled: false, epoch: 8 } });
    const count = messages.filter(message => message.type === 'pitch').length;
    run(50); expect(messages.filter(message => message.type === 'pitch')).toHaveLength(count);
  });
});
