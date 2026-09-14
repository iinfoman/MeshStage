import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { USDZExporter } from 'three/examples/jsm/exporters/USDZExporter.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { timelineToExport, type VisemeTimeline } from './visemes';
import { downloadBlob, downloadsAreBlocked, slugify } from './utils';
import {
  inspectGlb,
  inspectTimelineJson,
  inspectUsdz,
  inspectVideo,
  type Inspection,
} from './inspect';
import type { CharacterRig } from '../three/characterFactory';
import type { ExportFormatId } from '../types/studio';

export interface ExportContext {
  rig: CharacterRig | null;
  /** Whatever is on screen — procedural rig root, or a reconstructed mesh. */
  exportRoot: THREE.Object3D | null;
  canvas: HTMLCanvasElement | null;
  characterId: string;
  characterName: string;
  script: string;
  voiceLabel: string;
  timeline: VisemeTimeline;
  transparentBackground: boolean;
  /** Starts the lip-sync take; the video recorder waits on its promise. */
  playTake?: () => Promise<void>;
  /** Audio track of the take, when the neural TTS path is driving playback. */
  getAudioStream?: () => MediaStream | null;
  onProgress?: (progress: number) => void;
}

export interface ExportResult {
  filename: string;
  bytes: number;
  /** True when the artefact was produced entirely client-side. */
  local: boolean;
  note?: string;
  /** The produced bytes, kept so the UI can verify and preview them. */
  blob?: Blob;
  /** Object URL for inline playback. The caller owns revoking it. */
  objectUrl?: string;
  /** Structural read-back of what was actually produced. */
  inspection?: Inspection;
  /** True when the browser refused the page-initiated save. */
  saveBlocked?: boolean;
}

/**
 * Hands the file to the user and reports whether that could work at all.
 *
 * Embedded viewers (and some in-app browsers) block page-initiated downloads
 * silently — the click is simply inert. Rather than claim a save that never
 * happened, deliveries report the environment so the UI can lead with the
 * in-page verification instead.
 */
function deliver(blob: Blob, filename: string): { objectUrl: string; saveBlocked: boolean } {
  const saveBlocked = downloadsAreBlocked();
  if (!saveBlocked) downloadBlob(blob, filename);
  return { objectUrl: URL.createObjectURL(blob), saveBlocked };
}

export class ExportError extends Error {}

/** Dispatch table keyed by the format grid's ids. */
export async function runExport(
  formatId: ExportFormatId,
  context: ExportContext,
): Promise<ExportResult> {
  switch (formatId) {
    case 'glb':
      return exportGLB(context);
    case 'usdz':
      return exportUSDZ(context);
    case 'timeline':
      return exportTimeline(context);
    case 'video':
      return exportVideo(context);
    case 'fbx':
      return exportFBX(context);
    default:
      throw new ExportError(`Unknown export format: ${formatId}`);
  }
}

function requireSubject(context: ExportContext): THREE.Object3D {
  const subject = context.exportRoot ?? context.rig?.root ?? null;
  if (!subject) {
    throw new ExportError('The 3D viewport is still initialising. Try again in a moment.');
  }
  return subject;
}

/**
 * Clones the live rig into an export-safe scene.
 *
 * The on-screen object is mid-animation with bones posed and morph influences
 * part-way through a blend; exporting it directly would bake that frame in. We
 * clone, reset the pose to bind, and zero every influence first.
 */
function prepareExportScene(subject: THREE.Object3D): { scene: THREE.Scene; dispose: () => void } {
  // `Object3D.clone()` deep-copies the nodes but leaves the SkinnedMesh bound
  // to the ORIGINAL skeleton, so the exporter writes joint indices pointing at
  // bones that are not in the exported scene — a GLB that loads with no skin.
  // SkeletonUtils.clone() rebuilds the skeleton against the cloned bones.
  const clone = cloneSkeleton(subject) as THREE.Object3D;
  clone.position.set(0, 0, 0);
  clone.rotation.set(0, 0, 0);

  clone.traverse((object) => {
    if ((object as THREE.Bone).isBone) {
      object.rotation.set(0, 0, 0);
      object.scale.setScalar(1);
    }
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh && mesh.morphTargetInfluences) {
      mesh.morphTargetInfluences.fill(0);
    }
  });

  const scene = new THREE.Scene();
  scene.name = 'MeshStage_Export';
  scene.add(clone);
  scene.updateMatrixWorld(true);

  return { scene, dispose: () => scene.clear() };
}

