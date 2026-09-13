import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Local espeak-ng provider.
 *
 * Offline, dependency-light and deterministic, which makes it the right
 * fallback when the Edge service is unreachable (locked-down networks, air-
 * gapped deploys, CI) and the right thing to develop against. It sounds
 * robotic — that is the trade, and the UI labels it accordingly.
 */

/** espeak-ng exposes ~130 base voices; variants multiply that into thousands. */
export async function listVoices() {
  const { stdout } = await run('espeak-ng', ['--voices'], { maxBuffer: 4 * 1024 * 1024 });

  return stdout
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s+/);
      const lang = parts[1];
      const name = parts[3];
      if (!lang || !name) return null;
      return {
        id: lang,
        name: name.replace(/_/g, ' '),
        lang,
        gender: parts[2]?.includes('F') ? 'female' : 'male',
        provider: 'espeak',
        neural: false,
      };
    })
    .filter(Boolean);
}

/** espeak's -s flag is words/minute; 175 is its default and our 1.0×. */
const BASE_WPM = 175;

export async function synthesize({ text, voiceId, rate = 1, pitch = 1 }) {
  const args = [
    '-v', voiceId || 'en-us',
    '-s', String(Math.round(BASE_WPM * Math.min(2, Math.max(0.5, rate)))),
    // espeak pitch is 0-99 with 50 as neutral.
    '-p', String(Math.round(Math.min(99, Math.max(0, 50 * pitch)))),
    '--stdout',
    text,
  ];

  const { stdout } = await run('espeak-ng', args, {
    encoding: 'buffer',
    maxBuffer: 32 * 1024 * 1024,
  });

  // espeak streams to stdout, so it writes placeholder chunk sizes it never
  // goes back to fix. Repair them before handing the buffer to a decoder.
  const audio = repairWavHeader(stdout);

  return {
    provider: 'espeak',
    mimeType: 'audio/wav',
    audio,
    // espeak-ng gives no word-boundary events, so the client scales its own
    // estimated timeline to the real audio duration instead.
    marks: [],
    durationMs: wavDurationMs(audio),
  };
}

/**
 * Rewrites the RIFF and `data` chunk sizes to match the bytes actually present.
 *
 * Streaming encoders emit a placeholder (espeak uses 0x7FFFFFC0) because they
 * don't know the length up front. Chrome's `decodeAudioData` tolerates that;
 * Safari does not, and returns a decode error — so we fix it server-side rather
 * than debug it per browser.
 */
function repairWavHeader(buffer) {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF') return buffer;

  const out = Buffer.from(buffer);
  let offset = 12;

  while (offset + 8 <= out.length) {
    const id = out.toString('ascii', offset, offset + 4);
    const declared = out.readUInt32LE(offset + 4);
    const available = out.length - (offset + 8);

    if (id === 'data') {
      if (declared > available) out.writeUInt32LE(available, offset + 4);
      out.writeUInt32LE(out.length - 8, 4);
      return out;
    }

    if (declared > available) break;
    offset += 8 + declared + (declared % 2);
  }

  return out;
}

/** Reads the duration out of a RIFF/WAVE header without decoding the samples. */
function wavDurationMs(buffer) {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF') return 0;

  let offset = 12;
  let byteRate = 0;

  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const declared = buffer.readUInt32LE(offset + 4);
    const available = buffer.length - (offset + 8);
    const size = Math.min(declared, available);

    if (id === 'fmt ') byteRate = buffer.readUInt32LE(offset + 16);
    if (id === 'data' && byteRate > 0) return Math.round((size / byteRate) * 1000);

    offset += 8 + size + (size % 2);
  }
  return 0;
}

export async function isAvailable() {
  try {
    await run('espeak-ng', ['--version']);
    return true;
  } catch {
    return false;
  }
}
