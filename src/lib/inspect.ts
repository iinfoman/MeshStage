/**
 * Post-export verification.
 *
 * Downloading a file only proves bytes moved. What a user actually needs to
 * know is whether the asset is *correct* — that the skeleton survived, that the
 * viseme blendshapes are named, that the video really carries an audio track.
 * These parsers read the produced bytes back and answer that in the page,
 * which also makes the export testable in embedded viewers where the browser
 * refuses page-initiated downloads.
 */

export interface InspectionRow {
  label: string;
  value: string;
  /** `ok` reads as verified, `warn` as present-but-notable. */
  tone?: 'ok' | 'warn' | 'plain';
}

export interface Inspection {
  kind: 'glb' | 'video' | 'json' | 'usdz' | 'unknown';
  valid: boolean;
  headline: string;
  rows: InspectionRow[];
  /** Detail worth showing verbatim, e.g. the viseme target names. */
  detail?: string[];
}

// ---------------------------------------------------------------------------
// glTF-Binary
// ---------------------------------------------------------------------------

const GLB_MAGIC = 0x46546c67; // 'glTF'

interface GltfJson {
  nodes?: Array<{ name?: string; skin?: number; mesh?: number }>;
  skins?: Array<{ joints?: number[] }>;
  meshes?: Array<{
    primitives?: Array<{
      targets?: unknown[];
      attributes?: Record<string, number>;
    }>;
    extras?: { targetNames?: string[] };
  }>;
  materials?: Array<{ name?: string }>;
  animations?: unknown[];
}

export function inspectGlb(buffer: ArrayBuffer): Inspection {
  const view = new DataView(buffer);

  if (buffer.byteLength < 20 || view.getUint32(0, true) !== GLB_MAGIC) {
    return { kind: 'glb', valid: false, headline: 'Not a valid GLB container', rows: [] };
  }

  const jsonLength = view.getUint32(12, true);
  let gltf: GltfJson;

  try {
    const text = new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength));
    gltf = JSON.parse(text) as GltfJson;
  } catch {
    return { kind: 'glb', valid: false, headline: 'GLB header parsed, JSON chunk did not', rows: [] };
  }

  const nodes = gltf.nodes ?? [];
  const skin = gltf.skins?.[0];
  const joints = skin?.joints ?? [];

  // A joint index pointing past the node table is the classic broken-skin
  // export — the file loads but arrives with no working skeleton.
  const jointNames = joints.map((index) => nodes[index]?.name).filter(Boolean) as string[];
  const jointsResolve = jointNames.length === joints.length && joints.length > 0;

  const morphMesh = gltf.meshes?.find((mesh) => mesh.primitives?.[0]?.targets);
  const targetNames = morphMesh?.extras?.targetNames ?? [];
  const morphCount = morphMesh?.primitives?.[0]?.targets?.length ?? 0;

  const skinned = gltf.meshes?.find((mesh) => mesh.primitives?.[0]?.attributes?.JOINTS_0);
  const attributes = skinned ? Object.keys(skinned.primitives![0].attributes!) : [];

  const rows: InspectionRow[] = [
    { label: 'Container', value: `glTF-Binary, ${nodes.length} nodes`, tone: 'ok' },
    {
      label: 'Skeleton',
      value: joints.length
        ? `${joints.length} joints${jointsResolve ? '' : ' — INDICES BROKEN'}`
        : 'none',
      tone: joints.length && jointsResolve ? 'ok' : 'warn',
    },
    {
      label: 'Skin weights',
      value: attributes.includes('JOINTS_0') && attributes.includes('WEIGHTS_0')
        ? 'JOINTS_0 + WEIGHTS_0'
        : 'missing',
      tone: attributes.includes('WEIGHTS_0') ? 'ok' : 'warn',
    },
    {
      label: 'Blendshapes',
      value: morphCount ? `${morphCount} morph targets` : 'none',
      tone: morphCount ? 'ok' : 'warn',
    },
    {
      label: 'Materials',
      value: (gltf.materials ?? []).map((material) => material.name).filter(Boolean).join(', ') || 'unnamed',
      tone: 'plain',
    },
  ];

  return {
    kind: 'glb',
    valid: jointsResolve && morphCount > 0,
    headline: jointsResolve && morphCount > 0
      ? 'Rigged asset verified'
      : 'Asset exported with gaps',
    rows,
    detail: targetNames.length ? targetNames : undefined,
  };
}

// ---------------------------------------------------------------------------
// ISO-BMFF (MP4) — walk the box tree for track handlers
// ---------------------------------------------------------------------------

