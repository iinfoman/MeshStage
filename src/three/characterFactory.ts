import * as THREE from 'three';
import { makeRandom } from '../lib/utils';
import { VISEMES, type Viseme } from '../lib/visemes';

/**
 * Builds the MeshStage character as a real `THREE.SkinnedMesh` with a humanoid
 * bone chain and a 15-shape viseme blendshape set on the mouth.
 *
 * Both are load-bearing rather than decorative: `GLTFExporter` writes the
 * skeleton out as glTF joints and the morph attributes as named blendshape
 * targets, which is exactly what Unity, Unreal and Three.js consumers read
 * back. Swap this factory for your reconstruction service's asset loader and
 * the rest of the studio is unchanged.
 */

export interface CharacterPalette {
  skin: THREE.Color;
  suit: THREE.Color;
  accent: THREE.Color;
  visor: THREE.Color;
}

/**
 * Look derived from the user's uploaded reference.
 *
 * Supplying this is what makes an upload matter: the palette replaces the
 * seed-generated one, and `textureDataUrl` is carried onto the character as
 * artwork. Omit it and the rig falls back to a procedural look.
 */
export interface CharacterAppearance {
  suit: string;
  accent: string;
  shade: string;
  /** 0..1 — brightens the skin tone for light references. */
  lightness: number;
  /** Square PNG data URL applied to the chest panel and back. */
  textureDataUrl?: string;
}

export interface CharacterRig {
  root: THREE.Group;
  skinned: THREE.SkinnedMesh;
  skeleton: THREE.Skeleton;
  bones: Record<BoneName, THREE.Bone>;
  headPivot: THREE.Group;
  mouth: THREE.Mesh;
  jaw: THREE.Group;
  arms: { left: THREE.Group; right: THREE.Group };
  palette: CharacterPalette;
  /** Morph target index per viseme, for the animation loop. */
  visemeIndex: Record<Viseme, number>;
  dispose: () => void;
}

export type BoneName =
  | 'hips'
  | 'spine'
  | 'chest'
  | 'neck'
  | 'head'
  | 'shoulderL'
  | 'elbowL'
  | 'shoulderR'
  | 'elbowR'
  | 'thighL'
  | 'kneeL'
  | 'thighR'
  | 'kneeR';

const BONE_LAYOUT: Array<{ name: BoneName; parent: BoneName | null; position: [number, number, number] }> = [
  { name: 'hips', parent: null, position: [0, 0.92, 0] },
  { name: 'spine', parent: 'hips', position: [0, 0.22, 0] },
  { name: 'chest', parent: 'spine', position: [0, 0.24, 0] },
  { name: 'neck', parent: 'chest', position: [0, 0.22, 0] },
  { name: 'head', parent: 'neck', position: [0, 0.14, 0] },
  { name: 'shoulderL', parent: 'chest', position: [0.38, 0.1, 0] },
  { name: 'elbowL', parent: 'shoulderL', position: [0, -0.27, 0] },
  { name: 'shoulderR', parent: 'chest', position: [-0.38, 0.1, 0] },
  { name: 'elbowR', parent: 'shoulderR', position: [0, -0.27, 0] },
  { name: 'thighL', parent: 'hips', position: [0.13, -0.06, 0] },
  { name: 'kneeL', parent: 'thighL', position: [0, -0.45, 0] },
  { name: 'thighR', parent: 'hips', position: [-0.13, -0.06, 0] },
  { name: 'kneeR', parent: 'thighR', position: [0, -0.45, 0] },
];

export const RIG_BONE_COUNT = BONE_LAYOUT.length;
export const BLENDSHAPE_COUNT = VISEMES.length;

