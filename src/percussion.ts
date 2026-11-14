/** Small local drum kit: no sample download is needed for accompaniment. */
export function drumSamples(midi: number, sampleRate: number): Float32Array {
  const kick = midi === 35 || midi === 36;
  const snare = midi === 38 || midi === 40;
  const hat = [42, 44, 46].includes(midi);
  const tom = [41, 43, 45, 47, 48, 50].includes(midi);
  const length = kick ? .5 : snare ? .25 : midi === 46 ? .65 : hat ? .09 : .4;
  const samples = new Float32Array(Math.ceil(sampleRate * length));
  let phase = 0, previousNoise = 0, seed = midi + 1;
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = seed / 0x80000000 - 1;
    const highNoise = (noise - previousNoise) * .5;
    previousNoise = noise;
    phase += 2 * Math.PI * (kick ? 48 + 110 * Math.exp(-t * 45) : tom ? 80 + (midi - 41) * 12 : 180) / sampleRate;
    const attack = Math.min(1, t / .001);
    samples[i] = attack * (kick ? .9 * Math.sin(phase) * Math.exp(-t * 12) :
      snare ? (.65 * highNoise + .25 * Math.sin(phase)) * Math.exp(-t * 22) :
      tom ? .8 * Math.sin(phase) * Math.exp(-t * 14) :
      .65 * highNoise * Math.exp(-t * (midi === 46 ? 8 : hat ? 65 : 16)));
  }
  return samples;
}
