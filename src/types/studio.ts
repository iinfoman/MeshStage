/**
 * Core domain types for the MeshStage creation pipeline.
 */

import type { VoiceProvider } from '../lib/tts';
import type { CharacterAppearance } from '../three/characterFactory';

export type StageId = 'input' | 'processing' | 'voice' | 'export';

export const STAGE_ORDER: StageId[] = ['input', 'processing', 'voice', 'export'];

export interface StageMeta {
  id: StageId;
  index: number;
  label: string;
  short: string;
}

export const STAGES: StageMeta[] = [
  { id: 'input', index: 1, label: 'Input', short: 'Input' },
  { id: 'processing', index: 2, label: '3D Processing', short: '3D' },
  { id: 'voice', index: 3, label: 'Voice & Rig', short: 'Voice' },
  { id: 'export', index: 4, label: 'Export & Save', short: 'Export' },
];

export type InputMode = 'image' | 'prompt';

/** The three pipeline phases surfaced in the stage-2 progress readout. */
export type PipelinePhase = 'mesh' | 'rig' | 'blendshape';

export interface PipelinePhaseMeta {
  id: PipelinePhase;
  label: string;
  detail: string;
  /** Share of the total 0..1 progress bar this phase occupies. */
  weight: number;
}

export const PIPELINE_PHASES: PipelinePhaseMeta[] = [
  { id: 'mesh', label: 'Mesh Generation', detail: 'Reconstructing volume & topology', weight: 0.45 },
  { id: 'rig', label: 'Automatic Rigging', detail: 'Fitting humanoid skeleton', weight: 0.3 },
  {
    id: 'blendshape',
    label: 'Blendshape Mapping',
    detail: 'Binding 15 ARKit visemes',
    weight: 0.25,
  },
];

export interface PipelineState {
  /** 0..1 across the whole three-phase run. */
  progress: number;
  phase: PipelinePhase;
  running: boolean;
}

/**
 * Deterministic character description. `seed` is derived from the user's input
 * so the same prompt or photo always reconstructs the same mesh.
 */
export interface CharacterAsset {
  id: string;
  seed: number;
  name: string;
  source: InputMode;
  /** Prompt text, or the file name of the uploaded reference. */
  sourceLabel: string;
  createdAt: number;
  polycount: number;
  boneCount: number;
  blendshapeCount: number;
  /** Palette and artwork derived from the uploaded reference, when there was one. */
  appearance?: CharacterAppearance;
  /** How this asset was produced. */
  mode: 'local' | 'service';
  /** URL of a provider-reconstructed mesh, when one exists. */
  meshUrl?: string;
  /** Non-fatal note, e.g. a provider fallback. */
  notice?: string;
}

export type MotionPreset = 'standing' | 'talking' | 'floating';

export interface MotionPresetMeta {
  id: MotionPreset;
  label: string;
  hint: string;
}

export const MOTION_PRESETS: MotionPresetMeta[] = [
  { id: 'standing', label: 'Standing', hint: 'Weight-shift idle' },
  { id: 'talking', label: 'Talking', hint: 'Gestural upper body' },
  { id: 'floating', label: 'Floating', hint: 'Zero-g drift' },
];

export interface VoiceSettings {
  /** SpeechSynthesisVoice.voiceURI, or the TTS service's voice id. */
  voiceURI: string;
  lang: string;
  rate: number;
  pitch: number;
  /** Which engine renders this voice: the device, or the MeshStage service. */
  provider: VoiceProvider;
}

export type ExportFormatId = 'glb' | 'fbx' | 'usdz' | 'video' | 'timeline';

export type ExportDelivery = 'local' | 'cloud';

export interface ExportFormatMeta {
  id: ExportFormatId;
  /** Short badge, e.g. ".GLB / .GLTF" */
  extension: string;
  title: string;
  description: string;
  targets: string;
  /** `local` runs entirely in the browser; `cloud` dispatches a render job. */
  delivery: ExportDelivery;
  /** Marks the pay-per-render tier gate. */
  metered: boolean;
}

export const EXPORT_FORMATS: ExportFormatMeta[] = [
  {
    id: 'glb',
    extension: '.GLB / .GLTF',
    title: 'Web & Real-Time',
    description: 'Complete mesh, blendshapes/visemes and PBR textures.',
    targets: 'Three.js · Babylon.js · model-viewer',
    delivery: 'local',
    metered: false,
  },
  {
    id: 'fbx',
    extension: '.FBX',
    title: 'Game Engines & Animation',
    description: 'Rigged skeleton plus morph targets, Y-up, 1 unit = 1 cm.',
    targets: 'Unity · Unreal Engine · Blender',
    delivery: 'cloud',
    metered: false,
  },
  {
    id: 'usdz',
    extension: '.USDZ',
    title: 'Mobile AR',
    description: 'AR Quick Look payload for the native iOS AR viewer.',
    targets: 'iOS Safari · Apple Vision Pro',
    delivery: 'local',
    metered: false,
  },
  {
    id: 'video',
    extension: '.MP4 / .WEBM',
    title: 'Video Output',
    description: 'Rendered lip-sync take on a custom or transparent background.',
    targets: 'Social · Presentations · Ads',
    delivery: 'local',
    metered: true,
  },
  {
    id: 'timeline',
    extension: '.JSON',
    title: 'Animation Timestamps',
    description: 'Viseme timeline with millisecond offsets and weights.',
    targets: 'Native 2D/3D app sync · Unity Timeline',
    delivery: 'local',
    metered: false,
  },
];

export interface TierState {
  plan: 'free' | 'creator' | 'studio';
  rendersLeft: number;
  rendersTotal: number;
}

export interface CloudSaveState {
  status: 'idle' | 'saving' | 'saved' | 'error';
  savedAt: number | null;
  message: string | null;
}

export interface ExportJobState {
  status: 'idle' | 'running' | 'done' | 'error';
  formatId: ExportFormatId | null;
  progress: number;
  message: string | null;
}

export interface StudioState {
  stage: StageId;
  inputMode: InputMode;
  prompt: string;
  imageDataUrl: string | null;
  imageName: string | null;
  pipeline: PipelineState;
  character: CharacterAsset | null;
  voice: VoiceSettings;
  script: string;
  motion: MotionPreset;
  selectedFormat: ExportFormatId;
  transparentBackground: boolean;
  tier: TierState;
  cloudSave: CloudSaveState;
  exportJob: ExportJobState;
  /** Surfaced on stage 1 when a generation attempt failed. */
  generationError: string | null;
}