/** Per-viseme mouth geometry parameters: width, height, roundness, protrusion. */
const VISEME_SHAPE: Record<Viseme, { w: number; h: number; z: number }> = {
  sil: { w: 1, h: 1, z: 1 },
  PP: { w: 0.92, h: 0.5, z: 1.04 }, // lips pressed
  FF: { w: 1.05, h: 0.62, z: 0.94 }, // lower lip to teeth
  TH: { w: 1.02, h: 0.95, z: 1.12 }, // tongue forward
  DD: { w: 0.98, h: 0.9, z: 1 },
  kk: { w: 1.0, h: 1.05, z: 0.96 },
  CH: { w: 0.82, h: 1.05, z: 1.16 }, // rounded + forward
  SS: { w: 1.18, h: 0.6, z: 0.96 }, // wide, narrow
  nn: { w: 1.02, h: 0.82, z: 1 },
  RR: { w: 0.9, h: 1.0, z: 1.08 },
  aa: { w: 1.12, h: 1.9, z: 1 }, // wide open
  E: { w: 1.24, h: 1.28, z: 0.94 },
  I: { w: 1.3, h: 0.9, z: 0.92 }, // smile-wide
  O: { w: 0.78, h: 1.62, z: 1.1 }, // rounded open
  U: { w: 0.66, h: 1.05, z: 1.22 }, // pursed forward
};