async function exportGLB(context: ExportContext): Promise<ExportResult> {
  const subject = requireSubject(context);
  const { scene, dispose } = prepareExportScene(subject);
  context.onProgress?.(0.25);

  try {
    const exporter = new GLTFExporter();
    const result = await exporter.parseAsync(scene, {
      binary: true,
      // Morph targets ARE the product here — never let the exporter drop them.
      includeCustomExtensions: true,
      onlyVisible: false,
    });

    context.onProgress?.(0.8);

    const blob =
      result instanceof ArrayBuffer
        ? new Blob([result], { type: 'model/gltf-binary' })
        : new Blob([JSON.stringify(result)], { type: 'model/gltf+json' });

    const filename = `${slugify(context.characterName)}.glb`;
    const inspection = inspectGlb(await blob.arrayBuffer());
    const { objectUrl, saveBlocked } = deliver(blob, filename);
    context.onProgress?.(1);

    return {
      filename,
      bytes: blob.size,
      local: true,
      note: 'Skeleton, 15 viseme blendshapes and PBR materials embedded.',
      blob,
      objectUrl,
      inspection,
      saveBlocked,
    };
  } finally {
    dispose();
  }
}

async function exportUSDZ(context: ExportContext): Promise<ExportResult> {
  const subject = requireSubject(context);
  const { scene, dispose } = prepareExportScene(subject);
  context.onProgress?.(0.3);

  try {
    const exporter = new USDZExporter();
    const result = await exporter.parseAsync(scene);
    context.onProgress?.(0.85);

    const blob = new Blob([result as unknown as BlobPart], { type: 'model/vnd.usdz+zip' });
    const filename = `${slugify(context.characterName)}.usdz`;
    const inspection = inspectUsdz(await blob.arrayBuffer());
    const { objectUrl, saveBlocked } = deliver(blob, filename);
    context.onProgress?.(1);

    return {
      filename,
      bytes: blob.size,
      local: true,
      note: 'Open on iOS to launch AR Quick Look.',
      blob,
      objectUrl,
      inspection,
      saveBlocked,
    };
  } finally {
    dispose();
  }
}

async function exportTimeline(context: ExportContext): Promise<ExportResult> {
  context.onProgress?.(0.4);

  const payload = timelineToExport(context.timeline, {
    characterId: context.characterId,
    characterName: context.characterName,
    script: context.script,
    voice: context.voiceLabel,
  });

  const text = JSON.stringify(payload, null, 2);
  const blob = new Blob([text], { type: 'application/json' });
  const filename = `${slugify(context.characterName)}-visemes.json`;
  const inspection = inspectTimelineJson(text);
  const { objectUrl, saveBlocked } = deliver(blob, filename);
  context.onProgress?.(1);

  return {
    filename,
    bytes: blob.size,
    local: true,
    note: `${payload.keys.length} keys over ${(payload.durationMs / 1000).toFixed(1)}s.`,
    blob,
    objectUrl,
    inspection,
    saveBlocked,
  };
}

/** Picks the best container the browser will actually mux. */
export function pickVideoMimeType(): { mimeType: string; extension: string } | null {
  if (typeof MediaRecorder === 'undefined') return null;

  const candidates: Array<{ mimeType: string; extension: string }> = [
    // Safari 15+ records H.264 in MP4 directly.
    { mimeType: 'video/mp4;codecs=avc1.42E01E', extension: 'mp4' },
    { mimeType: 'video/mp4', extension: 'mp4' },
    // Chrome/Firefox: VP9 first for quality, VP8 as the wide fallback.
    { mimeType: 'video/webm;codecs=vp9', extension: 'webm' },
    { mimeType: 'video/webm;codecs=vp8', extension: 'webm' },
    { mimeType: 'video/webm', extension: 'webm' },
  ];

  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate.mimeType)) ?? null;
}

/**
 * Records the live viewport while the lip-sync take plays.
 *
 * This is a real client-side capture via `captureStream()`, so what lands in
 * the file is exactly the frames the user just watched.
 *
 * Audio depends on which engine spoke the take. Neural voices render through
 * WebAudio, so their output is tapped off a `MediaStreamAudioDestinationNode`
 * and muxed straight into the recording. System voices go through
 * `speechSynthesis`, whose output no current browser routes into WebAudio —
 * those takes record silent, and the UI says so before the user spends a
 * render credit. The transparent-background pass still belongs to the cloud
 * renderer either way.
 */
