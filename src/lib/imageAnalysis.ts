/**
 * Reads an uploaded reference and derives what the character should look like.
 *
 * This is not 3D reconstruction — it does not infer geometry. What it does is
 * make the upload genuinely determine the result: the palette comes from the
 * image's own colours, the artwork is carried onto the mesh as a texture, and
 * the seed is derived from pixel content rather than the file name, so two
 * different pictures can never produce the same character.
 */

export interface ImageAnalysis {
  /** Most populous saturated colour — drives the suit. */
  dominant: string;
  /** A contrasting companion — drives trim and the visor. */
  accent: string;
  /** Darkest populous colour, for shadowed panels. */
  shade: string;
  /** 0..1 average perceived lightness of the subject. */
  lightness: number;
  /** True when the source has meaningful transparency (logos, emoji, stickers). */
  hasAlpha: boolean;
  /** The full sorted palette, most populous first. */
  palette: string[];
  /** Content-cropped copy of the upload, square, for use as a texture. */
  textureDataUrl: string;
  /** Stable hash of the pixels — the character seed. */
  contentHash: number;
  /**
   * Where the mouth sits in `textureDataUrl`, normalised 0..1.
   *
   * Used to land the viseme mouth on the artwork's own mouth, so a face
   * reference animates where it looks like it should rather than at a fixed
   * position that happens to miss.
   */
  mouthAnchor: { u: number; v: number } | null;
  /**
   * What the reference actually is, and therefore what to build.
   *
   * A face has to come back as a face. The app reads the upload and matches
   * the output to it rather than defaulting to a full body and expecting the
   * user to go and correct it.
   */
  subject: 'face' | 'figure' | 'artwork';
}

/** Sampling resolution. 64² is plenty for palette work and costs ~4ms. */
const SAMPLE = 64;
/** Texture resolution handed to the GPU. */
const TEXTURE = 256;

