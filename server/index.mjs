import { createServer } from 'node:http';
import * as edge from './providers/edge.mjs';
import * as espeak from './providers/espeak.mjs';
import * as reconstruct from './providers/reconstruct.mjs';

/**
 * MeshStage TTS + conversion service.
 *
 * Dependency-free on purpose: Node 22's built-in `fetch` and `WebSocket` cover
 * everything the Edge provider needs, so this drops into a container without a
 * package install. Point the studio at it with:
 *
 *   VITE_MESHSTAGE_API=http://localhost:8787
 */

const PORT = Number(process.env.PORT ?? 8787);

/** Comma-separated, in priority order. Default prefers Edge, falls back local. */
const ENABLED = (process.env.MESHSTAGE_TTS_PROVIDERS ?? 'edge,espeak').split(',').map((s) => s.trim());

const PROVIDERS = { edge, espeak };

/** Cached voice catalogue — the Edge list is ~500 voices and rarely changes. */
let voiceCache = null;
let voiceCacheAt = 0;
const VOICE_TTL_MS = 10 * 60 * 1000;

async function collectVoices() {
  if (voiceCache && Date.now() - voiceCacheAt < VOICE_TTL_MS) return voiceCache;

  const voices = [];
  const errors = [];

  for (const name of ENABLED) {
    const provider = PROVIDERS[name];
    if (!provider) continue;
    if (provider.isAvailable && !(await provider.isAvailable())) {
      errors.push(`${name}: not installed`);
      continue;
    }
    try {
      voices.push(...(await provider.listVoices()));
    } catch (error) {
      // One provider being unreachable must not empty the whole catalogue.
      errors.push(`${name}: ${error.message}`);
    }
  }

  voiceCache = { voices, errors };
  voiceCacheAt = Date.now();
  return voiceCache;
}

async function synthesize(body) {
  const text = String(body.text ?? '').slice(0, 2000);
  if (!text.trim()) throw new HttpError(400, 'text is required');

  // An explicit provider wins; otherwise try each enabled one in order.
  const order = body.provider ? [body.provider] : ENABLED;
  const failures = [];

  for (const name of order) {
    const provider = PROVIDERS[name];
    if (!provider) continue;
    if (provider.isAvailable && !(await provider.isAvailable())) continue;

    try {
      return await provider.synthesize({
        text,
        voiceId: body.voiceId,
        rate: Number(body.rate) || 1,
        pitch: Number(body.pitch) || 1,
      });
    } catch (error) {
      failures.push(`${name}: ${error.message}`);
    }
  }

  throw new HttpError(502, `No TTS provider succeeded. ${failures.join(' | ')}`);
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.MESHSTAGE_CORS_ORIGIN ?? '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new HttpError(413, 'Request body too large');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
}

const server = createServer(async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.writeHead(204).end();

  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (url.pathname === '/health') {
      return json(res, 200, {
        ok: true,
        providers: ENABLED,
        reconstruction: reconstruct.isConfigured()
          ? (process.env.MESHSTAGE_RECONSTRUCT_PROVIDER ?? 'unknown')
          : 'not configured',
      });
    }

    if (url.pathname === '/tts/voices' && req.method === 'GET') {
      const { voices, errors } = await collectVoices();
      return json(res, 200, { voices, errors });
    }

    if (url.pathname === '/tts/synthesize' && req.method === 'POST') {
      const result = await synthesize(await readJson(req));
      return json(res, 200, {
        provider: result.provider,
        mimeType: result.mimeType,
        durationMs: result.durationMs,
        marks: result.marks,
        audio: result.audio.toString('base64'),
      });
    }

    // --- Image-to-3D reconstruction ----------------------------------------
    if (url.pathname === '/generate' && req.method === 'POST') {
      const body = await readJson(req);
      if (!body.image) throw new HttpError(400, 'image is required');
      return json(res, 200, await reconstruct.submit({ image: body.image }));
    }

    if (url.pathname.startsWith('/generate/') && req.method === 'GET') {
      const job = reconstruct.get(decodeURIComponent(url.pathname.slice('/generate/'.length)));
      if (!job) throw new HttpError(404, 'No such job');
      return json(res, 200, job);
    }

    if (url.pathname === '/library' && req.method === 'POST') {
      // Reference stub: persist to your datastore here.
      await readJson(req);
      return json(res, 200, { ok: true });
    }

    if (url.pathname === '/convert' && req.method === 'POST') {
      return json(res, 501, {
        error:
          'FBX conversion is not implemented in the reference server. Wire the Autodesk FBX SDK or a FBX2glTF round-trip here.',
      });
    }

    return json(res, 404, { error: `No route for ${req.method} ${url.pathname}` });
  } catch (error) {
    const status = error.status ?? 500;
    if (status >= 500) console.error(`[meshstage] ${req.method} ${url.pathname}:`, error.message);
    return json(res, status, { error: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`[meshstage] TTS service on http://localhost:${PORT} — providers: ${ENABLED.join(', ')}`);
});
