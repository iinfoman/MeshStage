import type { Config, Context } from '@netlify/functions';
import * as edge from '../../server/providers/edge.mjs';

/**
 * Serverless build of the MeshStage TTS service.
 *
 * Shares `server/providers/edge.mjs` with the standalone Node server so there
 * is one implementation of the Edge protocol. The espeak provider is
 * deliberately absent: there is no `espeak-ng` binary in the Lambda image, so
 * a deployed site is Edge-only and says so rather than failing obscurely.
 */

interface Voice {
  id: string;
  name: string;
  lang: string;
  gender: string;
  provider: string;
  neural: boolean;
}

/** Voice lists are ~500 entries and change rarely; cache per warm container. */
let voiceCache: { voices: Voice[]; at: number } | null = null;
const VOICE_TTL_MS = 10 * 60 * 1000;

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      // Same-origin in production; permissive so a local `npm run dev` can
      // point VITE_MESHSTAGE_API at the deployed function.
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    },
  });
}

export default async (request: Request, _context: Context): Promise<Response> => {
  if (request.method === 'OPTIONS') {
    return json({}, 204);
  }

  const url = new URL(request.url);
  const route = url.pathname.replace(/^\/api/, '') || '/';

  try {
    if (route === '/health') {
      return json({ ok: true, providers: ['edge'], runtime: 'netlify-functions' });
    }

    if (route === '/tts/voices' && request.method === 'GET') {
      if (voiceCache && Date.now() - voiceCache.at < VOICE_TTL_MS) {
        return json({ voices: voiceCache.voices, errors: [] });
      }

      try {
        const voices = (await edge.listVoices()) as Voice[];
        voiceCache = { voices, at: Date.now() };
        return json({ voices, errors: [] });
      } catch (error) {
        // An unreachable Edge service must not empty the catalogue — the
        // studio falls back to the device's own voices.
        return json({ voices: [], errors: [`edge: ${(error as Error).message}`] });
      }
    }

    if (route === '/tts/synthesize' && request.method === 'POST') {
      const body = (await request.json()) as {
        text?: string;
        voiceId?: string;
        rate?: number;
        pitch?: number;
      };

      const text = String(body.text ?? '').slice(0, 2000);
      if (!text.trim()) return json({ error: 'text is required' }, 400);

      const result = (await edge.synthesize({
        text,
        voiceId: body.voiceId || 'en-US-AriaNeural',
        rate: Number(body.rate) || 1,
        pitch: Number(body.pitch) || 1,
      })) as {
        provider: string;
        mimeType: string;
        durationMs: number;
        marks: unknown[];
        audio: Buffer;
      };

      return json({
        provider: result.provider,
        mimeType: result.mimeType,
        durationMs: result.durationMs,
        marks: result.marks,
        audio: result.audio.toString('base64'),
      });
    }

    if (route === '/library' && request.method === 'POST') {
      // Reference stub. Persist to Netlify Blobs or your own datastore here.
      await request.json().catch(() => ({}));
      return json({ ok: true, stored: false, note: 'Demo deploy does not persist the library.' });
    }

    if (route === '/convert' && request.method === 'POST') {
      return json(
        {
          error:
            'FBX conversion needs the Autodesk FBX SDK, which cannot run in a serverless function. Use .GLB — it carries the same skeleton and morph targets.',
        },
        501,
      );
    }

    return json({ error: `No route for ${request.method} ${route}` }, 404);
  } catch (error) {
    return json({ error: (error as Error).message }, 500);
  }
};

export const config: Config = {
  path: '/api/*',
};
