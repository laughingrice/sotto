import { PitchAnalysis } from './pitch-detect';
const analysis = new PitchAnalysis();
type Window = { time: number; sampleRate: number; samples: Float32Array; epoch: number };
const scope = self as unknown as { onmessage: (event: MessageEvent<Window>) => void; postMessage(value: unknown): void };
scope.onmessage = ({ data }) => {
  scope.postMessage({ ...analysis.analyze(data.samples, data.sampleRate, data.time), epoch: data.epoch });
};
