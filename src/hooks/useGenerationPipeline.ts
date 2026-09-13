import { useEffect, useRef } from 'react';
import { hashString, makeRandom } from '../lib/utils';
import { BLENDSHAPE_COUNT, RIG_BONE_COUNT } from '../three/characterFactory';
import type { CharacterAsset, InputMode, StudioState } from '../types/studio';
import type { StudioAction } from '../state/studioReducer';

/**
 * Drives the stage-2 progress readout.
 *
 * This is the seam where a real backend goes: swap the rAF ticker for a
 * WebSocket or SSE subscription on the reconstruction job and dispatch the
 * same `pipelineProgress` / `generationComplete` actions.
 */
const PHASE_DURATION_MS = 7600;

export function useGenerationPipeline(
  state: StudioState,
  dispatch: React.Dispatch<StudioAction>,
): void {
  const frameRef = useRef(0);
  const startRef = useRef(0);

  const running = state.pipeline.running;

  useEffect(() => {
    if (!running) return;

    startRef.current = performance.now();
    const sourceLabel =
      state.inputMode === 'image' ? (state.imageName ?? 'reference.jpg') : state.prompt.trim();

    const tick = (now: number) => {
      const elapsed = now - startRef.current;
      const linear = Math.min(1, elapsed / PHASE_DURATION_MS);
      // Ease-out so the bar moves fast early and settles into the last few
      // percent — matching how real reconstruction jobs actually feel.
      const eased = 1 - Math.pow(1 - linear, 1.7);

      if (eased >= 1) {
        dispatch({ type: 'pipelineProgress', progress: 1 });
        dispatch({
          type: 'generationComplete',
          character: buildCharacter(state.inputMode, sourceLabel),
        });
        return;
      }

      dispatch({ type: 'pipelineProgress', progress: eased });
      frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
    // Intentionally keyed on `running` only: re-subscribing on every progress
    // dispatch would restart the job from zero.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, dispatch]);
}

const ADJECTIVES = ['Neon', 'Obsidian', 'Solar', 'Vector', 'Halcyon', 'Nova', 'Cobalt', 'Onyx'];
const NOUNS = ['Envoy', 'Drifter', 'Herald', 'Cipher', 'Sentinel', 'Aviator', 'Warden', 'Muse'];

export function buildCharacter(source: InputMode, sourceLabel: string): CharacterAsset {
  const seed = hashString(`${source}:${sourceLabel}`);
  const random = makeRandom(seed);
  const name = `${ADJECTIVES[Math.floor(random() * ADJECTIVES.length)]} ${
    NOUNS[Math.floor(random() * NOUNS.length)]
  }`;

  return {
    id: `msc_${seed.toString(36)}`,
    seed,
    name,
    source,
    sourceLabel,
    createdAt: Date.now(),
    polycount: 18_000 + Math.floor(random() * 14_000),
    // Read from the rig factory so the stats chip never drifts from the asset.
    boneCount: RIG_BONE_COUNT,
    blendshapeCount: BLENDSHAPE_COUNT,
  };
}