export function createCharacterRig(seed: number, appearance?: CharacterAppearance): CharacterRig {
  const random = makeRandom(seed);
  const palette = appearance ? paletteFromAppearance(appearance, random) : buildPalette(random);

  // Small deterministic proportion drift so two prompts never look identical.
  const build = 0.9 + random() * 0.28;
  const headScale = 0.94 + random() * 0.16;

  const root = new THREE.Group();
  root.name = 'MeshStage_Character';

  const bones = createBones();

  // `Skeleton` derives its bind-pose inverses from each bone's *world* matrix,
  // so the hierarchy has to be resolved before the skeleton is constructed.
  // Skip this and every inverse comes out as identity, which double-applies
  // each bone's translation and flings the mesh off-screen.
  bones.hips.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(BONE_LAYOUT.map((entry) => bones[entry.name]));

  const disposables: Array<{ dispose: () => void }> = [];
  const track = <T extends { dispose: () => void }>(value: T): T => {
    disposables.push(value);
    return value;
  };

  const suitMaterial = track(
    new THREE.MeshStandardMaterial({
      color: palette.suit,
      roughness: 0.52,
      metalness: 0.28,
      envMapIntensity: 0.8,
      name: 'MeshStage_Suit',
    }),
  );
  const accentMaterial = track(
    new THREE.MeshStandardMaterial({
      color: palette.accent,
      roughness: 0.28,
      metalness: 0.6,
      emissive: palette.accent.clone().multiplyScalar(0.32),
      name: 'MeshStage_Accent',
    }),
  );
  const skinMaterial = track(
    new THREE.MeshStandardMaterial({
      color: palette.skin,
      roughness: 0.68,
      metalness: 0.04,
      name: 'MeshStage_Skin',
    }),
  );

  // ---- Torso: the actual skinned mesh -------------------------------------
  const torsoGeometry = track(buildTorsoGeometry(build));
  bindSkinWeights(torsoGeometry, BONE_LAYOUT);

  const skinned = new THREE.SkinnedMesh(torsoGeometry, suitMaterial);
  skinned.name = 'Body';
  skinned.castShadow = true;
  skinned.receiveShadow = true;
  skinned.add(bones.hips);
  skinned.bind(skeleton);
  skinned.frustumCulled = false;
  root.add(skinned);

  // ---- Head assembly, parented to the head bone ---------------------------
  const headPivot = new THREE.Group();
  headPivot.name = 'HeadPivot';
  headPivot.scale.setScalar(headScale);
  bones.head.add(headPivot);

  const skullGeometry = track(new THREE.SphereGeometry(0.23, 32, 24));
  skullGeometry.scale(1, 1.12, 1.02);
  const skull = new THREE.Mesh(skullGeometry, skinMaterial);
  skull.name = 'Skull';
  skull.position.y = 0.2;
  skull.castShadow = true;
  headPivot.add(skull);

  // Helmet crown — a cap over the top of the skull, in suit colour.
  const crownGeometry = track(new THREE.SphereGeometry(0.238, 32, 20, 0, Math.PI * 2, 0, 1.05));
  crownGeometry.scale(1, 1.12, 1.02);
  const crown = new THREE.Mesh(crownGeometry, suitMaterial);
  crown.name = 'Helmet';
  crown.position.y = 0.2;
  crown.castShadow = true;
  headPivot.add(crown);

  // Visor — the signature MeshStage silhouette cue. A front-facing shield, not
  // a full band: `phi` is centred on +Z so it wraps the face only, and `theta`
  // is placed to sit across the eye line rather than the forehead.
  const visorGeometry = track(
    new THREE.SphereGeometry(0.246, 32, 16, Math.PI / 2 - 0.88, 1.76, 0.95, 0.5),
  );
  visorGeometry.scale(1, 1.12, 1.02);
  const visorMaterial = track(
    new THREE.MeshPhysicalMaterial({
      color: palette.visor,
      roughness: 0.06,
      metalness: 0.2,
      transmission: 0.72,
      thickness: 0.25,
      ior: 1.45,
      emissive: palette.visor.clone().multiplyScalar(0.45),
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
      name: 'MeshStage_Visor',
    }),
  );
  const visor = new THREE.Mesh(visorGeometry, visorMaterial);
  visor.name = 'Visor';
  visor.position.y = 0.2;
  headPivot.add(visor);

  // Neck — without it the head reads as balanced on the shoulders.
  const neckGeometry = track(new THREE.CylinderGeometry(0.072, 0.095, 0.1, 16));
  const neck = new THREE.Mesh(neckGeometry, skinMaterial);
  neck.name = 'Neck';
  neck.position.y = 0.03;
  headPivot.add(neck);

  // ---- Jaw + mouth with viseme blendshapes --------------------------------
  const jaw = new THREE.Group();
  jaw.name = 'Jaw';
  jaw.position.set(0, 0.135, 0.0);
  headPivot.add(jaw);

  const { geometry: mouthGeometry, visemeIndex } = buildMouthGeometry();
  track(mouthGeometry);
  const mouthMaterial = track(
    new THREE.MeshStandardMaterial({
      color: new THREE.Color('#150b12'),
      roughness: 0.85,
      metalness: 0,
      name: 'MeshStage_MouthCavity',
    }),
  );
  const mouth = new THREE.Mesh(mouthGeometry, mouthMaterial);
  mouth.name = 'Mouth_Visemes';
  mouth.position.set(0, -0.01, 0.208);
  mouth.morphTargetInfluences = new Array(VISEMES.length).fill(0);
  jaw.add(mouth);

  const lipGeometry = track(new THREE.TorusGeometry(0.046, 0.012, 8, 20));
  lipGeometry.scale(1.15, 0.85, 1);
  const lips = new THREE.Mesh(lipGeometry, skinMaterial);
  lips.name = 'Lips';
  lips.position.set(0, -0.01, 0.212);
  jaw.add(lips);

  // ---- Eyes ----------------------------------------------------------------
  const eyeGeometry = track(new THREE.SphereGeometry(0.028, 16, 12));
  const eyeMaterial = track(
    new THREE.MeshStandardMaterial({
      color: palette.accent,
      emissive: palette.accent,
      emissiveIntensity: 2.4,
      roughness: 0.25,
      toneMapped: false,
      name: 'MeshStage_Optics',
    }),
  );
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeometry, eyeMaterial);
    eye.name = side < 0 ? 'Eye_R' : 'Eye_L';
    // Sits proud of the 0.23 skull radius so it reads through the visor.
    eye.position.set(side * 0.082, 0.222, 0.205);
    eye.scale.set(1.7, 1.15, 0.9);
    headPivot.add(eye);
  }

  // ---- Limbs, parented to their bones -------------------------------------
  const limbGeometry = track(new THREE.CapsuleGeometry(0.062, 0.26, 6, 12));
  const legGeometry = track(new THREE.CapsuleGeometry(0.078, 0.38, 6, 12));

  const arms = {
    left: attachLimb(bones.shoulderL, bones.elbowL, limbGeometry, suitMaterial, accentMaterial, 1),
    right: attachLimb(bones.shoulderR, bones.elbowR, limbGeometry, suitMaterial, accentMaterial, -1),
  };

  for (const [thigh, knee] of [
    [bones.thighL, bones.kneeL],
    [bones.thighR, bones.kneeR],
  ] as const) {
    const upper = new THREE.Mesh(legGeometry, suitMaterial);
    upper.name = `${thigh.name}_mesh`;
    upper.position.y = -0.225;
    upper.castShadow = true;
    thigh.add(upper);

    const lower = new THREE.Mesh(legGeometry, suitMaterial);
    lower.name = `${knee.name}_mesh`;
    lower.position.y = -0.225;
    lower.scale.setScalar(0.92);
    lower.castShadow = true;
    knee.add(lower);
  }

  const pelvisGeometry = track(new THREE.CapsuleGeometry(0.155, 0.08, 6, 16));
  pelvisGeometry.scale(1.05, 0.9, 0.8);
  const pelvis = new THREE.Mesh(pelvisGeometry, suitMaterial);
  pelvis.name = 'Pelvis';
  pelvis.position.y = -0.03;
  pelvis.castShadow = true;
  bones.hips.add(pelvis);

  const yokeGeometry = track(new THREE.CapsuleGeometry(0.095, 0.6, 6, 16));
  yokeGeometry.rotateZ(Math.PI / 2);
  yokeGeometry.scale(1, 1, 0.72);
  const yoke = new THREE.Mesh(yokeGeometry, suitMaterial);
  yoke.name = 'ShoulderYoke';
  yoke.position.set(0, 0.12, 0);
  yoke.castShadow = true;
  bones.chest.add(yoke);

  // Chest emblem — reads as a rig landmark in the wireframe preview too.
  if (appearance?.textureDataUrl) {
    // The upload, worn. A rounded panel on the chest and a smaller one between
    // the shoulders, so the reference is visible from either side.
    const texture = track(new THREE.TextureLoader().load(appearance.textureDataUrl));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;

    const artMaterial = track(
      new THREE.MeshStandardMaterial({
        map: texture,
        transparent: true,
        roughness: 0.42,
        metalness: 0.05,
        // Emissive lifts the artwork out of the suit's shading so a dark
        // mascot on a dark suit stays readable.
        emissive: new THREE.Color('#ffffff'),
        emissiveMap: texture,
        emissiveIntensity: 0.55,
        name: 'MeshStage_Reference',
      }),
    );

    const panelGeometry = track(new THREE.PlaneGeometry(0.3, 0.3));

    // The torso's front surface is at z ~0.2 at chest height, so anything
    // closer than that renders inside the body and never shows.
    const frontPanel = new THREE.Mesh(panelGeometry, artMaterial);
    frontPanel.name = 'ReferencePanel_Front';
    frontPanel.position.set(0, 0.06, 0.222);
    bones.chest.add(frontPanel);

    const backPanel = new THREE.Mesh(panelGeometry, artMaterial);
    backPanel.name = 'ReferencePanel_Back';
    backPanel.position.set(0, 0.06, -0.222);
    backPanel.rotation.y = Math.PI;
    backPanel.scale.setScalar(0.62);
    bones.chest.add(backPanel);

    // A ring of the accent colour frames the panel.
    const frameGeometry = track(new THREE.TorusGeometry(0.165, 0.013, 8, 32));
    const frame = new THREE.Mesh(frameGeometry, accentMaterial);
    frame.name = 'ReferenceFrame';
    frame.position.set(0, 0.06, 0.216);
    bones.chest.add(frame);
  } else {
    const emblemGeometry = track(new THREE.TorusGeometry(0.06, 0.014, 8, 24));
    const emblem = new THREE.Mesh(emblemGeometry, accentMaterial);
    emblem.name = 'ChestEmblem';
    emblem.position.set(0, 0.04, 0.2);
    bones.chest.add(emblem);
  }

  // Rest pose: arms down and slightly out, knees soft. The bind pose stays
  // the T-pose the skeleton was built in — this is a posed offset on top, which
  // is what animation layers expect and what exporters bake as the node TRS.
  bones.shoulderL.rotation.z = -0.14;
  bones.shoulderR.rotation.z = 0.14;
  bones.elbowL.rotation.z = -0.1;
  bones.elbowR.rotation.z = 0.1;

  root.updateMatrixWorld(true);

  return {
    root,
    skinned,
    skeleton,
    bones,
    headPivot,
    mouth,
    jaw,
    arms,
    palette,
    visemeIndex,
    dispose: () => {
      for (const item of disposables) item.dispose();
      skeleton.dispose();
    },
  };
}

