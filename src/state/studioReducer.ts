import {
  type CharacterAsset,
  type ExportFormatId,
  type InputMode,
  type MotionPreset,
  type PipelinePhase,
  PIPELINE_PHASES,
  type StageId,
  type StudioState,
  type VoiceSettings,
} from '../types/studio';

export const DEFAULT_SCRIPT =
  'Welcome to MeshStage. I was a flat image about ninety seconds ago.';

export const initialState: StudioState = {
  stage: 'input',
  inputMode: 'image',
  prompt: '',
  imageDataUrl: null,
  imageName: null,
  pipeline: { progress: 0, phase: 'mesh', running: false },
  character: null,
  voice: { voiceURI: '', lang: 'en-US', rate: 1, pitch: 1 },
  script: DEFAULT_SCRIPT,
  motion: 'talking',
  selectedFormat: 'glb',
  transparentBackground: false,
  tier: { plan: 'free', rendersLeft: 3, rendersTotal: 10 },
  cloudSave: { status: 'idle', savedAt: null, message: null },
  exportJob: { status: 'idle', formatId: null, progress: 0, message: null },
};

export type StudioAction =
  | { type: 'setInputMode'; mode: InputMode }
  | { type: 'setPrompt'; prompt: string }
  | { type: 'setImage'; dataUrl: string; name: string }
  | { type: 'clearImage' }
  | { type: 'resetInput' }
  | { type: 'startGeneration' }
  | { type: 'pipelineProgress'; progress: number }
  | { type: 'generationComplete'; character: CharacterAsset }
  | { type: 'cancelGeneration' }
  | { type: 'setVoice'; patch: Partial<VoiceSettings> }
  | { type: 'setScript'; script: string }
  | { type: 'setMotion'; motion: MotionPreset }
  | { type: 'goToStage'; stage: StageId }
  | { type: 'selectFormat'; formatId: ExportFormatId }
  | { type: 'setTransparentBackground'; value: boolean }
  | { type: 'exportStarted'; formatId: ExportFormatId }
  | { type: 'exportProgress'; progress: number }
  | { type: 'exportSucceeded'; message: string; consumedRender: boolean }
  | { type: 'exportFailed'; message: string }
  | { type: 'exportDismissed' }
  | { type: 'cloudSaveStarted' }
  | { type: 'cloudSaveSucceeded' }
  | { type: 'cloudSaveFailed'; message: string }
  | { type: 'upgradeTier' }
  | { type: 'discardAll' };

/** Maps a 0..1 overall progress value onto the weighted phase it falls in. */
export function phaseForProgress(progress: number): PipelinePhase {
  let cursor = 0;
  for (const phase of PIPELINE_PHASES) {
    cursor += phase.weight;
    if (progress < cursor) return phase.id;
  }
  return PIPELINE_PHASES[PIPELINE_PHASES.length - 1].id;
}

/** Progress within the active phase only, 0..1 — drives the per-row bars. */
export function phaseLocalProgress(progress: number, phase: PipelinePhase): number {
  let start = 0;
  for (const meta of PIPELINE_PHASES) {
    if (meta.id === phase) {
      return clamp01((progress - start) / meta.weight);
    }
    start += meta.weight;
  }
  return 0;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Input is only substantive enough to generate from when this passes. */
export function hasUsableInput(state: StudioState): boolean {
  return state.inputMode === 'image'
    ? Boolean(state.imageDataUrl)
    : state.prompt.trim().length >= 3;
}

export function studioReducer(state: StudioState, action: StudioAction): StudioState {
  switch (action.type) {
    case 'setInputMode':
      return { ...state, inputMode: action.mode };

    case 'setPrompt':
      return { ...state, prompt: action.prompt };

    case 'setImage':
      return { ...state, imageDataUrl: action.dataUrl, imageName: action.name };

    case 'clearImage':
      return { ...state, imageDataUrl: null, imageName: null };

    case 'resetInput':
      return {
        ...state,
        prompt: '',
        imageDataUrl: null,
        imageName: null,
      };

    case 'startGeneration':
      return {
        ...state,
        stage: 'processing',
        pipeline: { progress: 0, phase: 'mesh', running: true },
      };

    case 'pipelineProgress': {
      const progress = clamp01(action.progress);
      return {
        ...state,
        pipeline: { ...state.pipeline, progress, phase: phaseForProgress(progress) },
      };
    }

    case 'generationComplete':
      return {
        ...state,
        stage: 'voice',
        character: action.character,
        pipeline: { progress: 1, phase: 'blendshape', running: false },
      };

    case 'cancelGeneration':
      // Back to stage 1 with the original input intact, so a cancel is cheap
      // to undo — only an explicit discard clears what the user typed.
      return {
        ...state,
        stage: 'input',
        character: null,
        pipeline: { progress: 0, phase: 'mesh', running: false },
      };

    case 'setVoice':
      return { ...state, voice: { ...state.voice, ...action.patch } };

    case 'setScript':
      return { ...state, script: action.script };

    case 'setMotion':
      return { ...state, motion: action.motion };

    case 'goToStage':
      return { ...state, stage: action.stage };

    case 'selectFormat':
      return { ...state, selectedFormat: action.formatId };

    case 'setTransparentBackground':
      return { ...state, transparentBackground: action.value };

    case 'exportStarted':
      return {
        ...state,
        exportJob: {
          status: 'running',
          formatId: action.formatId,
          progress: 0,
          message: null,
        },
      };

    case 'exportProgress':
      return {
        ...state,
        exportJob: { ...state.exportJob, progress: clamp01(action.progress) },
      };

    case 'exportSucceeded':
      return {
        ...state,
        tier: action.consumedRender
          ? { ...state.tier, rendersLeft: Math.max(0, state.tier.rendersLeft - 1) }
          : state.tier,
        exportJob: {
          ...state.exportJob,
          status: 'done',
          progress: 1,
          message: action.message,
        },
      };

    case 'exportFailed':
      return {
        ...state,
        exportJob: { ...state.exportJob, status: 'error', message: action.message },
      };

    case 'exportDismissed':
      return {
        ...state,
        exportJob: { status: 'idle', formatId: null, progress: 0, message: null },
      };

    case 'cloudSaveStarted':
      return { ...state, cloudSave: { status: 'saving', savedAt: null, message: null } };

    case 'cloudSaveSucceeded':
      return {
        ...state,
        cloudSave: { status: 'saved', savedAt: Date.now(), message: null },
      };

    case 'cloudSaveFailed':
      return {
        ...state,
        cloudSave: { status: 'error', savedAt: null, message: action.message },
      };

    case 'upgradeTier':
      return {
        ...state,
        tier: { plan: 'creator', rendersLeft: 250, rendersTotal: 250 },
      };

    case 'discardAll':
      // A full session wipe: mesh, script, uploads and export state all go.
      // Tier credits survive because they are billing state, not session state.
      return { ...initialState, tier: state.tier, voice: state.voice };

    default:
      return state;
  }
}
