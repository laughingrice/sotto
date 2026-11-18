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

async function decodeScoreFile(file: Blob): Promise<Score> {
  if (file.size > MAX_SCORE_BYTES) throw new Error('Please use a score bundle smaller than 15 MB.');
  // Snapshot the chosen file once. Some cloud-backed browser File references
  // become unreadable later; source-read failures must remain distinguishable
  // from errors in a gzip payload.
  const source = new Uint8Array(await file.arrayBuffer());
  let bytes: Uint8Array;
  if (source[0] === 0x1f && source[1] === 0x8b) {
    if (typeof DecompressionStream === 'undefined') throw new Error('Please update your browser to open compressed Sotto scores.');
    try { bytes = await boundedBytes(new Blob([source]).stream().pipeThrough(new DecompressionStream('gzip')), MAX_SCORE_BYTES); }
    catch (error) {
      if (error instanceof Error && error.message.includes('15 MB')) throw error;
      throw new Error('This compressed score is damaged or incomplete. Please download it again.');
    }
  } else bytes = source;
  let score: unknown;
  try { score = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new Error('This is not a readable Sotto score. Open a .sotto or .sotto.json file.'); }
  validateScore(score);
  return score;
}

/** File providers can stall as well as reject. A late result never opens a score. */
export async function readScoreFile(file: Blob, timeoutMs = 20000): Promise<Score> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new Error('The file provider did not finish reading the score.');
      error.name = 'TimeoutError'; reject(error);
    }, timeoutMs);
  });
  try { return await Promise.race([decodeScoreFile(file), timeout]); }
  finally { clearTimeout(timer); }
}

export async function writeScoreFile(score: Score): Promise<Blob> {
  const source = new Blob([JSON.stringify(score)], { type: 'application/json' });
  if (source.size > MAX_SCORE_BYTES) throw new Error('Score exceeds the 15 MB uncompressed limit.');
  if (typeof CompressionStream === 'undefined') throw new Error('Please update your browser to save compressed Sotto scores.');
  return new Response(source.stream().pipeThrough(new CompressionStream('gzip'))).blob();
}

export function fileAccessError(error: unknown, name: string): Error | null {
  const kind = error && typeof error === 'object' && 'name' in error ? error.name : '';
  if (!['AbortError', 'NotReadableError', 'NotFoundError', 'NotAllowedError', 'SecurityError', 'InvalidStateError', 'TimeoutError'].includes(String(kind))) return null;
  return new Error(`The browser can no longer read “${name}” from this selection. Reconnect its file or folder and try again. If it was moved or removed, refresh the folder listing.`);
}
