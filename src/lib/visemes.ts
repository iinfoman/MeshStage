/**
 * Text → viseme timeline.
 *
 * MeshStage rigs every character against the 15-shape ARKit/Oculus viseme set,
 * which is what both `.GLB` blendshapes and the `.JSON` timeline export carry.
 * The mapping below is grapheme-driven rather than a full phonemiser: it is
 * cheap enough to run on every keystroke on a mid-range phone, and accurate
 * enough that mouth shapes land on the right syllables.
 */

export const VISEMES = [
  'sil', // rest
  'PP', // p, b, m
  'FF', // f, v
  'TH', // th
  'DD', // t, d
  'kk', // k, g
  'CH', // ch, j, sh
  'SS', // s, z
  'nn', // n, l
  'RR', // r
  'aa', // a
  'E', // e
  'I', // i
  'O', // o
  'U', // u, w
] as const;

export type Viseme = (typeof VISEMES)[number];

export const VISEME_INDEX: Record<Viseme, number> = VISEMES.reduce(
  (acc, viseme, index) => {
    acc[viseme] = index;
    return acc;
  },
  {} as Record<Viseme, number>,
);

/** Average duration of one viseme at rate 1.0, in milliseconds. */
const BASE_VISEME_MS = 78;
/** Consonants are clipped; open vowels are held. */
const DURATION_SCALE: Partial<Record<Viseme, number>> = {
  sil: 1.6,
  PP: 0.8,
  DD: 0.75,
  kk: 0.8,
  SS: 1.15,
  CH: 1.2,
  FF: 1.1,
  aa: 1.5,
  O: 1.4,
  U: 1.35,
  E: 1.25,
  I: 1.15,
};

export interface VisemeKey {
  /** Milliseconds from the start of the utterance. */
  time: number;
  duration: number;
  viseme: Viseme;
  /** 0..1 mouth opening for this shape. */
  weight: number;
  /** Index of the source word, for editors that scrub by word. */
  wordIndex: number;
}

export interface VisemeTimeline {
  keys: VisemeKey[];
  /** Total utterance length in milliseconds. */
  duration: number;
  wordCount: number;
}

const DIGRAPHS: Array<[RegExp, Viseme]> = [
  [/^th/, 'TH'],
  [/^ch/, 'CH'],
  [/^sh/, 'CH'],
  [/^ph/, 'FF'],
  [/^wh/, 'U'],
  [/^ck/, 'kk'],
  [/^qu/, 'U'],
  [/^ng/, 'nn'],
  [/^oo/, 'U'],
  [/^ou/, 'O'],
  [/^ow/, 'O'],
  [/^ee/, 'I'],
  [/^ea/, 'I'],
  [/^ai/, 'E'],
  [/^ay/, 'E'],
  [/^oa/, 'O'],
];

const LETTER_MAP: Record<string, Viseme> = {
  a: 'aa',
  b: 'PP',
  c: 'kk',
  d: 'DD',
  e: 'E',
  f: 'FF',
  g: 'kk',
  h: 'sil',
  i: 'I',
  j: 'CH',
  k: 'kk',
  l: 'nn',
  m: 'PP',
  n: 'nn',
  o: 'O',
  p: 'PP',
  q: 'kk',
  r: 'RR',
  s: 'SS',
  t: 'DD',
  u: 'U',
  v: 'FF',
  w: 'U',
  x: 'SS',
  y: 'I',
  z: 'SS',
};

const OPEN_WEIGHT: Partial<Record<Viseme, number>> = {
  sil: 0,
  aa: 1,
  O: 0.86,
  E: 0.7,
  U: 0.58,
  I: 0.5,
  CH: 0.46,
  RR: 0.44,
  nn: 0.34,
  DD: 0.3,
  kk: 0.34,
  SS: 0.26,
  TH: 0.3,
  FF: 0.24,
  PP: 0.06,
};

/** Splits a word into visemes, collapsing runs of the same shape. */
function wordToVisemes(word: string): Viseme[] {
  const letters = word.toLowerCase().replace(/[^a-z]/g, '');
  const out: Viseme[] = [];
  let cursor = 0;

  while (cursor < letters.length) {
    const rest = letters.slice(cursor);
    const digraph = DIGRAPHS.find(([pattern]) => pattern.test(rest));

    if (digraph) {
      pushViseme(out, digraph[1]);
      cursor += 2;
      continue;
    }

    const mapped = LETTER_MAP[rest[0]];
    if (mapped) pushViseme(out, mapped);
    cursor += 1;
  }

  // A trailing silent "e" is not spoken — drop it so "mesh-stage" doesn't
  // finish on an open vowel.
  if (out.length > 1 && letters.endsWith('e') && out[out.length - 1] === 'E') {
    out.pop();
  }

  return out.length > 0 ? out : ['sil'];
}

function pushViseme(list: Viseme[], viseme: Viseme) {
  if (list[list.length - 1] !== viseme) list.push(viseme);
}

export interface BuildTimelineOptions {
  /** SpeechSynthesis rate, 0.5..2. Higher rate compresses every key. */
  rate?: number;
}

