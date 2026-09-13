import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildVisemeTimeline,
  retimeTimeline,
  sampleTimeline,
  type Viseme,
  type VisemeTimeline,
} from '../lib/visemes';
import { synthesizeSpeech } from '../lib/tts';
import type { AudioUnlockApi } from './useAudioUnlock';
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
  /** The estimated timeline; playback may run a retimed copy. */
  timeline: VisemeTimeline;
  speaking: boolean;
  /** True while neural audio is being synthesised. */
  loading: boolean;
  error: string | null;
  unsupported: boolean;
  speak: () => void;
  stop: () => void;
  /**
   * Audio track of the current take, for the video exporter.
   * Only available on the neural path — `speechSynthesis` output cannot be
   * routed into WebAudio on any current browser, so there is nothing to tap.
   */
  getAudioStream: () => MediaStream | null;
}

export function useLipSync(
  script: string,
  voice: VoiceSettings,
  audio: AudioUnlockApi,
): LipSyncApi {
  const [speaking, setSpeaking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const timeline = useMemo(
    () => buildVisemeTimeline(script, { rate: voice.rate }),
    [script, voice.rate],
  );

  const unsupported =
    typeof window !== 'undefined' && !('speechSynthesis' in window) && voice.provider === 'system';

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

  // Keep the idle clock in sync with the estimate until a take starts.
  if (!clockRef.current.playing) clockRef.current.timeline = timeline;

  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const captureRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const watchdogRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    window.clearTimeout(watchdogRef.current);
    abortRef.current?.abort();
    abortRef.current = null;

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }

    if (sourceRef.current) {
      try {
        sourceRef.current.onended = null;
        sourceRef.current.stop();
      } catch {
        // Already stopped — the node is single-use and may have ended itself.
      }
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }

    clockRef.current.playing = false;
    clockRef.current.startedAt = 0;
    clockRef.current.timeline = timeline;
    setSpeaking(false);
    setLoading(false);
  }, [timeline]);

  const beginPlayback = useCallback((active: VisemeTimeline) => {
    clockRef.current.timeline = active;
    clockRef.current.playing = true;
    clockRef.current.startedAt = performance.now();
    setSpeaking(true);
  }, []);

  /**
   * Guards against an `onend` that never arrives.
   *
   * Safari drops `onend` for long utterances, and a Linux speech-dispatcher
   * setup with no audio sink never fires it at all — in both cases the mouth
   * would animate forever and the Stop button would be the only way out.
   */
  const armWatchdog = useCallback(
    (durationMs: number) => {
      window.clearTimeout(watchdogRef.current);
      watchdogRef.current = window.setTimeout(stop, durationMs + 1500);
    },
    [stop],
  );

  // ---- System path: the browser's own speechSynthesis -----------------------
  const speakSystem = useCallback(
    (text: string) => {
      const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;

      if (!synth) {
        // No TTS engine: still drive the rig so the preview is usable.
        beginPlayback(timeline);
        armWatchdog(timeline.duration);
        return;
      }

      synth.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      const match = synth.getVoices().find((candidate) => candidate.voiceURI === voice.voiceURI);
      if (match) utterance.voice = match;
      utterance.lang = match?.lang ?? voice.lang;
      utterance.rate = voice.rate;
      utterance.pitch = voice.pitch;

      utterance.onstart = () => {
        beginPlayback(timeline);
        armWatchdog(timeline.duration);
      };

      // `onboundary` gives us the real engine's word timings — when it fires we
      // re-anchor the playhead so the mouth tracks the actual audio instead of
      // our estimate. Safari doesn't emit it, hence the estimate as baseline.
      utterance.onboundary = (event) => {
        if (event.name && event.name !== 'word') return;
        const key = clockRef.current.timeline.keys.find(
          (candidate) => candidate.wordIndex === wordIndexAt(text, event.charIndex),
        );
        if (!key) return;
        const drift = performance.now() - (clockRef.current.startedAt + key.time);
        if (Math.abs(drift) > 60) clockRef.current.startedAt += drift;
      };

      utterance.onend = stop;
      utterance.onerror = (event) => {
        if (event.error !== 'canceled' && event.error !== 'interrupted') {
          setError(`Speech engine error: ${event.error}`);
        }
        stop();
      };

      synth.speak(utterance);

      // Safari occasionally never fires `onstart` for short utterances.
      window.setTimeout(() => {
        if (!clockRef.current.playing && synth.speaking) {
          beginPlayback(timeline);
          armWatchdog(timeline.duration);
        }
      }, 250);
    },
    [voice, timeline, beginPlayback, armWatchdog, stop],
  );

  /**
   * Lazily builds the capture node, but never later than the caller asks.
   *
   * The video exporter reads the audio stream *before* it starts the take, so
   * creating this inside playback was always one step too late and every
   * recording came out silent. The node is reused across takes.
   */
  const ensureCapture = useCallback(
    (context: AudioContext): MediaStreamAudioDestinationNode | null => {
      if (!captureRef.current) {
        try {
          captureRef.current = context.createMediaStreamDestination();
        } catch {
          return null;
        }
      }
      return captureRef.current;
    },
    [],
  );

  // ---- Neural path: audio from the MeshStage TTS service -------------------
  const speakNeural = useCallback(
    async (text: string) => {
      const context = audio.getContext();
      if (!context) {
        setError('Audio is not initialised on this device.');
        return;
      }

      // Playback needs a running context; on iOS this is the unlock gesture.
      if (context.state === 'suspended') await context.resume().catch(() => undefined);

      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      setError(null);

      try {
        const result = await synthesizeSpeech(
          {
            text,
            voiceId: voice.voiceURI,
            provider: voice.provider === 'system' ? undefined : voice.provider,
            rate: voice.rate,
            pitch: voice.pitch,
          },
          controller.signal,
        );

        if (controller.signal.aborted) return;

        // decodeAudioData detaches the buffer, so hand it a copy — a retry
        // would otherwise get a zero-length ArrayBuffer.
        const buffer = await context.decodeAudioData(result.audio.slice(0));
        if (controller.signal.aborted) return;

        const durationMs = Math.round(buffer.duration * 1000) || result.durationMs;
        const active = retimeTimeline(timeline, { marks: result.marks, durationMs });

        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);

        // Tap the same node into a MediaStream so the video exporter can mux
        // real audio — the thing speechSynthesis makes impossible.
        const capture = ensureCapture(context);
        if (capture) source.connect(capture);

        source.onended = () => {
          if (sourceRef.current === source) stop();
        };

        sourceRef.current = source;
        setLoading(false);
        source.start();
        beginPlayback(active);
        armWatchdog(durationMs);
      } catch (caught) {
        if (controller.signal.aborted) return;
        setLoading(false);
        setError(caught instanceof Error ? caught.message : 'Speech synthesis failed.');
        // Fall back to a silent rig preview so the stage stays demonstrable.
        beginPlayback(timeline);
        armWatchdog(timeline.duration);
      }
    },
    [audio, voice, timeline, beginPlayback, armWatchdog, stop],
  );

  const speak = useCallback(() => {
    const text = script.trim();
    if (!text) return;

    setError(null);
    stop();

    if (voice.provider === 'system') speakSystem(text);
    else void speakNeural(text);
  }, [script, voice.provider, speakSystem, speakNeural, stop]);

  const getAudioStream = useCallback(() => {
    // System voices go through speechSynthesis, which no browser routes into
    // WebAudio — reporting a stream here would promise audio we cannot deliver.
    if (voice.provider === 'system') return null;

    const context = audio.getContext();
    if (!context) return null;
    return ensureCapture(context)?.stream ?? null;
  }, [voice.provider, audio, ensureCapture]);

  // Never leave an utterance running when the stage unmounts or is discarded.
  useEffect(() => stop, [stop]);

  return {
    clock: clockRef.current,
    timeline,
    speaking,
    loading,
    error,
    unsupported,
    speak,
    stop,
    getAudioStream,
  };
}

/** Word index for a character offset, matching `buildVisemeTimeline`'s split. */
function wordIndexAt(text: string, charIndex: number): number {
  const head = text.slice(0, Math.max(0, charIndex));
  const words = head.trim().split(/\s+/).filter(Boolean);
  return Math.max(0, words.length - (/\s$/.test(head) ? 0 : 1));
}
