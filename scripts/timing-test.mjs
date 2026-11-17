import { gunzipSync } from 'node:zlib';
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const argument = process.argv.indexOf('--chrome');
const executablePath = argument >= 0 ? process.argv[argument + 1] : process.env.CHROME_PATH;
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const instrumentArgument = process.argv.indexOf('--instrument');
const instrument = instrumentArgument >= 0 ? process.argv[instrumentArgument + 1] : 'guitar';
const source = JSON.parse(gunzipSync(await readFile(new URL('../public/scores/samples/carcassi.sotto', import.meta.url))).toString('utf8'));
const notes = source.notes.filter(note => note.voice === 'guitarMelody').slice(0, 8).map((note, i) => ({ ...note, voice: 'test', beat: i, midi: 60, duration: .3, grace: 0, tie: false, measure: Math.floor(i / 4), bar: Math.floor(i / 4) + 1 }));
const fixture = { ...source, title: 'Timing fixture', bpm: 100, beatUnit: 1, beatsPerBar: 4, notes, voices: [{ id: 'test', name: 'Test instrument', color: '#31745e', instrument }], bars: [0, 1].map(i => ({ index: i, start: i * 4, duration: 4, label: String(i + 1), meter: [4, 4] })), sequence: [0, 1] };
const scoreArgument = process.argv.indexOf('--score');
if (scoreArgument >= 0) {
  Object.assign(fixture, JSON.parse(await readFile(process.argv[scoreArgument + 1], 'utf8')));
  fixture.bpm = 100;
  fixture.voices = fixture.voices.map(voice => ({ ...voice, instrument }));
}
await page.addInitScript(() => {
  localStorage.setItem('sotto.countIn', 'false');
  window.audioEvents = []; window.frames = [];
  const edges = new WeakMap(), paths = {};
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function(...args) {
    if (this.context.state === 'running') window.nativeAudioContext = this.context;
    if (args[0] instanceof AudioNode && !args[0].isTimingMonitor) {
      const destinations = edges.get(this) ?? [];
      if (!destinations.includes(args[0])) destinations.push(args[0]);
      edges.set(this, destinations);
    }
    return connect.apply(this, args);
  };
  const disconnect = AudioNode.prototype.disconnect;
  AudioNode.prototype.disconnect = function(...args) {
    if (!args.length || typeof args[0] === 'number') edges.delete(this);
    else edges.set(this, (edges.get(this) ?? []).filter(node => node !== args[0]));
    return disconnect.apply(this, args);
  };
  const createBuffer = AudioContext.prototype.createBuffer;
  AudioContext.prototype.createBuffer = function(...args) { window.nativeAudioContext = this; return createBuffer.apply(this, args); };
  function monitor(kind, source) {
    if (paths[kind] || !window.timingMonitor) return;
    const path = [source];
    while (true) {
      const candidates = edges.get(path.at(-1)) ?? [];
      const next = candidates.find(node => !(node instanceof GainNode && node.gain.value === 0 && (edges.get(node) ?? []).some(target => target instanceof AudioDestinationNode)));
      if (!next || path.includes(next)) break;
      path.push(next);
    }
    paths[kind] = path;
    if (paths.click && paths.note && !window.branchesConnected) {
      const common = paths.click.find(node => paths.note.includes(node));
      if (!common) throw new Error('Click and instrument do not share an output graph');
      const click = paths.click[paths.click.indexOf(common) - 1], note = paths.note[paths.note.indexOf(common) - 1];
      window.branchGraph = { click: paths.click.map(node => node.constructor.name), note: paths.note.map(node => node.constructor.name) };
      click.connect(window.timingMonitor, 0, 0); note.connect(window.timingMonitor, 0, 1);
      window.branchesConnected = true;
    }
  }
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function(time, ...args) {
    let capturedKind;
    if (this.buffer) {
      const samples = this.buffer.getChannelData(0);
      let peak = 0;
      for (let i = 0; i < Math.min(samples.length, this.buffer.sampleRate * .1); i++) peak = Math.max(peak, Math.abs(samples[i]));
      const kind = Math.abs(this.buffer.duration - .035) < .0001 ? 'click' : 'note';
      if (peak > .00001 && (kind === 'click' || this.buffer.duration > .1)) {
        window.testContext = this.context;
        window.audioEvents.push({ kind, time, called: this.context.currentTime });
        capturedKind = kind;
      }
    }
    const result = start.call(this, time, ...args);
    if (capturedKind) queueMicrotask(() => monitor(capturedKind, this));
    return result;
  };
  function frame() {
    if (window.fixtureNotes && window.testContext) {
      const note = window.fixtureNotes.find(note => document.getElementById(note.id)?.classList.contains('is-active'));
      const context = window.testContext;
      const stamp = context.getOutputTimestamp?.();
      const audible = stamp?.performanceTime > 0 ? stamp.contextTime + (performance.now() - stamp.performanceTime) / 1000 : context.currentTime;
      window.frames.push({ beat: note?.beat, tick: Number(document.querySelector('[aria-label="Metronome"][data-tick-count]')?.getAttribute('data-tick-count') ?? 0), raw: context.currentTime, audible });
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
});
try {
  await page.goto(process.env.BASE_URL || 'http://localhost:4178/sotto/');
  await page.getByRole('heading', { name: source.title, exact: true }).waitFor();
  await page.locator('[data-score-input]').setInputFiles({ name: 'timing.sotto.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
  await page.getByRole('heading', { name: fixture.title, exact: true }).waitFor();
  await page.evaluate(notes => { window.fixtureNotes = notes; }, fixture.notes);
  await page.getByRole('button', { name: 'Metronome', exact: true }).click();
  await page.waitForFunction(() => window.nativeAudioContext?.state === 'running' && document.querySelector('[aria-label="Metronome"]').dataset.mode === 'playback');
  await page.evaluate(async () => {
    const context = window.nativeAudioContext;
    const code = `class TimingMonitor extends AudioWorkletProcessor {
      process(inputs) {
        const channels = inputs.map(input => input[0]);
        this.port.postMessage({ time: currentTime, samples: channels.map(channel => channel ? Array.from(channel) : []) });
        return true;
      }
    } registerProcessor('sotto-timing-monitor', TimingMonitor);`;
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    await context.audioWorklet.addModule(url); URL.revokeObjectURL(url);
    const monitor = new AudioWorkletNode(context, 'sotto-timing-monitor', { numberOfInputs: 2, numberOfOutputs: 1 });
    monitor.isTimingMonitor = true; window.timingMonitor = monitor; window.waveform = [];
    monitor.port.onmessage = event => window.waveform.push(event.data);
    const silent = context.createGain(); silent.gain.value = 0; monitor.connect(silent); silent.connect(context.destination);
  });
  await page.getByRole('button', { name: 'Play score', exact: true }).click();
  await page.waitForFunction(() => window.audioEvents.filter(event => event.kind === 'click').length >= 6);
  await page.waitForTimeout(200);
  const data = await page.evaluate(() => ({ events: window.audioEvents, frames: window.frames, waveform: window.waveform, branches: window.branchesConnected, graph: window.branchGraph, rate: window.nativeAudioContext.sampleRate, latency: { base: window.testContext.baseLatency, output: window.testContext.outputLatency } }));
  const instruments = data.events.filter(event => event.kind === 'note'), clicks = data.events.filter(event => event.kind === 'click');
  const audioDeltas = clicks.map(click => Math.min(...instruments.map(note => Math.abs(note.time - click.time)))).slice(0, 5);
  const visualLeads = clicks.slice(1, 5).map((note, index) => {
    const frame = data.frames.find(frame => frame.beat === index + 1);
    assert.ok(frame, 'Each quarter note is highlighted');
    return { raw: (note.time - frame.raw) * 1000, audible: (note.time - frame.audible) * 1000 };
  });
  const pulseLeads = clicks.slice(0, 4).map((click, index) => {
    const frame = data.frames.find(frame => frame.tick >= index + 1);
    assert.ok(frame, 'The visible metronome pulses');
    return (click.time - frame.audible) * 1000;
  });
  assert.ok(data.branches, 'Capture the separate click and instrument branches immediately before their shared output, including instrument envelopes');
  const waveformDeltas = clicks.slice(0, 5).map(note => {
    const onsets = [0, 1].map(channel => {
      for (const chunk of data.waveform) {
        if (chunk.time + 128 / data.rate < note.time || chunk.time > note.time + .2) continue;
        const index = chunk.samples[channel]?.findIndex((value, i) => chunk.time + i / data.rate >= note.time && Math.abs(value) > .001);
        if (index >= 0) return chunk.time + index / data.rate;
      }
      return NaN;
    });
    return (onsets[0] - onsets[1]) * 1000;
  });
  console.log(JSON.stringify({ instrument, clickNoteDeltaMs: audioDeltas.map(value => value * 1000), renderedClickMinusInstrumentMs: waveformDeltas, highlightLeadMs: visualLeads, metronomePulseLeadMs: pulseLeads, latency: data.latency, graph: data.graph, waveform: { chunks: data.waveform.length, first: data.waveform[0]?.time, last: data.waveform.at(-1)?.time, peaks: [0, 1].map(c => Math.max(0, ...data.waveform.map(row => Math.max(0, ...row.samples[c].map(Math.abs))))) } }, null, 2));
  assert.ok(audioDeltas.every(delta => delta < .001), 'Metronome and score notes start on identical audio-clock timestamps');
  assert.ok(waveformDeltas.every(delta => Number.isFinite(delta) && Math.abs(delta) < 50), 'Rendered click and instrument attacks align within 50 ms');
  if (process.argv.includes('--check-visual')) {
    assert.ok(visualLeads.every(lead => Math.abs(lead.audible) < 45), 'Highlights align with the estimated audible output within a few animation frames');
    assert.ok(pulseLeads.every(lead => Math.abs(lead) < 45), 'The metronome indicator follows audible output');
  }
} finally { await browser.close(); }
