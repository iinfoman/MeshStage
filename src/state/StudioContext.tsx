import {
  createContext,
  useContext,
  useMemo,
  useReducer,
  useRef,
  type Dispatch,
  type ReactNode,
} from 'react';
import { initialState, studioReducer, type StudioAction } from './studioReducer';
import { useAudioUnlock, type AudioUnlockApi } from '../hooks/useAudioUnlock';
import { useGenerationPipeline } from '../hooks/useGenerationPipeline';
import { useLipSync, type LipSyncApi } from '../hooks/useLipSync';
import type { CharacterRig } from '../three/characterFactory';
import type { StudioState } from '../types/studio';

/**
 * Live handles onto the WebGL scene.
 *
 * Exporters need the actual `THREE.Object3D` and the backing canvas, but
 * neither belongs in reducer state — they are imperative resources with their
 * own lifecycle, so they live in refs the viewport publishes into.
 */
export interface SceneHandles {
  rig: CharacterRig | null;
  canvas: HTMLCanvasElement | null;
}

interface StudioContextValue {
  state: StudioState;
  dispatch: Dispatch<StudioAction>;
  audio: AudioUnlockApi;
  lipSync: LipSyncApi;
  scene: React.MutableRefObject<SceneHandles>;
}

const StudioContext = createContext<StudioContextValue | null>(null);

export function StudioProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(studioReducer, initialState);
  const audio = useAudioUnlock();
  const lipSync = useLipSync(state.script, state.voice, audio);
  const scene = useRef<SceneHandles>({ rig: null, canvas: null });

  useGenerationPipeline(state, dispatch);

  const value = useMemo<StudioContextValue>(
    () => ({ state, dispatch, audio, lipSync, scene }),
    [state, audio, lipSync],
  );

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

export function useStudio(): StudioContextValue {
  const context = useContext(StudioContext);
  if (!context) throw new Error('useStudio must be used inside <StudioProvider>');
  return context;
}