function attachLimb(
  shoulder: THREE.Bone,
  elbow: THREE.Bone,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  accent: THREE.Material,
  side: number,
): THREE.Group {
  const group = new THREE.Group();
  group.name = side > 0 ? 'Arm_L' : 'Arm_R';

  // Capsules are Y-aligned by default, so an arm that hangs needs no rotation —
  // only an offset to the midpoint of its bone segment.
  const upper = new THREE.Mesh(geometry, material);
  upper.name = side > 0 ? 'UpperArm_L' : 'UpperArm_R';
  upper.position.y = -0.135;
  upper.castShadow = true;
  shoulder.add(upper);

  const shoulderPad = new THREE.Mesh(geometry, material);
  shoulderPad.scale.set(1.35, 0.42, 1.35);
  shoulderPad.position.y = 0.01;
  shoulderPad.castShadow = true;
  shoulder.add(shoulderPad);

  const fore = new THREE.Mesh(geometry, material);
  fore.name = side > 0 ? 'Forearm_L' : 'Forearm_R';
  fore.position.y = -0.13;
  fore.scale.setScalar(0.88);
  fore.castShadow = true;
  elbow.add(fore);

  const cuff = new THREE.Mesh(geometry, accent);
  cuff.position.y = -0.25;
  cuff.scale.set(1.12, 0.17, 1.12);
  elbow.add(cuff);

  const hand = new THREE.Mesh(geometry, material);
  hand.name = side > 0 ? 'Hand_L' : 'Hand_R';
  hand.position.y = -0.3;
  hand.scale.set(0.95, 0.3, 0.8);
  elbow.add(hand);

  return group;
}

