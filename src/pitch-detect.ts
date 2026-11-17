import { PitchDetector } from 'pitchy';
import type { PitchFrame } from './pitch';

/** Runs in a worker; only estimates leave it, and sample windows are discarded. */
export class PitchAnalysis {
  private detector?: PitchDetector<Float32Array>;
  analyze(samples: Float32Array, sampleRate: number, time: number): PitchFrame {
    let energy = 0, peak = 0;
    for (const value of samples) { energy += value * value; peak = Math.max(peak, Math.abs(value)); }
    const rms = Math.sqrt(energy / samples.length);
    const frame: PitchFrame = { time, windowSeconds: samples.length / sampleRate, frequency: null, clarity: 0, rms };
    if (rms < .0001 || peak >= .98) return frame;
    if (this.detector?.inputLength !== samples.length) {
      this.detector = PitchDetector.forFloat32Array(samples.length);
      this.detector.clarityThreshold = .95;
    }
    const [frequency, clarity] = this.detector.findPitch(samples, sampleRate);
    return { ...frame, clarity, frequency: Number.isFinite(frequency) && frequency >= 30 && frequency <= 4000 && clarity >= .9 ? frequency : null };
  }
}
