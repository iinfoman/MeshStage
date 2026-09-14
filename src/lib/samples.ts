/**
 * Built-in reference images, drawn at runtime.
 *
 * These exist because a file picker is not always available: embedded and
 * sandboxed viewers can block it outright, and when they do there is no
 * app-side fix — the tap simply never reaches a chooser. A sample gives the
 * pipeline something real to work on so the studio is still testable there.
 *
 * Drawn rather than shipped as assets so they cost no extra requests and
 * cannot 404.
 */

export interface SampleReference {
  id: string;
  label: string;
  hint: string;
  /** What the app should detect it as, which is also what it will build. */
  expects: 'face' | 'figure';
  draw: (context: CanvasRenderingContext2D, size: number) => void;
}

export const SAMPLES: SampleReference[] = [
  {
    id: 'mascot',
    label: 'Mascot face',
    hint: 'Builds a head',
    expects: 'face',
    draw: (ctx, s) => {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, s, s);

      const cx = s / 2;
      const cy = s / 2;
      const r = s * 0.34;

      const body = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.4, r * 0.1, cx, cy, r);
      body.addColorStop(0, '#ffb340');
      body.addColorStop(1, '#f07d18');
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();

      // Brows and eyes, above the mouth, so it reads unambiguously as a face.
      ctx.strokeStyle = '#3a2412';
      ctx.lineWidth = r * 0.09;
      ctx.lineCap = 'round';
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(cx + side * r * 0.38, cy - r * 0.34, r * 0.2, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
      }

      for (const side of [-1, 1]) {
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.ellipse(cx + side * r * 0.36, cy - r * 0.12, r * 0.17, r * 0.2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#241610';
        ctx.beginPath();
        ctx.arc(cx + side * r * 0.36, cy - r * 0.1, r * 0.11, 0, Math.PI * 2);
        ctx.fill();
      }

      // Open smile with teeth — the warm dark mass the mouth finder looks for.
      ctx.fillStyle = '#5e1119';
      ctx.beginPath();
      ctx.ellipse(cx, cy + r * 0.36, r * 0.3, r * 0.19, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#c8303c';
      ctx.beginPath();
      ctx.ellipse(cx, cy + r * 0.44, r * 0.2, r * 0.09, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fdfdfd';
      ctx.fillRect(cx - r * 0.16, cy + r * 0.19, r * 0.32, r * 0.1);
    },
  },
  {
    id: 'figure',
    label: 'Standing figure',
    hint: 'Builds a full body',
    expects: 'figure',
    draw: (ctx, s) => {
      ctx.clearRect(0, 0, s, s);
      const cx = s / 2;

      ctx.fillStyle = '#3c4a72';
      ctx.beginPath();
      ctx.arc(cx, s * 0.13, s * 0.075, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#2a78bb';
      ctx.beginPath();
      ctx.roundRect(cx - s * 0.13, s * 0.21, s * 0.26, s * 0.34, s * 0.06);
      ctx.fill();

      // Arms, kept inside the silhouette so the aspect stays figure-like.
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.roundRect(cx + side * s * 0.17 - s * 0.035, s * 0.23, s * 0.07, s * 0.28, s * 0.035);
        ctx.fill();
      }

      ctx.fillStyle = '#1e2a52';
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.roundRect(cx + side * s * 0.06 - s * 0.045, s * 0.55, s * 0.09, s * 0.36, s * 0.04);
        ctx.fill();
      }
    },
  },
];

/** Renders a sample to a data URL the pipeline can treat as an upload. */
export function renderSample(sample: SampleReference, size = 512): string {
  const canvas = document.createElement('canvas');
  // Figures are drawn tall so their aspect reads as a standing body.
  canvas.width = sample.expects === 'figure' ? Math.round(size * 0.55) : size;
  canvas.height = size;

  const context = canvas.getContext('2d');
  if (!context) return '';

  // Draw in a square coordinate space, then let the canvas size do the rest.
  context.save();
  context.translate((canvas.width - size) / 2, 0);
  sample.draw(context, size);
  context.restore();

  return canvas.toDataURL('image/png');
}