function createBones(): Record<BoneName, THREE.Bone> {
  const bones = {} as Record<BoneName, THREE.Bone>;

  for (const entry of BONE_LAYOUT) {
    const bone = new THREE.Bone();
    bone.name = entry.name;
    bone.position.set(...entry.position);
    bones[entry.name] = bone;
    if (entry.parent) bones[entry.parent].add(bone);
  }

  return bones;
}

/** Tapered torso capsule; `build` widens or narrows the silhouette. */
function buildTorsoGeometry(build: number): THREE.BufferGeometry {
  const geometry = new THREE.CapsuleGeometry(0.24 * build, 0.52, 8, 24);
  geometry.translate(0, 1.2, 0);

  // Taper into a V: narrow at the waist, broad across the chest. Without this
  // the capsule reads as a pill and the arms have nothing to hang clear of.
  const position = geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < position.count; i += 1) {
    const y = position.getY(i);
    const t = THREE.MathUtils.clamp((y - 0.92) / 0.52, 0, 1);
    // Ease so the widening happens across the ribcage, not linearly all the way.
    const eased = t * t * (3 - 2 * t);
    const taper = THREE.MathUtils.lerp(0.72, 1.14, eased);
    position.setX(i, position.getX(i) * taper);
    position.setZ(i, position.getZ(i) * taper * 0.74);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();

  return geometry;
}

/**
 * Assigns each vertex to the two nearest bones in the spine chain, weighted by
 * vertical distance. Crude next to a production solver, but it produces smooth
 * deformation along the chain and exports as valid glTF skin weights.
 */
function bindSkinWeights(
  geometry: THREE.BufferGeometry,
  layout: typeof BONE_LAYOUT,
): void {
  const chain: Array<{ index: number; y: number }> = [];
  let accumulated = 0;

  layout.forEach((entry, index) => {
    if (!['hips', 'spine', 'chest', 'neck', 'head'].includes(entry.name)) return;
    accumulated += entry.position[1];
    chain.push({ index, y: accumulated });
  });

  const position = geometry.attributes.position as THREE.BufferAttribute;
  const indices = new Uint16Array(position.count * 4);
  const weights = new Float32Array(position.count * 4);

  for (let i = 0; i < position.count; i += 1) {
    const y = position.getY(i);

    let lower = chain[0];
    let upper = chain[chain.length - 1];
    for (let c = 0; c < chain.length - 1; c += 1) {
      if (y >= chain[c].y && y <= chain[c + 1].y) {
        lower = chain[c];
        upper = chain[c + 1];
        break;
      }
      if (y < chain[0].y) {
        lower = chain[0];
        upper = chain[0];
        break;
      }
    }

    const span = upper.y - lower.y;
    const blend = span > 0 ? THREE.MathUtils.clamp((y - lower.y) / span, 0, 1) : 0;

    indices[i * 4] = lower.index;
    indices[i * 4 + 1] = upper.index;
    weights[i * 4] = 1 - blend;
    weights[i * 4 + 1] = blend;
  }

  geometry.setAttribute('skinIndex', new THREE.BufferAttribute(indices, 4));
  geometry.setAttribute('skinWeight', new THREE.BufferAttribute(weights, 4));
}