export async function analyzeImage(dataUrl: string): Promise<ImageAnalysis> {
  const image = await loadImage(dataUrl);

  const canvas = document.createElement('canvas');
  canvas.width = SAMPLE;
  canvas.height = SAMPLE;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Could not read the image.');

  context.drawImage(image, 0, 0, SAMPLE, SAMPLE);
  const { data } = context.getImageData(0, 0, SAMPLE, SAMPLE);

  // --- Bucket the pixels ----------------------------------------------------
  // 4 bits per channel: coarse enough to group shades of the same colour,
  // fine enough to keep a mascot's palette distinct.
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();
  let alphaPixels = 0;
  let luminanceSum = 0;
  let counted = 0;
  let hash = 0x811c9dc5;

  let minX = SAMPLE;
  let minY = SAMPLE;
  let maxX = 0;
  let maxY = 0;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];

    // Hash every pixel, transparent ones included — this is the identity of
    // the upload, and it must change if any pixel changes.
    hash ^= r + (g << 3) + (b << 6) + (a << 9);
    hash = Math.imul(hash, 0x01000193);

    if (a < 24) {
      alphaPixels += 1;
      continue;
    }

    const index = i / 4;
    const x = index % SAMPLE;
    const y = Math.floor(index / SAMPLE);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;

    luminanceSum += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    counted += 1;

    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.count += 1;
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
    } else {
      buckets.set(key, { count: 1, r, g, b });
    }
  }

  const hasAlpha = alphaPixels > (SAMPLE * SAMPLE) / 8;

  // Plenty of mascots and emoji arrive on a flat white (or flat anything)
  // background rather than transparency. Detect that by sampling the border;
  // when it is uniform, matching pixels are background, so the subject gets
  // cropped and the backdrop never dominates the palette.
  const backdrop = hasAlpha ? null : detectBackdrop(data);

  if (backdrop) {
    const key = ((backdrop[0] >> 4) << 8) | ((backdrop[1] >> 4) << 4) | (backdrop[2] >> 4);
    buckets.delete(key);
  }

  const bounds = hasAlpha
    ? { minX, minY, maxX, maxY }
    : backdrop
      ? subjectBounds(data, backdrop)
      : null;

  const entries = [...buckets.values()]
    .map((bucket) => ({
      count: bucket.count,
      r: Math.round(bucket.r / bucket.count),
      g: Math.round(bucket.g / bucket.count),
      b: Math.round(bucket.b / bucket.count),
    }))
    .sort((a, b) => b.count - a.count);

  const palette = entries.slice(0, 8).map((entry) => toHex(entry.r, entry.g, entry.b));

  // The suit wants a colour with some life in it. Near-greys usually come from
  // a background or an anti-aliased edge, so prefer a saturated bucket while
  // still favouring populous ones.
  const scored = entries
    .map((entry) => {
      const { s } = rgbToHsl(entry.r, entry.g, entry.b);
      return { entry, score: entry.count * (0.25 + s) };
    })
    .sort((a, b) => b.score - a.score);

  const dominantEntry = scored[0]?.entry ?? { r: 90, g: 110, b: 140 };
  const dominant = toHex(dominantEntry.r, dominantEntry.g, dominantEntry.b);

  // Accent: the most populous colour furthest in hue from the dominant, so the
  // trim reads against the suit instead of blending into it.
  const dominantHue = rgbToHsl(dominantEntry.r, dominantEntry.g, dominantEntry.b).h;
  const accentEntry =
    scored
      .slice(1, 6)
      .map((candidate) => {
        const { h } = rgbToHsl(candidate.entry.r, candidate.entry.g, candidate.entry.b);
        const distance = Math.min(Math.abs(h - dominantHue), 1 - Math.abs(h - dominantHue));
        return { entry: candidate.entry, distance };
      })
      .sort((a, b) => b.distance - a.distance)[0]?.entry ?? complementOf(dominantEntry);

  const darkest = [...entries]
    .sort(
      (a, b) =>
        0.2126 * a.r + 0.7152 * a.g + 0.0722 * a.b - (0.2126 * b.r + 0.7152 * b.g + 0.0722 * b.b),
    )[0] ?? { r: 20, g: 20, b: 28 };

  const mouth = findMouthAnchor(data, bounds, backdrop, image.naturalWidth, image.naturalHeight);

  return {
    dominant,
    accent: toHex(accentEntry.r, accentEntry.g, accentEntry.b),
    shade: toHex(darkest.r, darkest.g, darkest.b),
    lightness: counted > 0 ? luminanceSum / counted : 0.5,
    hasAlpha,
    palette,
    textureDataUrl: buildTexture(image, bounds, backdrop),
    mouthAnchor: mouth,
    subject: classifySubject(data, bounds, backdrop, image, Boolean(mouth)),
    contentHash: hash >>> 0,
  };
}

/**
 * Produces the square texture applied to the character.
 *
 * For artwork with transparency (a mascot, a logo, an emoji) the content is
 * cropped to its bounding box and centred, so it lands on the mesh at a usable
 * size instead of swimming in empty pixels.
 */