export function buildVisemeTimeline(
  text: string,
  { rate = 1 }: BuildTimelineOptions = {},
): VisemeTimeline {
  const safeRate = Math.min(2, Math.max(0.5, rate));
  const words = text.trim().split(/\s+/).filter(Boolean);
  const keys: VisemeKey[] = [];
  let time = 0;

  words.forEach((word, wordIndex) => {
    for (const viseme of wordToVisemes(word)) {
      const duration = (BASE_VISEME_MS * (DURATION_SCALE[viseme] ?? 1)) / safeRate;
      keys.push({
        time: Math.round(time),
        duration: Math.round(duration),
        viseme,
        weight: OPEN_WEIGHT[viseme] ?? 0.4,
        wordIndex,
      });
      time += duration;
    }

    // Inter-word closure — punctuation buys a longer beat.
    const trailing = /[,;:]$/.test(word) ? 2.4 : /[.!?]$/.test(word) ? 4 : 1;
    const pause = (BASE_VISEME_MS * 0.55 * trailing) / safeRate;
    keys.push({
      time: Math.round(time),
      duration: Math.round(pause),
      viseme: 'sil',
      weight: 0,
      wordIndex,
    });
    time += pause;
  });

  return { keys, duration: Math.round(time), wordCount: words.length };
}

/**
 * Samples the timeline at `timeMs`, returning the active viseme plus a smoothly
 * interpolated jaw weight. Co-articulation is approximated with a short
 * cross-fade in and out of each key so the jaw never snaps between shapes.
 */
export function sampleTimeline(
  timeline: VisemeTimeline,
  timeMs: number,
): { viseme: Viseme; weight: number; index: number } {
  const { keys } = timeline;
  if (keys.length === 0) return { viseme: 'sil', weight: 0, index: -1 };

  // Keys are ordered, so a binary search keeps per-frame cost at O(log n).
  let low = 0;
  let high = keys.length - 1;
  let found = 0;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (keys[mid].time <= timeMs) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const key = keys[found];
  const elapsed = timeMs - key.time;
  if (elapsed > key.duration) return { viseme: 'sil', weight: 0, index: found };

  const blend = Math.min(key.duration * 0.4, 45);
  const fadeIn = blend > 0 ? Math.min(1, elapsed / blend) : 1;
  const fadeOut = blend > 0 ? Math.min(1, (key.duration - elapsed) / blend) : 1;

  return {
    viseme: key.viseme,
    weight: key.weight * Math.min(fadeIn, fadeOut),
    index: found,
  };
}

/** Serialisable payload behind the `.JSON` Animation Timestamps export. */
export function timelineToExport(
  timeline: VisemeTimeline,
  meta: { characterId: string; characterName: string; script: string; voice: string },
) {
  return {
    format: 'meshstage.viseme-timeline',
    version: 1,
    generatedAt: new Date().toISOString(),
    character: { id: meta.characterId, name: meta.characterName },
    voice: meta.voice,
    script: meta.script,
    visemeSet: VISEMES,
    durationMs: timeline.duration,
    fps: 60,
    keys: timeline.keys.map((key) => ({
      t: key.time,
      d: key.duration,
      viseme: key.viseme,
      index: VISEME_INDEX[key.viseme],
      weight: Number(key.weight.toFixed(3)),
      word: key.wordIndex,
    })),
  };
}

export interface RetimeSource {
  /** Word-boundary marks from the TTS engine, if it emits any. */
  marks?: Array<{ timeMs: number; durationMs: number }>;
  /** True length of the rendered audio, in milliseconds. */
  durationMs?: number;
}

/**
 * Re-anchors an estimated timeline onto real audio.
 *
 * The grapheme estimate gets mouth *shapes* right but only guesses at timing.
 * Once we have the actual audio there are two better sources, in order:
 *
 *  1. Word-boundary marks (Edge-TTS emits these) — each word's visemes are
 *     redistributed across that word's real start and duration, so drift can
 *     never accumulate across a long script.
 *  2. Total duration alone (espeak, and anything else without marks) — the
 *     whole timeline is scaled by one factor. Cruder, but it still beats an
 *     estimate that can be 20% out on an unusual voice or rate.
 */
export function retimeTimeline(timeline: VisemeTimeline, source: RetimeSource): VisemeTimeline {
  const { marks, durationMs } = source;

  if (marks && marks.length > 0) {
    const byWord = new Map<number, VisemeKey[]>();
    for (const key of timeline.keys) {
      const bucket = byWord.get(key.wordIndex);
      if (bucket) bucket.push(key);
      else byWord.set(key.wordIndex, [key]);
    }

    const keys: VisemeKey[] = [];

    for (const [wordIndex, wordKeys] of [...byWord.entries()].sort((a, b) => a[0] - b[0])) {
      const mark = marks[wordIndex];
      if (!mark) {
        keys.push(...wordKeys);
        continue;
      }

      // Distribute this word's visemes across the mark proportionally to the
      // durations the estimator assigned them, so stressed vowels stay long.
      const total = wordKeys.reduce((sum, key) => sum + key.duration, 0) || 1;
      let cursor = mark.timeMs;

      for (const key of wordKeys) {
        const share = (key.duration / total) * mark.durationMs;
        keys.push({ ...key, time: Math.round(cursor), duration: Math.max(1, Math.round(share)) });
        cursor += share;
      }
    }

    keys.sort((a, b) => a.time - b.time);
    const last = keys[keys.length - 1];

    return {
      keys,
      duration: durationMs && durationMs > 0 ? durationMs : last ? last.time + last.duration : 0,
      wordCount: timeline.wordCount,
    };
  }

  if (durationMs && durationMs > 0 && timeline.duration > 0) {
    const scale = durationMs / timeline.duration;
    return {
      keys: timeline.keys.map((key) => ({
        ...key,
        time: Math.round(key.time * scale),
        duration: Math.max(1, Math.round(key.duration * scale)),
      })),
      duration: durationMs,
      wordCount: timeline.wordCount,
    };
  }

  return timeline;
}