async function exportVideo(context: ExportContext): Promise<ExportResult> {
  const canvas = context.canvas;
  if (!canvas) throw new ExportError('No viewport canvas is available to record.');

  const codec = pickVideoMimeType();
  if (!codec) {
    throw new ExportError('This browser cannot record video. Try Chrome or Safari 15+.');
  }

  const stream = canvas.captureStream(30);

  // Mux the spoken audio in when the neural path is driving playback. The
  // browser's own speechSynthesis cannot be routed into WebAudio, so with a
  // system voice there is no track to add and the file is video-only.
  const audioStream = context.getAudioStream?.() ?? null;
  let hasAudio = false;
  for (const track of audioStream?.getAudioTracks() ?? []) {
    stream.addTrack(track);
    hasAudio = true;
  }

  const recorder = new MediaRecorder(stream, {
    mimeType: codec.mimeType,
    videoBitsPerSecond: 6_000_000,
    ...(hasAudio ? { audioBitsPerSecond: 128_000 } : {}),
  });

  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  const finished = new Promise<void>((resolve, reject) => {
    recorder.onstop = () => resolve();
    recorder.onerror = () => reject(new ExportError('Recording failed mid-capture.'));
  });

  recorder.start(120);
  context.onProgress?.(0.05);

  const durationMs = Math.max(1200, context.timeline.duration + 900);
  const startedAt = performance.now();
  const ticker = window.setInterval(() => {
    context.onProgress?.(Math.min(0.92, (performance.now() - startedAt) / durationMs));
  }, 120);

  try {
    if (context.playTake) {
      await context.playTake();
    } else {
      await new Promise((resolve) => window.setTimeout(resolve, durationMs));
    }
    // Let the mouth settle back to rest before cutting.
    await new Promise((resolve) => window.setTimeout(resolve, 600));
  } finally {
    window.clearInterval(ticker);
    if (recorder.state !== 'inactive') recorder.stop();
    // Only stop the canvas track. The audio track belongs to the lip-sync
    // engine's reusable capture node — stopping it would kill every later take.
    for (const track of stream.getVideoTracks()) track.stop();
    for (const track of stream.getAudioTracks()) stream.removeTrack(track);
  }

  await finished;

  const blob = new Blob(chunks, { type: codec.mimeType });
  const filename = `${slugify(context.characterName)}-lipsync.${codec.extension}`;
  const inspection = inspectVideo(await blob.arrayBuffer(), codec.mimeType);
  const { objectUrl, saveBlocked } = deliver(blob, filename);
  context.onProgress?.(1);

  const notes = [hasAudio ? 'Video and audio captured.' : 'Video captured (system voices record silent).'];
  if (context.transparentBackground) notes.push('Alpha matte is applied by the cloud renderer.');

  return {
    filename,
    bytes: blob.size,
    local: true,
    note: notes.join(' '),
    blob,
    objectUrl,
    inspection,
    saveBlocked,
  };
}

/**
 * FBX has no browser-side writer — the format is a closed binary spec and
 * three.js ships an importer only. We therefore hand the glTF payload to the
 * conversion service and let it run the FBX SDK.
 *
 * `VITE_MESHSTAGE_API` points this at a real backend; with no backend
 * configured the call reports honestly rather than pretending to download.
 */
async function exportFBX(context: ExportContext): Promise<ExportResult> {
  const subject = requireSubject(context);
  const endpoint = import.meta.env.VITE_MESHSTAGE_API as string | undefined;

  if (!endpoint) {
    throw new ExportError(
      'FBX conversion runs on the MeshStage render service. Set VITE_MESHSTAGE_API to enable it — .GLB carries the same skeleton and morph targets and imports directly into Blender and Unity.',
    );
  }

  const { scene, dispose } = prepareExportScene(subject);
  context.onProgress?.(0.2);

  try {
    const exporter = new GLTFExporter();
    const gltf = (await exporter.parseAsync(scene, { binary: true })) as ArrayBuffer;
    context.onProgress?.(0.45);

    const body = new FormData();
    body.append('source', new Blob([gltf], { type: 'model/gltf-binary' }), 'source.glb');
    body.append('target', 'fbx');
    body.append('characterId', context.characterId);

    const response = await fetch(`${endpoint.replace(/\/$/, '')}/convert`, {
      method: 'POST',
      body,
    });

    if (!response.ok) {
      throw new ExportError(`Conversion service returned ${response.status}.`);
    }

    const blob = await response.blob();
    context.onProgress?.(0.95);

    const filename = `${slugify(context.characterName)}.fbx`;
    const { objectUrl, saveBlocked } = deliver(blob, filename);
    context.onProgress?.(1);

    return {
      filename,
      bytes: blob.size,
      local: false,
      note: 'Converted by the MeshStage render service.',
      blob,
      objectUrl,
      saveBlocked,
    };
  } finally {
    dispose();
  }
}

/**
 * Persists the session to the user's dashboard. Without a configured backend
 * this falls back to `localStorage` so the library still works offline and in
 * local development.
 */
export async function saveToCloudLibrary(payload: Record<string, unknown>): Promise<void> {
  const endpoint = import.meta.env.VITE_MESHSTAGE_API as string | undefined;

  if (endpoint) {
    const response = await fetch(`${endpoint.replace(/\/$/, '')}/library`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`Library save failed (${response.status}).`);
    return;
  }

  const key = 'meshstage.library';
  const existing = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown[];
  existing.unshift({ ...payload, savedAt: new Date().toISOString() });
  localStorage.setItem(key, JSON.stringify(existing.slice(0, 50)));
}
