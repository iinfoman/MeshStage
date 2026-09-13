import { createHash, randomUUID } from 'node:crypto';

/**
 * Microsoft Edge read-aloud (Edge-TTS) provider.
 *
 * Edge exposes its neural voices over a WebSocket that speaks a small
 * multipart-ish protocol. The reason it is worth the trouble over the browser's
 * own speechSynthesis: it returns `WordBoundary` metadata with real offsets,
 * which is a far better viseme timing source than any client-side estimate, and
 * it sounds identical on every device instead of varying per phone.
 */

const TRUSTED_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const BASE = 'https://speech.platform.bing.com/consumer/speech/synthesize/readaloud';
const WSS = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TRUSTED_TOKEN}`;
const CHROMIUM_VERSION = '130.0.2849.68';

/** Seconds between the Windows FILETIME epoch and the Unix epoch. */
const WIN_EPOCH_OFFSET = 11_644_473_600;

/**
 * Edge requires a rolling `Sec-MS-GEC` token: SHA-256 of the current Windows
 * FILETIME (in 100ns ticks, floored to a 5-minute window) concatenated with the
 * trusted client token. Without it the socket is closed with a 401.
 */
function securityToken() {
  const unixSeconds = Math.floor(Date.now() / 1000);
  const windowed = Math.floor((unixSeconds + WIN_EPOCH_OFFSET) / 300) * 300;
  const ticks = BigInt(windowed) * 10_000_000n;
  return createHash('sha256').update(`${ticks}${TRUSTED_TOKEN}`).digest('hex').toUpperCase();
}

function headers() {
  return {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
      `Chrome/${CHROMIUM_VERSION} Safari/537.36 Edg/${CHROMIUM_VERSION}`,
    Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
  };
}

export async function listVoices() {
  const url = `${BASE}/voices/list?trustedclienttoken=${TRUSTED_TOKEN}&Sec-MS-GEC=${securityToken()}&Sec-MS-GEC-Version=1-${CHROMIUM_VERSION}`;
  const response = await fetch(url, { headers: headers() });
  if (!response.ok) throw new Error(`Edge voice list failed: ${response.status}`);

  const raw = await response.json();
  return raw.map((voice) => ({
    id: voice.ShortName,
    name: voice.FriendlyName?.replace(/^Microsoft /, '').replace(/ - .*$/, '') ?? voice.ShortName,
    lang: voice.Locale,
    gender: voice.Gender?.toLowerCase() ?? 'unknown',
    provider: 'edge',
    neural: true,
  }));
}

function escapeXml(text) {
  return text.replace(/[<>&'"]/g, (char) => `&${{ '<': 'lt', '>': 'gt', '&': 'amp', "'": 'apos', '"': 'quot' }[char]};`);
}

/** Edge takes rate/pitch as signed percentages, not multipliers. */
function toPercent(multiplier) {
  return `${Math.round((multiplier - 1) * 100)}%`;
}

/**
 * Synthesises one utterance. Resolves with MP3 bytes plus the word-boundary
 * marks Edge emits alongside the audio.
 */
export async function synthesize({ text, voiceId, rate = 1, pitch = 1 }) {
  const url = `${WSS}&Sec-MS-GEC=${securityToken()}&Sec-MS-GEC-Version=1-${CHROMIUM_VERSION}&ConnectionId=${randomUUID().replace(/-/g, '')}`;
  const socket = new WebSocket(url, { headers: headers() });
  socket.binaryType = 'arraybuffer';

  return new Promise((resolve, reject) => {
    const chunks = [];
    const marks = [];
    let settled = false;

    const fail = (error) => {
      if (settled) return;
      settled = true;
      try { socket.close(); } catch { /* already closing */ }
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    const timer = setTimeout(() => fail(new Error('Edge TTS timed out after 30s')), 30_000);

    socket.onopen = () => {
      socket.send(
        `Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n${JSON.stringify({
          context: {
            synthesis: {
              audio: {
                metadataoptions: { sentenceBoundaryEnabled: false, wordBoundaryEnabled: true },
                outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
              },
            },
          },
        })}`,
      );

      const ssml =
        `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">` +
        `<voice name="${voiceId}">` +
        `<prosody rate="${toPercent(rate)}" pitch="${toPercent(pitch)}">${escapeXml(text)}</prosody>` +
        `</voice></speak>`;

      socket.send(
        `X-RequestId:${randomUUID().replace(/-/g, '')}\r\nContent-Type:application/ssml+xml\r\n` +
          `X-Timestamp:${new Date().toISOString()}Z\r\nPath:ssml\r\n\r\n${ssml}`,
      );
    };

    socket.onmessage = (event) => {
      // Text frames carry control messages and word-boundary metadata.
      if (typeof event.data === 'string') {
        if (event.data.includes('Path:turn.end')) {
          clearTimeout(timer);
          settled = true;
          socket.close();
          const audio = Buffer.concat(chunks);
          resolve({
            provider: 'edge',
            mimeType: 'audio/mpeg',
            audio,
            marks,
            // Edge reports offsets in 100ns ticks from the start of the audio.
            durationMs: marks.length ? marks[marks.length - 1].timeMs + marks[marks.length - 1].durationMs : 0,
          });
          return;
        }

        if (event.data.includes('Path:audio.metadata')) {
          const body = event.data.slice(event.data.indexOf('\r\n\r\n') + 4);
          try {
            for (const entry of JSON.parse(body).Metadata ?? []) {
              if (entry.Type !== 'WordBoundary') continue;
              marks.push({
                type: 'word',
                timeMs: Math.round(entry.Data.Offset / 10_000),
                durationMs: Math.round(entry.Data.Duration / 10_000),
                text: entry.Data.text?.Text ?? '',
              });
            }
          } catch {
            // Malformed metadata is not fatal — we still have audio.
          }
        }
        return;
      }

      // Binary frames are `<2-byte big-endian header length><header><mp3 bytes>`.
      const view = new DataView(event.data);
      const headerLength = view.getUint16(0);
      chunks.push(Buffer.from(event.data, 2 + headerLength));
    };

    socket.onerror = () => fail(new Error('Edge TTS socket error — check network egress to speech.platform.bing.com'));
    socket.onclose = (event) => {
      if (settled) return;
      clearTimeout(timer);
      fail(new Error(`Edge TTS closed early (code ${event.code}). A 1002/1007 usually means an expired Sec-MS-GEC token.`));
    };
  });
}
