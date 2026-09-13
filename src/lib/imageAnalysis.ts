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

  const hasAlpha = alphaPixels > (SAMPLE * SAMPLE) / 8;

  return {
    dominant,
    accent: toHex(accentEntry.r, accentEntry.g, accentEntry.b),
    shade: toHex(darkest.r, darkest.g, darkest.b),
    lightness: counted > 0 ? luminanceSum / counted : 0.5,
    hasAlpha,
    palette,
    textureDataUrl: buildTexture(image, hasAlpha ? { minX, minY, maxX, maxY } : null),
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
): string {
  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE;
  canvas.height = TEXTURE;
  const context = canvas.getContext('2d');
  if (!context) return '';

  context.imageSmoothingQuality = 'high';

  let sx = 0;
  let sy = 0;
  let sw = image.naturalWidth;
  let sh = image.naturalHeight;

  if (bounds && bounds.maxX > bounds.minX && bounds.maxY > bounds.minY) {
    const scaleX = image.naturalWidth / SAMPLE;
    const scaleY = image.naturalHeight / SAMPLE;
    // One sample cell of padding so the crop never clips an anti-aliased edge.
    sx = Math.max(0, (bounds.minX - 1) * scaleX);
    sy = Math.max(0, (bounds.minY - 1) * scaleY);
    sw = Math.min(image.naturalWidth - sx, (bounds.maxX - bounds.minX + 3) * scaleX);
    sh = Math.min(image.naturalHeight - sy, (bounds.maxY - bounds.minY + 3) * scaleY);
  }

  // Letterbox into the square rather than stretching — a squashed mascot is
  // immediately recognisable as a bug.
  const scale = Math.min(TEXTURE / sw, TEXTURE / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  context.drawImage(image, sx, sy, sw, sh, (TEXTURE - dw) / 2, (TEXTURE - dh) / 2, dw, dh);

  return canvas.toDataURL('image/png');
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
