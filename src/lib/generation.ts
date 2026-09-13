import { analyzeImage } from './imageAnalysis';
import { hashString } from './utils';
import type { CharacterAppearance } from '../three/characterFactory';

/**
 * Character generation, with two backends behind one interface.
 *
 * `local` reads the upload's pixels and derives a palette and texture. It is
 * honest about what it is: your artwork and colours on a procedural body, not
 * a reconstruction of your image.
 *
 * `service` posts the image to a real image-to-3D provider and returns the
 * mesh it reconstructs. Configure `VITE_MESHSTAGE_GEN_API` to enable it; the
 * studio falls back to `local` whenever it is absent or the job fails, so the
 * pipeline never dead-ends.
 */

export type GenerationMode = 'local' | 'service';

export interface GenerationInput {
  source: 'image' | 'prompt';
  /** Data URL of the upload, for image sources. */
  imageDataUrl?: string | null;
  imageName?: string | null;
  prompt?: string;
}

export interface GenerationOutput {
  mode: GenerationMode;
  /** Derived from pixel content, so different images can never collide. */
  seed: number;
  /** Look derived from the reference. Absent for prompt-only input. */
  appearance?: CharacterAppearance;
  /** URL of a reconstructed GLB, when a provider produced one. */
  meshUrl?: string;
  /** True when the returned mesh carries viseme blendshapes. */
  rigged?: boolean;
  /** Set when a service attempt failed and we fell back. */
  notice?: string;
}

export function generationEndpoint(): string | null {
  const base = import.meta.env.VITE_MESHSTAGE_GEN_API;
  return base ? base.replace(/\/$/, '') : null;
}

export function serviceGenerationConfigured(): boolean {
  return generationEndpoint() !== null;
}

export interface GenerationProgress {
  (stage: string, fraction: number): void;
}

export async function generateCharacterAsset(
  input: GenerationInput,
  onProgress?: GenerationProgress,
  signal?: AbortSignal,
): Promise<GenerationOutput> {
  if (serviceGenerationConfigured() && input.source === 'image' && input.imageDataUrl) {
    try {
      return await generateViaService(input, onProgress, signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      // A provider outage must not block the studio — degrade, and say so.
      const local = await generateLocally(input, onProgress);
      return {
        ...local,
        notice:
          error instanceof Error
            ? `Reconstruction service unavailable (${error.message}). Used your image's colours and artwork instead.`
            : 'Reconstruction service unavailable. Used your image locally instead.',
      };
    }
  }

  return generateLocally(input, onProgress);
}

async function generateLocally(
  input: GenerationInput,
  onProgress?: GenerationProgress,
): Promise<GenerationOutput> {
  if (input.source === 'image' && input.imageDataUrl) {
    onProgress?.('Reading your reference', 0.2);
    const analysis = await analyzeImage(input.imageDataUrl);
    onProgress?.('Sampling palette', 0.6);

    return {
      mode: 'local',
      // Pixel-derived: renaming the file changes nothing, editing one pixel
      // changes everything. The old build hashed the file name instead.
      seed: analysis.contentHash,
      appearance: {
        suit: analysis.dominant,
        accent: analysis.accent,
        shade: analysis.shade,
        lightness: analysis.lightness,
        textureDataUrl: analysis.textureDataUrl,
        mouthAnchor: analysis.mouthAnchor,
      },
    };
  }

  return { mode: 'local', seed: hashString(`prompt:${(input.prompt ?? '').trim()}`) };
}

interface ServiceJob {
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  progress?: number;
  meshUrl?: string;
  rigged?: boolean;
  error?: string;
}

/**
 * Dispatches to the configured provider and polls until the mesh is ready.
 *
 * The shape here is deliberately provider-neutral — Meshy, Tripo and a
 * self-hosted TripoSR all fit the submit/poll/collect pattern. `server/`
 * translates for whichever one you key in, so swapping providers never
 * touches the client.
 */
async function generateViaService(
  input: GenerationInput,
  onProgress?: GenerationProgress,
  signal?: AbortSignal,
): Promise<GenerationOutput> {
  const endpoint = generationEndpoint();
  if (!endpoint) throw new Error('not configured');

  onProgress?.('Uploading reference', 0.08);

  const submit = await fetch(`${endpoint}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: input.imageDataUrl, name: input.imageName }),
    signal,
  });

  if (!submit.ok) {
    throw new Error(`submit returned ${submit.status}`);
  }

  let job = (await submit.json()) as ServiceJob;
  const startedAt = Date.now();
  const TIMEOUT_MS = 5 * 60 * 1000;

  while (job.status === 'queued' || job.status === 'running') {
    if (Date.now() - startedAt > TIMEOUT_MS) throw new Error('timed out after 5 minutes');
    await new Promise((resolve) => setTimeout(resolve, 2500));
    if (signal?.aborted) throw new Error('cancelled');

    const poll = await fetch(`${endpoint}/generate/${encodeURIComponent(job.id)}`, { signal });
    if (!poll.ok) throw new Error(`poll returned ${poll.status}`);

    job = (await poll.json()) as ServiceJob;
    onProgress?.('Reconstructing mesh', 0.1 + (job.progress ?? 0) * 0.8);
  }

  if (job.status === 'failed' || !job.meshUrl) {
    throw new Error(job.error ?? 'the provider returned no mesh');
  }

  onProgress?.('Collecting mesh', 0.95);

  // Still analyse locally: the provider gives geometry, but the palette and
  // a reference texture are useful regardless, and they keep the fallback and
  // the service path visually consistent.
  const analysis = input.imageDataUrl ? await analyzeImage(input.imageDataUrl) : null;

  return {
    mode: 'service',
    seed: analysis?.contentHash ?? hashString(job.id),
    meshUrl: job.meshUrl,
    rigged: job.rigged ?? false,
    appearance: analysis
      ? {
          suit: analysis.dominant,
          accent: analysis.accent,
          shade: analysis.shade,
          lightness: analysis.lightness,
          textureDataUrl: analysis.textureDataUrl,
          mouthAnchor: analysis.mouthAnchor,
        }
      : undefined,
  };
}