function buildTexture(
  image: HTMLImageElement,
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null,
  backdrop: [number, number, number] | null,
): string {
  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE;
  canvas.height = TEXTURE;
  const context = canvas.getContext('2d');
  if (!context) return '';

  context.imageSmoothingQuality = 'high';

  const crop = cropFor(bounds);
  const scaleX = image.naturalWidth / SAMPLE;
  const scaleY = image.naturalHeight / SAMPLE;

  const sx = crop.sx * scaleX;
  const sy = crop.sy * scaleY;
  const sw = crop.sw * scaleX;
  const sh = crop.sh * scaleY;

  // Letterbox into the square rather than stretching — a squashed mascot is
  // immediately recognisable as a bug.
  const scale = Math.min(TEXTURE / sw, TEXTURE / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  context.drawImage(image, sx, sy, sw, sh, (TEXTURE - dw) / 2, (TEXTURE - dh) / 2, dw, dh);

  // Knock a flat backdrop out to transparency so the artwork sits on the mesh
  // rather than inside an opaque rectangle.
  if (backdrop) {
    const pixels = context.getImageData(0, 0, TEXTURE, TEXTURE);
    const { data: px } = pixels;
    for (let i = 0; i < px.length; i += 4) {
      const distance =
        Math.abs(px[i] - backdrop[0]) +
        Math.abs(px[i + 1] - backdrop[1]) +
        Math.abs(px[i + 2] - backdrop[2]);
      if (distance < 42) px[i + 3] = 0;
    }
    context.putImageData(pixels, 0, 0);
  }

  return canvas.toDataURL('image/png');
}

/**
 * Returns the background colour when the border is uniform enough to be one.
 *
 * Sampling the frame rather than a single corner: a subject that bleeds to one
 * edge would otherwise be mistaken for the backdrop.
 */
/**
 * Locates the mouth in a face-like reference.
 *
 * Mouths are the darkest saturated feature in the lower middle of a face, so
 * this takes the centroid of dark pixels in that band. It is a heuristic and
 * it returns null rather than guessing when the evidence is weak — the caller
 * falls back to a standard face position.
 */
interface CropRect {
  /** Source rect in SAMPLE space. */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/**
 * The crop the texture is built from, in sample space.
 *
 * Shared with the mouth anchor: the two used to compute their own crops and
 * disagreed by the padding and the letterbox offset, which put the animated
 * mouth off to one side of the drawn one.
 */
function cropFor(bounds: { minX: number; minY: number; maxX: number; maxY: number } | null): CropRect {
  if (!bounds || bounds.maxX <= bounds.minX || bounds.maxY <= bounds.minY) {
    return { sx: 0, sy: 0, sw: SAMPLE, sh: SAMPLE };
  }
  // One sample cell of padding so the crop never clips an anti-aliased edge.
  const sx = Math.max(0, bounds.minX - 1);
  const sy = Math.max(0, bounds.minY - 1);
  return {
    sx,
    sy,
    sw: Math.min(SAMPLE - sx, bounds.maxX - bounds.minX + 3),
    sh: Math.min(SAMPLE - sy, bounds.maxY - bounds.minY + 3),
  };
}

/**
 * Maps a point in sample space into the square texture's 0..1 UV space.
 *
 * The sample canvas is a fixed square, so a non-square upload is stretched
 * into it — a phone screenshot at 1080x2340 squashes a circular mascot to
 * roughly 2:1. Palette work is unaffected, but every *geometric* measurement
 * has to be converted back through the real aspect ratio before it means
 * anything. Skipping this put the animated mouth well above the drawn one.
 */
function sampleToTextureUv(
  x: number,
  y: number,
  crop: CropRect,
  imageWidth: number,
  imageHeight: number,
): { u: number; v: number } {
  const pxPerSampleX = imageWidth / SAMPLE;
  const pxPerSampleY = imageHeight / SAMPLE;

  // The crop, in real image pixels — this is what buildTexture letterboxes.
  const cropW = crop.sw * pxPerSampleX;
  const cropH = crop.sh * pxPerSampleY;
  const offsetX = (x - crop.sx) * pxPerSampleX;
  const offsetY = (y - crop.sy) * pxPerSampleY;

  const scale = Math.min(1 / cropW, 1 / cropH);
  const drawnW = cropW * scale;
  const drawnH = cropH * scale;

  return {
    u: (1 - drawnW) / 2 + offsetX * scale,
    v: (1 - drawnH) / 2 + offsetY * scale,
  };
}

/**
 * Decides what the upload depicts.
 *
 * Two signals, both cheap: the subject's real-world aspect ratio (corrected
 * for the sample canvas's stretch), and whether a face's features are where a
 * face's features go — a pair of dark masses either side of centre above a
 * mouth. A head-and-shoulders photo or a mascot reads as `face`; a standing
 * figure is far taller than it is wide and reads as `figure`.
 */
function classifySubject(
  data: Uint8ClampedArray,
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null,
  backdrop: [number, number, number] | null,
  image: HTMLImageElement,
  hasMouth: boolean,
): 'face' | 'figure' | 'artwork' {
  const box = bounds ?? { minX: 0, minY: 0, maxX: SAMPLE - 1, maxY: SAMPLE - 1 };
  const width = box.maxX - box.minX;
  const height = box.maxY - box.minY;
  if (width < 6 || height < 6) return 'artwork';

  // Undo the sample canvas's stretch before judging proportions.
  const aspect =
    (width * (image.naturalWidth / SAMPLE)) / (height * (image.naturalHeight / SAMPLE));

  // A standing figure is much taller than wide; no face crop ever is.
  if (aspect < 0.55) return 'figure';

  return hasEyePair(data, box, backdrop) && hasMouth ? 'face' : aspect > 1.6 ? 'artwork' : 'face';
}

/** Looks for two balanced dark masses either side of centre, above the mouth. */
function hasEyePair(
  data: Uint8ClampedArray,
  box: { minX: number; minY: number; maxX: number; maxY: number },
  backdrop: [number, number, number] | null,
): boolean {
  const width = box.maxX - box.minX;
  const height = box.maxY - box.minY;

  const top = box.minY + height * 0.25;
  const bottom = box.minY + height * 0.58;
  const centre = box.minX + width / 2;

  let left = 0;
  let right = 0;

  for (let y = Math.floor(top); y <= Math.floor(bottom); y += 1) {
    for (let x = box.minX; x <= box.maxX; x += 1) {
      const i = (y * SAMPLE + x) * 4;
      if (data[i + 3] < 24) continue;
      if (
        backdrop &&
        Math.abs(data[i] - backdrop[0]) +
          Math.abs(data[i + 1] - backdrop[1]) +
          Math.abs(data[i + 2] - backdrop[2]) <
          48
      ) {
        continue;
      }

      const luminance =
        (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
      if (luminance > 0.42) continue;

      if (x < centre) left += 1;
      else right += 1;
    }
  }

  if (left < 2 || right < 2) return false;

  // Eyes come in pairs, so the two sides should carry comparable mass.
  const balance = Math.min(left, right) / Math.max(left, right);
  return balance > 0.35;
}

function findMouthAnchor(
  data: Uint8ClampedArray,
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null,
  backdrop: [number, number, number] | null,
  imageWidth: number,
  imageHeight: number,
): { u: number; v: number } | null {
  const box = bounds ?? { minX: 0, minY: 0, maxX: SAMPLE - 1, maxY: SAMPLE - 1 };
  const width = box.maxX - box.minX;
  const height = box.maxY - box.minY;
  // Proportions of the subject box stay valid under the sample canvas's
  // stretch, because the box is stretched identically — only the conversion
  // out to texture space needs the real aspect ratio.
  if (width < 6 || height < 6) return null;

  // Strictly below the eyes. A band starting at mid-height catches pupils,
  // which are the darkest thing on most faces, and drags the anchor up between
  // the eyes instead of onto the mouth.
  const top = box.minY + height * 0.58;
  const bottom = box.minY + height * 0.92;
  const left = box.minX + width * 0.28;
  const right = box.maxX - width * 0.28;

  // Track the extent of the mouth, not its centre of mass. A mouth open on
  // one side (teeth on the other) has its dark mass off-centre, so a weighted
  // centroid lands on the shadow rather than the mouth.
  let minMx = SAMPLE;
  let minMy = SAMPLE;
  let maxMx = 0;
  let maxMy = 0;
  let weight = 0;

  for (let y = Math.floor(top); y <= Math.floor(bottom); y += 1) {
    for (let x = Math.floor(left); x <= Math.floor(right); x += 1) {
      const i = (y * SAMPLE + x) * 4;
      if (data[i + 3] < 24) continue;
      if (
        backdrop &&
        Math.abs(data[i] - backdrop[0]) +
          Math.abs(data[i + 1] - backdrop[1]) +
          Math.abs(data[i + 2] - backdrop[2]) <
          48
      ) {
        continue;
      }

      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

      // Darker than mid-grey, weighted so the darkest pixels dominate.
      if (luminance > 0.5) continue;

      // Mouth interiors are red-dominant — tongue, gums, shadow. Weighting
      // warmth alongside darkness keeps a shadowed cheek or a dark chin from
      // pulling the anchor off the mouth.
      const warmth = Math.max(0, (r - Math.max(g, b)) / 255);
      const w = Math.pow(0.5 - luminance, 2) * (1 + warmth * 4);
      if (w < 0.004) continue;

      if (x < minMx) minMx = x;
      if (y < minMy) minMy = y;
      if (x > maxMx) maxMx = x;
      if (y > maxMy) maxMy = y;
      weight += w;
    }
  }

  // Too little dark material to be a mouth.
  if (weight < 0.5) return null;

  const cx = (minMx + maxMx) / 2;
  const cy = (minMy + maxMy) / 2;

  // Report in the texture's own UV space, not the subject box's.
  return sampleToTextureUv(cx, cy, cropFor(bounds), imageWidth, imageHeight);
}

function detectBackdrop(data: Uint8ClampedArray): [number, number, number] | null {
  const samples: Array<[number, number, number]> = [];

  const push = (x: number, y: number) => {
    const i = (y * SAMPLE + x) * 4;
    if (data[i + 3] > 200) samples.push([data[i], data[i + 1], data[i + 2]]);
  };

  for (let x = 0; x < SAMPLE; x += 2) {
    push(x, 0);
    push(x, SAMPLE - 1);
  }
  for (let y = 0; y < SAMPLE; y += 2) {
    push(0, y);
    push(SAMPLE - 1, y);
  }

  if (samples.length < 16) return null;

  const mean = samples
    .reduce(
      (acc, [r, g, b]) => [acc[0] + r, acc[1] + g, acc[2] + b] as [number, number, number],
      [0, 0, 0] as [number, number, number],
    )
    .map((total) => total / samples.length) as [number, number, number];

  // Uniform means most of the border sits close to that mean.
  const consistent = samples.filter(
    ([r, g, b]) =>
      Math.abs(r - mean[0]) < 26 && Math.abs(g - mean[1]) < 26 && Math.abs(b - mean[2]) < 26,
  ).length;

  return consistent / samples.length > 0.85
    ? (mean.map(Math.round) as [number, number, number])
    : null;
}

/** Bounding box of everything that is not the backdrop colour. */
function subjectBounds(data: Uint8ClampedArray, backdrop: [number, number, number]) {
  let minX = SAMPLE;
  let minY = SAMPLE;
  let maxX = 0;
  let maxY = 0;
  let found = false;

  for (let i = 0; i < data.length; i += 4) {
    const distance =
      Math.abs(data[i] - backdrop[0]) +
      Math.abs(data[i + 1] - backdrop[1]) +
      Math.abs(data[i + 2] - backdrop[2]);
    if (data[i + 3] < 24 || distance < 48) continue;

    const index = i / 4;
    const x = index % SAMPLE;
    const y = Math.floor(index / SAMPLE);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    found = true;
  }

  return found ? { minX, minY, maxX, maxY } : null;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('That image could not be decoded.'));
    image.src = src;
  });
}

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')}`;
}

function complementOf({ r, g, b }: { r: number; g: number; b: number }) {
  return { r: 255 - r, g: 255 - g, b: 255 - b };
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const delta = max - min;

  if (delta === 0) return { h: 0, s: 0, l };

  const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / delta + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / delta + 2) / 6;
  else h = ((rn - gn) / delta + 4) / 6;

  return { h, s, l };
}
