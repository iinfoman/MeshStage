import { SpeakerIcon } from './icons';

/**
 * The iOS Safari gesture guard.
 *
 * WebKit refuses to start an AudioContext or speak an utterance that wasn't
 * initiated by a real touch, and it fails *silently* — the user taps "Speak",
 * nothing happens, and the app looks broken. So we surface the requirement
 * explicitly and satisfy it with one deliberate tap.
 *
 * Rendered inside the viewport rather than over the whole app: the rest of the
 * studio stays usable while audio is still locked.
 */
export function AudioUnlockOverlay({ onUnlock }: { onUnlock: () => void }) {
  return (
    <button
      type="button"
      onClick={onUnlock}
      // `onTouchEnd` fires inside the gesture on WebKit even when a stray
      // scroll would otherwise swallow the synthetic click.
      onTouchEnd={(event) => {
        event.preventDefault();
        onUnlock();
      }}
      className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-obsidian-950/72 px-8 backdrop-blur-md"
    >
      <span className="relative grid size-16 place-items-center">
        <span
          aria-hidden
          className="absolute inset-0 animate-breathe rounded-full bg-beam-500/18 ring-1 ring-beam-500/40"
        />
        <SpeakerIcon className="relative size-7 text-beam-400" />
      </span>

      <span className="text-center">
        <span className="block text-[15px] font-semibold text-ink-100">
          Tap to Initialize WebAudio
        </span>
        <span className="mt-1 block max-w-[17rem] text-[12.5px] leading-relaxed text-ink-500">
          iOS requires one touch before speech playback can start. Your character stays silent
          until then.
        </span>
      </span>
    </button>
  );
}
