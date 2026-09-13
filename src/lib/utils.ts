/** Tiny classname joiner — avoids pulling clsx in for a handful of call sites. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/** FNV-1a — stable across reloads, which keeps a given prompt on one mesh. */
export function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Deterministic 0..1 generator seeded by `hashString`. */
export function makeRandom(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 100000) / 100000;
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDuration(ms: number): string {
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
}

export const isIOS = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  // iPadOS 13+ reports as Macintosh, so touch points disambiguate it.
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
};

/**
 * Hands a generated file to the user. Mobile Safari ignores `download` on
 * blob URLs in some contexts, so we keep the anchor in the document for the
 * duration of the click and revoke on a delay rather than immediately.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  window.setTimeout(() => {
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, 4000);
}

/** Filesystem-safe slug for export file names. */
export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'meshstage-character'
  );
}

/**
 * True when this page almost certainly cannot start its own download.
 *
 * Embedded viewers sandbox the frame, and `allow-downloads` is commonly
 * withheld — the anchor click is then simply inert, with no error to catch.
 * There is no direct feature test, so this reads the sandbox flags where the
 * browser exposes them and falls back to "we are framed cross-origin".
 */
export function downloadsAreBlocked(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.self === window.top) return false;

  const sandbox = window.frameElement?.getAttribute('sandbox');
  if (sandbox !== null && sandbox !== undefined) {
    return !sandbox.split(/\s+/).includes('allow-downloads');
  }

  // Cross-origin frame: `frameElement` throws or returns null, so we cannot
  // read the flags. Assume blocked and lead with in-page verification, which
  // is the more useful surface either way.
  return true;
}
