import { useEffect, useRef } from 'react';
import { generateCharacterAsset, type GenerationOutput } from '../lib/generation';
import { makeRandom } from '../lib/utils';
import { BLENDSHAPE_COUNT, RIG_BONE_COUNT } from '../three/characterFactory';
import type { CharacterAsset, InputMode, StudioState } from '../types/studio';
import type { StudioAction } from '../state/studioReducer';

/**
 * Drives stage 2.
 *
 * The work here is real: an uploaded image is decoded and its pixels sampled
 * to derive the character's palette, artwork and seed. When a reconstruction
 * provider is configured the job is dispatched to it instead, and this hook
 * follows the provider's own progress rather than a timer.
 */

/** Floor for the local path, so the stage doesn't flash past unreadably. */
const MIN_VISIBLE_MS = 4200;

export function useGenerationPipeline(
  state: StudioState,
  dispatch: React.Dispatch<StudioAction>,
): void {
  const frameRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const running = state.pipeline.running;

  // Read through refs so the effect can key on `running` alone; re-running it
  // on every progress dispatch would restart the job from zero.
  const inputRef = useRef(state);
  inputRef.current = state;

  useEffect(() => {
    if (!running) return;

    const controller = new AbortController();
    abortRef.current = controller;

    const snapshot = inputRef.current;
    const startedAt = performance.now();
    let reported = 0;
    let finished = false;

    // The real work can finish in well under a second for a small image, so a
    // smooth floor keeps the three phases legible instead of flickering by.
    const tick = () => {
      if (finished || controller.signal.aborted) return;
      const elapsed = (performance.now() - startedAt) / MIN_VISIBLE_MS;
      const eased = 1 - Math.pow(1 - Math.min(1, elapsed), 1.7);
      const progress = Math.min(0.97, Math.max(reported, eased));
      dispatch({ type: 'pipelineProgress', progress });
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);

    void generateCharacterAsset(
      {
        source: snapshot.inputMode,
        imageDataUrl: snapshot.imageDataUrl,
        imageName: snapshot.imageName,
        prompt: snapshot.prompt,
      },
      (_stage, fraction) => {
        reported = Math.max(reported, fraction * 0.97);
      },
      controller.signal,
    )
      .then(async (output) => {
        // Hold the stage open long enough to read, then finish.
        const remaining = MIN_VISIBLE_MS - (performance.now() - startedAt);
        if (remaining > 0) {
          await new Promise((resolve) => setTimeout(resolve, remaining));
        }
        if (controller.signal.aborted) return;

        finished = true;
        cancelAnimationFrame(frameRef.current);
        dispatch({ type: 'pipelineProgress', progress: 1 });
        dispatch({
          type: 'generationComplete',
          character: buildCharacter(snapshot.inputMode, labelFor(snapshot), output),
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        finished = true;
        cancelAnimationFrame(frameRef.current);
        dispatch({
          type: 'generationFailed',
          message:
            error instanceof Error
              ? `Could not build a character: ${error.message}`
              : 'Could not build a character from that input.',
        });
      });

    return () => {
      controller.abort();
      cancelAnimationFrame(frameRef.current);
    };
  }, [running, dispatch]);
}

function labelFor(state: StudioState): string {
  return state.inputMode === 'image' ? (state.imageName ?? 'reference') : state.prompt.trim();
}

const ADJECTIVES = ['Neon', 'Obsidian', 'Solar', 'Vector', 'Halcyon', 'Nova', 'Cobalt', 'Onyx'];
const NOUNS = ['Envoy', 'Drifter', 'Herald', 'Cipher', 'Sentinel', 'Aviator', 'Warden', 'Muse'];

export function buildCharacter(
  source: InputMode,
  sourceLabel: string,
  output: GenerationOutput,
): CharacterAsset {
  const random = makeRandom(output.seed);
  const name = `${ADJECTIVES[Math.floor(random() * ADJECTIVES.length)]} ${
    NOUNS[Math.floor(random() * NOUNS.length)]
  }`;

  return {
    id: `msc_${output.seed.toString(36)}`,
    seed: output.seed,
    name,
    source,
    sourceLabel,
    createdAt: Date.now(),
    polycount: 18_000 + Math.floor(random() * 14_000),
    boneCount: RIG_BONE_COUNT,
    blendshapeCount: BLENDSHAPE_COUNT,
    appearance: output.appearance,
    mode: output.mode,
    meshUrl: output.meshUrl,
    notice: output.notice,
  };
}
