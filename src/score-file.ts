import { validateScore, type Score } from './score';

export const MAX_SCORE_BYTES = 15_000_000;
export const isScoreFile = (name: string) => /\.sotto(?:\.json)?$/i.test(name);
export const scoreFileStem = (name: string) => name.replace(/\.sotto(?:\.json)?$/i, '');

/** Bound the expanded data too: a tiny gzip file can contain a very large score. */
async function boundedBytes(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error('Score exceeds the 15 MB uncompressed limit.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export async function readScoreFile(file: Blob): Promise<Score> {
  if (file.size > MAX_SCORE_BYTES) throw new Error('Please use a score bundle smaller than 15 MB.');
  const magic = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  let bytes: Uint8Array;
  if (magic[0] === 0x1f && magic[1] === 0x8b) {
    if (typeof DecompressionStream === 'undefined') throw new Error('Please update your browser to open compressed Sotto scores.');
    try { bytes = await boundedBytes(file.stream().pipeThrough(new DecompressionStream('gzip')), MAX_SCORE_BYTES); }
    catch (error) {
      if (error instanceof Error && error.message.includes('15 MB')) throw error;
      throw new Error('This compressed score is damaged or incomplete. Please download it again.');
    }
  } else bytes = new Uint8Array(await file.arrayBuffer());
  let score: unknown;
  try { score = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new Error('This is not a readable Sotto score. Open a .sotto or .sotto.json file.'); }
  validateScore(score);
  return score;
}

export async function writeScoreFile(score: Score): Promise<Blob> {
  const source = new Blob([JSON.stringify(score)], { type: 'application/json' });
  if (source.size > MAX_SCORE_BYTES) throw new Error('Score exceeds the 15 MB uncompressed limit.');
  if (typeof CompressionStream === 'undefined') throw new Error('Please update your browser to save compressed Sotto scores.');
  return new Response(source.stream().pipeThrough(new CompressionStream('gzip'))).blob();
}
