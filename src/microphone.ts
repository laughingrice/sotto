import * as Tone from 'tone';
import type { LevelFrame } from './rhythm';

const modules = new WeakMap<AudioWorklet, Promise<void>>();
async function loadProcessor(worklet: AudioWorklet | undefined) {
  if (!worklet) throw new Error('This browser does not support microphone analysis with AudioWorklet. Try a current Safari, Chrome or Edge over HTTPS.');
  let pending = modules.get(worklet);
  if (!pending) {
    pending = worklet.addModule(`${import.meta.env.BASE_URL}rhythm-worklet.js`).catch(error => { modules.delete(worklet); throw error; });
    modules.set(worklet, pending);
  }
  await pending;
}

export class MicrophoneInput {
  private stream?: MediaStream;
  private source?: MediaStreamAudioSourceNode;
  private worklet?: AudioWorkletNode;
  private sink?: GainNode;
  private version = 0;
  private pulses = new Set<AudioBufferSourceNode>();
  onFrame: (frame: LevelFrame) => void = () => {};
  onEnded: (message: string) => void = () => {};
  get time() { return Tone.immediate(); }
  async start(deviceId = '') {
    this.stop();
    const version = this.version;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access needs HTTPS or localhost. Use the deployed Sotto site on your tablet.');
    await Tone.start();
    if (version !== this.version) return false;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: {
      echoCancellation: false, noiseSuppression: false, autoGainControl: false,
      channelCount: 1, ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    } });
    if (version !== this.version) { stream.getTracks().forEach(track => track.stop()); return false; }
    this.stream = stream;
    try {
      const context = Tone.getContext();
      if (context.rawContext.state !== 'running') await (context.rawContext as AudioContext).resume();
      await loadProcessor(context.rawContext.audioWorklet);
      if (version !== this.version) return false;
      const source = (context.rawContext as AudioContext).createMediaStreamSource(stream);
      this.source = source;
      this.worklet = context.createAudioWorkletNode('sotto-level', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      this.sink = context.rawContext.createGain(); this.sink.gain.value = 0;
      source.connect(this.worklet); this.worklet.connect(this.sink); this.sink.connect(context.rawContext.destination);
      this.worklet.port.onmessage = event => this.onFrame(event.data as LevelFrame);
      this.worklet.onprocessorerror = () => { this.stop(); this.onEnded('The microphone processor stopped. Enable the microphone again to retry.'); };
      stream.getAudioTracks().forEach(track => { track.onended = () => { this.stop(); this.onEnded('Microphone access ended. Enable the microphone to reconnect.'); }; });
      return true;
    } catch (error) { if (version !== this.version) { stream.getTracks().forEach(track => track.stop()); return false; } this.stop(); throw error; }
  }
  calibrationPulses() {
    const context = Tone.getContext().rawContext;
    const buffer = context.createBuffer(1, Math.round(context.sampleRate * .04), context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) {
      const time = i / context.sampleRate;
      samples[i] = .3 * Math.sin(2 * Math.PI * 1600 * time) * Math.exp(-time * 130) * Math.min(1, time / .001);
    }
    const times = Array.from({ length: 6 }, (_, i) => context.currentTime + .5 + i * .8);
    times.forEach(time => {
      const source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination);
      source.onended = () => { source.disconnect(); this.pulses.delete(source); };
      this.pulses.add(source); source.start(time);
    });
    return times;
  }
  cancelCalibration() { this.pulses.forEach(source => source.stop()); this.pulses.clear(); }
  stop() {
    this.version++;
    this.cancelCalibration();
    this.worklet?.port.close(); this.worklet?.disconnect(); this.worklet = undefined;
    this.source?.disconnect(); this.source = undefined; this.sink?.disconnect(); this.sink = undefined;
    this.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); }); this.stream = undefined;
  }
}
