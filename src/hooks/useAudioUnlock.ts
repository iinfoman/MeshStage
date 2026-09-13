import { useCallback, useEffect, useRef, useState } from 'react';

type AudioContextCtor = typeof AudioContext;

function getAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  return (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext ??
    null
  );
}

export interface AudioUnlockApi {
  /** True once the AudioContext is running and speech has been primed. */
  unlocked: boolean;
  /** True when we know a gesture is required and haven't received one yet. */
  needsGesture: boolean;
  unlock: () => Promise<void>;
  context: AudioContext | null;
}

/**
 * iOS Safari (and Chrome's autoplay policy) start every AudioContext in a
 * `suspended` state and refuse `speechSynthesis.speak()` until the page has
 * seen a real user gesture. This hook owns that handshake:
 *
 *  1. Creates the context lazily so we never spin up audio hardware unasked.
 *  2. Resumes it inside the gesture handler — resuming later, e.g. after an
 *     await, loses the gesture's "user activation" on WebKit.
 *  3. Primes `speechSynthesis` with a zero-volume utterance, because Safari
 *     silently drops the *first* real utterance if it wasn't gesture-initiated.
 */
export function useAudioUnlock(): AudioUnlockApi {
  const contextRef = useRef<AudioContext | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [needsGesture, setNeedsGesture] = useState(false);

  useEffect(() => {
    const Ctor = getAudioContextCtor();
    if (!Ctor) {
      // No WebAudio at all — nothing to unlock, let the UI proceed silently.
      setUnlocked(true);
      return;
    }

    const context = new Ctor();
    contextRef.current = context;

    if (context.state === 'running') {
      setUnlocked(true);
    } else {
      setNeedsGesture(true);
    }

    const handleStateChange = () => {
      const running = context.state === 'running';
      setUnlocked(running);
      setNeedsGesture(!running);
    };
    context.addEventListener('statechange', handleStateChange);

    // Backgrounding the tab re-suspends the context on iOS; re-arm the overlay
    // when the user comes back so the next "Speak" tap is never swallowed.
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && context.state === 'suspended') {
        setUnlocked(false);
        setNeedsGesture(true);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      context.removeEventListener('statechange', handleStateChange);
      document.removeEventListener('visibilitychange', handleVisibility);
      void context.close().catch(() => undefined);
      contextRef.current = null;
    };
  }, []);

  const unlock = useCallback(async () => {
    const context = contextRef.current;

    if (context) {
      // Kick a silent one-sample buffer through the graph. WebKit treats this
      // as the "first sound" and fully opens the audio route.
      try {
        const buffer = context.createBuffer(1, 1, 22050);
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        source.start(0);
      } catch {
        // A failed prime is not fatal; resume() below is the load-bearing call.
      }

      try {
        await context.resume();
      } catch {
        setNeedsGesture(true);
        return;
      }
    }

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        const primer = new SpeechSynthesisUtterance('');
        primer.volume = 0;
        window.speechSynthesis.speak(primer);
        window.speechSynthesis.cancel();
      } catch {
        // Some Android WebViews throw on an empty utterance — harmless.
      }
    }

    setUnlocked(true);
    setNeedsGesture(false);
  }, []);

  return { unlocked, needsGesture, unlock, context: contextRef.current };
}