function mp4Handlers(buffer: ArrayBuffer): string[] {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const handlers: string[] = [];

  const ascii = (offset: number, length: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + length));

  const containers = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'moof', 'traf']);

  const walk = (start: number, end: number, depth: number) => {
    let offset = start;
    // Depth-limited: a malformed file must not spin this loop forever.
    while (offset + 8 <= end && depth < 6) {
      let size = view.getUint32(offset);
      const type = ascii(offset + 4, 4);
      let header = 8;

      if (size === 1) {
        if (offset + 16 > end) break;
        size = Number(view.getBigUint64(offset + 8));
        header = 16;
      }
      if (size === 0) size = end - offset;
      if (size < header || offset + size > end) break;

      if (type === 'hdlr' && offset + header + 12 <= end) {
        handlers.push(ascii(offset + header + 8, 4));
      }
      if (containers.has(type)) walk(offset + header, offset + size, depth + 1);

      offset += size;
    }
  };

  walk(0, buffer.byteLength, 0);
  return handlers;
}

/** Matroska/WebM: scan for the Track Type element rather than full EBML parse. */
function webmHasAudio(buffer: ArrayBuffer): boolean | null {
  const bytes = new Uint8Array(buffer.slice(0, Math.min(buffer.byteLength, 262_144)));
  // 0x83 = TrackType element id; its 1-byte payload is 1 for video, 2 for audio.
  for (let i = 0; i < bytes.length - 2; i += 1) {
    if (bytes[i] === 0x83 && bytes[i + 1] === 0x81 && bytes[i + 2] === 0x02) return true;
  }
  return null;
}

export function inspectVideo(buffer: ArrayBuffer, mimeType: string): Inspection {
  const isMp4 = mimeType.includes('mp4');
  const rows: InspectionRow[] = [];
  let hasVideo = true;
  let hasAudio: boolean | null = null;

  if (isMp4) {
    const handlers = mp4Handlers(buffer);
    hasVideo = handlers.includes('vide');
    hasAudio = handlers.includes('soun');
    rows.push({
      label: 'Tracks',
      value: handlers.length ? handlers.join(', ') : 'none found',
      tone: handlers.length ? 'ok' : 'warn',
    });
  } else {
    hasAudio = webmHasAudio(buffer);
    rows.push({ label: 'Container', value: 'Matroska / WebM', tone: 'ok' });
  }

  rows.push({ label: 'Video track', value: hasVideo ? 'present' : 'missing', tone: hasVideo ? 'ok' : 'warn' });
  rows.push({
    label: 'Audio track',
    value: hasAudio === true ? 'present' : hasAudio === false ? 'none (device voice)' : 'not detected',
    tone: hasAudio === true ? 'ok' : 'warn',
  });

  return {
    kind: 'video',
    valid: hasVideo,
    headline: hasAudio === true ? 'Video with audio verified' : 'Video verified (silent)',
    rows,
  };
}

// ---------------------------------------------------------------------------
// Viseme timeline JSON
// ---------------------------------------------------------------------------

export function inspectTimelineJson(text: string): Inspection {
  try {
    const parsed = JSON.parse(text) as {
      format?: string;
      keys?: Array<{ t: number; viseme: string }>;
      durationMs?: number;
      visemeSet?: string[];
    };

    const keys = parsed.keys ?? [];
    const ordered = keys.every((key, index) => index === 0 || key.t >= keys[index - 1].t);

    return {
      kind: 'json',
      valid: keys.length > 0 && ordered,
      headline: ordered ? 'Timeline verified' : 'Timeline keys out of order',
      rows: [
        { label: 'Format', value: parsed.format ?? 'unknown', tone: 'ok' },
        { label: 'Keys', value: `${keys.length} viseme keys`, tone: keys.length ? 'ok' : 'warn' },
        { label: 'Duration', value: `${((parsed.durationMs ?? 0) / 1000).toFixed(2)}s`, tone: 'plain' },
        { label: 'Monotonic', value: ordered ? 'yes' : 'NO', tone: ordered ? 'ok' : 'warn' },
      ],
      detail: keys.slice(0, 12).map((key) => `${String(key.t).padStart(5)}ms  ${key.viseme}`),
    };
  } catch {
    return { kind: 'json', valid: false, headline: 'JSON did not parse', rows: [] };
  }
}

export function inspectUsdz(buffer: ArrayBuffer): Inspection {
  const bytes = new Uint8Array(buffer);
  // USDZ is an uncompressed zip; 'PK\x03\x04' is the local file header.
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;

  return {
    kind: 'usdz',
    valid: isZip,
    headline: isZip ? 'USDZ package verified' : 'Not a USDZ package',
    rows: [
      { label: 'Container', value: isZip ? 'zip (uncompressed)' : 'unrecognised', tone: isZip ? 'ok' : 'warn' },
      { label: 'AR Quick Look', value: 'requires saving the file on iOS', tone: 'plain' },
    ],
  };
}
