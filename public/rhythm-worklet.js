/* Level summaries, plus optional transient pitch-analysis windows. No recording. */
class SottoLevelProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sum = 0; this.peak = 0; this.count = 0;
    this.window = Math.round(sampleRate * .01);
    this.pitchEnabled = false; this.pitchEpoch = 0;
    this.pitchShortLength = 2 ** Math.ceil(Math.log2(sampleRate * .075));
    this.pitchRing = new Float32Array(this.pitchShortLength * 2);
    this.pitchIndex = 0; this.pitchCount = 0; this.pitchSince = 0;
    this.port.onmessage = ({ data }) => {
      if (data.type !== 'pitch') return;
      this.pitchEnabled = data.enabled; this.pitchEpoch = data.epoch;
      this.pitchRing.fill(0);
      this.pitchIndex = 0; this.pitchCount = 0; this.pitchSince = 0;
    };
  }
  process(inputs, outputs) {
    for (const channel of outputs[0] ?? []) channel.fill(0);
    const channels = inputs[0];
    if (!channels?.length || !channels[0].length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let sample = 0;
      for (const channel of channels) sample += channel[i] / channels.length;
      if (this.pitchEnabled) {
        this.pitchRing[this.pitchIndex] = sample;
        this.pitchIndex = (this.pitchIndex + 1) % this.pitchRing.length;
        this.pitchCount++; this.pitchSince++;
        if (this.pitchCount >= this.pitchShortLength && this.pitchSince >= sampleRate * .04) {
          const length = this.pitchCount >= this.pitchRing.length ? this.pitchRing.length : this.pitchShortLength;
          const samples = new Float32Array(length);
          const start = (this.pitchIndex - length + this.pitchRing.length) % this.pitchRing.length;
          const first = Math.min(length, this.pitchRing.length - start);
          samples.set(this.pitchRing.subarray(start, start + first));
          samples.set(this.pitchRing.subarray(0, length - first), first);
          this.port.postMessage({ type: 'pitch', epoch: this.pitchEpoch, samples, sampleRate,
            time: (currentFrame + i + 1 - samples.length / 2) / sampleRate }, [samples.buffer]);
          this.pitchSince = 0;
        }
      }
      this.sum += sample * sample; this.peak = Math.max(this.peak, Math.abs(sample)); this.count++;
      if (this.count >= this.window) {
        this.port.postMessage({ time: (currentFrame + i + 1 - this.count / 2) / sampleRate,
          rms: Math.sqrt(this.sum / this.count), peak: this.peak });
        this.sum = 0; this.peak = 0; this.count = 0;
      }
    }
    return true;
  }
}
registerProcessor('sotto-level', SottoLevelProcessor);