/**
 * Mouth cavity carrying one absolute-position morph target per viseme, named
 * so downstream tools (Unity's SkinnedMeshRenderer, Babylon's morph manager)
 * can bind to `viseme_aa`, `viseme_O`, and friends by name.
 */
function buildMouthGeometry(): {
  geometry: THREE.BufferGeometry;
  visemeIndex: Record<Viseme, number>;
} {
  const geometry = new THREE.SphereGeometry(0.042, 20, 16);
  geometry.scale(1.2, 0.6, 0.5);

  const base = (geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
  const targets: THREE.BufferAttribute[] = [];
  const visemeIndex = {} as Record<Viseme, number>;

  VISEMES.forEach((viseme, index) => {
    const { w, h, z } = VISEME_SHAPE[viseme];
    const morphed = new Float32Array(base.length);

    for (let i = 0; i < base.length; i += 3) {
      morphed[i] = base[i] * w;
      morphed[i + 1] = base[i + 1] * h;
      morphed[i + 2] = base[i + 2] * z;
    }

    const attribute = new THREE.BufferAttribute(morphed, 3);
    attribute.name = `viseme_${viseme}`;
    targets.push(attribute);
    visemeIndex[viseme] = index;
  });

  geometry.morphAttributes.position = targets;
  geometry.morphTargetsRelative = false;

  return { geometry, visemeIndex };
}

/**
 * Builds the character palette out of colours sampled from the upload.
 *
 * The suit and accent come straight from the image. Skin is nudged by the
 * reference's overall lightness rather than taken from it — sampling skin off
 * a logo produces alarming results.
 */
function paletteFromAppearance(
  appearance: CharacterAppearance,
  random: () => number,
): CharacterPalette {
  const suit = new THREE.Color(appearance.suit);
  const accent = new THREE.Color(appearance.accent);

  // A suit that is nearly black swallows all shading, and one that is nearly
  // white blows out under the key light. Pull extremes back into range.
  const suitHsl = { h: 0, s: 0, l: 0 };
  suit.getHSL(suitHsl);
  suit.setHSL(suitHsl.h, Math.min(0.72, suitHsl.s), THREE.MathUtils.clamp(suitHsl.l, 0.16, 0.62));

  // The accent has to read against the suit, so guarantee it is brighter.
  const accentHsl = { h: 0, s: 0, l: 0 };
  accent.getHSL(accentHsl);

  // Only lift the accent when it would otherwise disappear into the suit.
  // Forcing separation unconditionally washed saturated colours out to pastel.
  const hueGap = Math.min(
    Math.abs(accentHsl.h - suitHsl.h),
    1 - Math.abs(accentHsl.h - suitHsl.h),
  );
  const tooClose = hueGap < 0.08 && Math.abs(accentHsl.l - suitHsl.l) < 0.18;

  accent.setHSL(
    accentHsl.h,
    Math.max(0.62, accentHsl.s),
    THREE.MathUtils.clamp(tooClose ? suitHsl.l + 0.26 : accentHsl.l, 0.42, 0.68),
  );

  return {
    skin: new THREE.Color().setHSL(
      0.07 + random() * 0.03,
      0.34,
      THREE.MathUtils.clamp(0.4 + appearance.lightness * 0.3, 0.38, 0.72),
    ),
    suit,
    accent,
    visor: accent.clone().offsetHSL(0.04, 0, 0.08),
  };
}

function buildPalette(random: () => number): CharacterPalette {
  const hue = random();
  return {
    skin: new THREE.Color().setHSL(0.07 + random() * 0.03, 0.34, 0.52 + random() * 0.18),
    suit: new THREE.Color().setHSL(hue, 0.28 + random() * 0.2, 0.2 + random() * 0.12),
    accent: new THREE.Color().setHSL((hue + 0.48) % 1, 0.82, 0.58),
    visor: new THREE.Color().setHSL((hue + 0.52) % 1, 0.9, 0.62),
  };
}
