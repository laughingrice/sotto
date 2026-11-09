import * as Tone from 'tone';
import type { Performance, Score } from './score';

/** Audio and UI share the Web Audio transport clock, not a JavaScript interval. */
export class Player {
  private instruments = new Map<string, Tone.Sampler>();
  private muted = new Set<string>();
  private volumes = new Map<string, number>();
  private click?: Tone.Synth;
  private performance?: Performance;
  private score?: Score;
  private master?: Tone.Gain;
  private initialized = false;
  private loopBounds = { enabled: false, start: 0, end: 0 };
  metronome = false;
  onEnded: () => void = () => {};

  get beat() { return Number(Tone.getTransport().ticks) / Tone.getTransport().PPQ; }
  get playing() { return this.initialized && Tone.getTransport().state === 'started'; }

  private async initialize() {
    await Tone.start();
    if (this.initialized) return;
    this.master = new Tone.Gain(.75).toDestination();
    this.click = new Tone.Synth({ oscillator: { type: 'sine' }, envelope: { attack: .001, decay: .025, sustain: 0, release: .02 }, volume: -16 }).connect(this.master);
    this.initialized = true;
    this.makeInstruments();
    this.schedule();
  }

  private makeInstruments() {
    if (!this.score || !this.master) return;
    this.instruments.forEach(instrument => instrument.dispose()); this.instruments.clear();
    const context = Tone.getContext().rawContext;
    const buffers: Record<number, Tone.ToneAudioBuffer> = {};
    for (const midi of new Set(this.score.notes.map(note => note.midi))) {
      const rate = context.sampleRate;
      const buffer = context.createBuffer(1, Math.ceil(rate * 3), rate);
      const channel = buffer.getChannelData(0);
      const frequency = 440 * 2 ** ((midi - 69) / 12);
      // Small self-contained plucked-string sample bank: no external soundfonts.
      for (let i = 0; i < channel.length; i++) {
        const t = i / rate;
        let amplitude = 0;
        for (let harmonic = 1; harmonic <= 7; harmonic++) {
          if (frequency * harmonic >= rate / 2) break;
          amplitude += Math.sin(2 * Math.PI * frequency * harmonic * t) * Math.exp(-t * (.9 + harmonic * .7)) / harmonic ** 1.7;
        }
        channel[i] = amplitude * .45 * Math.min(1, t / .004);
      }
      buffers[midi] = new Tone.ToneAudioBuffer(buffer);
    }
    for (const voice of this.score.voices) {
      const sampler = new Tone.Sampler({ urls: buffers, attack: .002, release: .12, volume: -5 }).connect(this.master);
      this.instruments.set(voice.id, sampler);
      this.applyVolume(voice.id);
    }
  }

  load(score: Score, performance: Performance) {
    this.pause(); this.score = score; this.performance = performance;
    this.muted.clear(); this.volumes.clear();
    if (this.initialized) this.makeInstruments();
    this.schedule(); this.seek(0); this.tempo(score.bpm);
  }

  setPerformance(performance: Performance) {
    this.pause(); this.performance = performance; this.schedule(); this.seek(0);
  }

  private schedule() {
    const transport = Tone.getTransport();
    transport.cancel();
    if (!this.performance || !this.score) return;
    const ppq = transport.PPQ;
    for (const note of this.performance.sounds) {
      transport.schedule(time => {
        if (!this.muted.has(note.voice)) {
          this.instruments.get(note.voice)?.triggerAttackRelease(
            Tone.Frequency(note.midi, 'midi').toNote(),
            Math.max(.025, ((this.loopBounds.enabled ? Math.min(note.end, this.loopBounds.end) : note.end) - note.start) * 60 / transport.bpm.value), time, .72);
        }
      }, `${Math.round(note.start * ppq)}i`);
    }
    const pulse = this.score.beatUnit;
    transport.scheduleRepeat(time => {
      if (this.metronome) {
        const beat = transport.getTicksAtTime(time) / ppq;
        this.click?.triggerAttackRelease(beat % this.score!.beatsPerBar < .01 ? 'E6' : 'B5', .025, time, .4);
      }
    }, `${Math.round(pulse * ppq)}i`);
    transport.schedule(time => {
      transport.pause(time);
      Tone.getDraw().schedule(() => { this.release(); this.onEnded(); }, time);
    }, `${Math.round(this.performance.duration * ppq)}i`);
  }

  async play() {
    await this.initialize();
    if (!this.performance) return;
    if (this.beat >= this.performance.duration - .01) this.seek(0);
    const now = Tone.now() + .06;
    const beat = this.beat;
    // Resume sustained notes when starting inside a beat or after pausing.
    for (const note of this.performance.sounds) {
      if (note.start < beat - .001 && note.end > beat && !this.muted.has(note.voice)) {
        this.instruments.get(note.voice)?.triggerAttackRelease(Tone.Frequency(note.midi, 'midi').toNote(), (note.end - beat) * 60 / Tone.getTransport().bpm.value, now, .65);
      }
    }
    Tone.getTransport().start(now);
  }

  private release() { this.instruments.forEach(instrument => instrument.releaseAll()); }
  pause() { Tone.getTransport().pause(); if (this.initialized) this.release(); }
  seek(beat: number) {
    const wasPlaying = this.playing;
    this.pause();
    Tone.getTransport().ticks = Math.round(Math.max(0, beat) * Tone.getTransport().PPQ);
    if (wasPlaying) void this.play();
  }
  tempo(bpm: number) { Tone.getTransport().bpm.value = bpm * (this.score?.beatUnit ?? 1.5); }
  loop(enabled: boolean, start: number, end: number) {
    this.loopBounds = { enabled, start, end };
    const transport = Tone.getTransport();
    transport.loopStart = `${Math.round(start * transport.PPQ)}i`;
    transport.loopEnd = `${Math.round(end * transport.PPQ)}i`;
    transport.loop = enabled;
    if (enabled && (this.beat < start || this.beat >= end)) this.seek(start);
  }
  private applyVolume(voice: string) {
    const instrument = this.instruments.get(voice);
    if (instrument) instrument.volume.value = this.muted.has(voice) ? -Infinity : -5 + 20 * Math.log10(Math.max(.001, this.volumes.get(voice) ?? 1));
  }
  mute(voice: string, muted: boolean) {
    if (muted) { this.muted.add(voice); this.instruments.get(voice)?.releaseAll(); }
    else this.muted.delete(voice);
    this.applyVolume(voice);
  }
  volume(voice: string, volume: number) { this.volumes.set(voice, volume); this.applyVolume(voice); }
  dispose() {
    this.pause(); Tone.getTransport().cancel();
    this.instruments.forEach(instrument => instrument.dispose()); this.instruments.clear();
    this.click?.dispose(); this.master?.dispose();
  }
}
