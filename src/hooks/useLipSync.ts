import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildVisemeTimeline,
  sampleTimeline,
  type Viseme,
  type VisemeTimeline,
} from '../lib/visemes';
import type { VoiceSettings } from '../types/studio';

/**
 * A mutable playhead shared between React and the render loop.
 *
 * The 3D character samples this object 60 times a second. Keeping it out of
 * React state is deliberate: re-rendering the tree every frame would drop the
 * viewport well below 60fps on a mid-range phone.
 */
export interface LipSyncClock {
  timeline: VisemeTimeline;
  playing: boolean;
  /** performance.now() at utterance start, or 0 when idle. */
  startedAt: number;
  sample: (now: number) => { viseme: Viseme; weight: number; progress: number };
}

export interface LipSyncApi {
  clock: LipSyncClock;
  timeline: VisemeTimeline;
  speaking: boolean;
  /** True when the browser exposes no speech synthesis at all. */
  unsupported: boolean;
  speak: () => void;
  stop: () => void;
}

export function useLipSync(script: string, voice: VoiceSettings): LipSyncApi {
  const [speaking, setSpeaking] = useState(false);

  const timeline = useMemo(
    () => buildVisemeTimeline(script, { rate: voice.rate }),
    [script, voice.rate],
  );

  const unsupported = typeof window !== 'undefined' && !('speechSynthesis' in window);

  const clockRef = useRef<LipSyncClock>({
    timeline,
    playing: false,
    startedAt: 0,
    sample: () => ({ viseme: 'sil', weight: 0, progress: 0 }),
  });

  // Bind `sample` once; it reads through the ref so it always sees live state.
  if (clockRef.current.sample.length === 0) {
    clockRef.current.sample = (now: number) => {
      const clock = clockRef.current;
      if (!clock.playing || clock.startedAt === 0) {
        return { viseme: 'sil' as Viseme, weight: 0, progress: 0 };
      }
      const elapsed = now - clock.startedAt;
      const { viseme, weight } = sampleTimeline(clock.timeline, elapsed);
      const progress =
        clock.timeline.duration > 0 ? Math.min(1, elapsed / clock.timeline.duration) : 0;
      return { viseme, weight, progress };
    };
  }

  clockRef.current.timeline = timeline;

  const stop = useCallback(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    clockRef.current.playing = false;
    clockRef.current.startedAt = 0;
    setSpeaking(false);
  }, []);

  const speak = useCallback(() => {
    const text = script.trim();
    if (!text) return;

    // Drive the mouth even without a TTS engine, so the rig stays previewable
    // on devices with no installed voices.
    const startVisualPlayback = () => {
      clockRef.current.playing = true;
      clockRef.current.startedAt = performance.now();
      setSpeaking(true);
    };

    const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;

    if (!synth) {
      startVisualPlayback();
      setTimeout(stop, timeline.duration);
      return;
    }

    synth.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    const match = synth.getVoices().find((candidate) => candidate.voiceURI === voice.voiceURI);
    if (match) utterance.voice = match;
    utterance.lang = match?.lang ?? voice.lang;
    utterance.rate = voice.rate;
    utterance.pitch = voice.pitch;

    utterance.onstart = startVisualPlayback;

    // `onboundary` gives us the real engine's word timings — when it fires we
    // re-anchor the playhead so the mouth tracks the actual audio instead of
    // our estimate. Safari doesn't emit it, hence the estimate as the baseline.
    utterance.onboundary = (event) => {
      if (event.name && event.name !== 'word') return;
      const key = timeline.keys.find((candidate) => candidate.wordIndex === wordIndexAt(text, event.charIndex));
      if (!key) return;
      const drift = performance.now() - (clockRef.current.startedAt + key.time);
      // Only correct meaningful drift; small nudges every word look like jitter.
      if (Math.abs(drift) > 60) clockRef.current.startedAt += drift;
    };

    utterance.onend = stop;
    utterance.onerror = stop;

    synth.speak(utterance);

    // Safari occasionally never fires `onstart` for short utterances; start the
    // visual playhead optimistically if it stays silent.
    window.setTimeout(() => {
      if (!clockRef.current.playing && synth.speaking) startVisualPlayback();
    }, 250);
  }, [script, stop, timeline, voice]);

  // Never leave an utterance running when the stage unmounts or is discarded.
  useEffect(() => stop, [stop]);

  return { clock: clockRef.current, timeline, speaking, unsupported, speak, stop };
}

/** Word index for a character offset, matching `buildVisemeTimeline`'s split. */
function wordIndexAt(text: string, charIndex: number): number {
  const head = text.slice(0, Math.max(0, charIndex));
  const words = head.trim().split(/\s+/).filter(Boolean);
  return Math.max(0, words.length - (/\s$/.test(head) ? 0 : 1));
}
