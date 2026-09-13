import { useEffect, useRef } from 'react';
import { Button } from './Button';
import { AlertIcon } from './icons';

export interface ConfirmRequest {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'danger' | 'neutral';
  onConfirm: () => void;
}

/**
 * Destructive-action gate.
 *
 * Every "Discard" in the studio routes through here: the buttons themselves
 * stay visually quiet, and the weight of the decision lives in this sheet. It
 * traps focus, closes on Escape, and puts Cancel first in the tab order so the
 * safe choice is the one a stray Enter hits.
 */
export function ConfirmDialog({
  request,
  onDismiss,
}: {
  request: ConfirmRequest | null;
  onDismiss: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!request) return;

    cancelRef.current?.focus();

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss();
    };
    document.addEventListener('keydown', handleKey);

    // Freeze the page behind the sheet — iOS will otherwise scroll the body.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = previous;
    };
  }, [request, onDismiss]);

  if (!request) return null;

  const danger = request.tone !== 'neutral';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      className="fixed inset-0 z-50 flex items-end justify-center"
    >
      <button
        type="button"
        aria-label="Cancel"
        onClick={onDismiss}
        className="absolute inset-0 bg-obsidian-950/78 backdrop-blur-sm"
      />

      <div className="safe-bottom glass animate-rise relative w-full max-w-md rounded-t-sheet border-t border-white/10 px-5 pt-6">
        <div className="flex gap-3.5">
          <span
            aria-hidden
            className={
              danger
                ? 'grid size-10 shrink-0 place-items-center rounded-2xl bg-danger-500/12 text-danger-400'
                : 'grid size-10 shrink-0 place-items-center rounded-2xl bg-beam-500/12 text-beam-400'
            }
          >
            <AlertIcon className="size-5" />
          </span>

          <div className="min-w-0 flex-1">
            <h2 id="confirm-title" className="text-[17px] leading-tight font-semibold text-ink-100">
              {request.title}
            </h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-500">{request.body}</p>
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-2">
          <Button
            variant={danger ? 'destructive' : 'primary'}
            block
            onClick={() => {
              request.onConfirm();
              onDismiss();
            }}
          >
            {request.confirmLabel}
          </Button>
          <button
            ref={cancelRef}
            type="button"
            onClick={onDismiss}
            className="inline-flex min-h-touch w-full items-center justify-center rounded-2xl px-5 text-[15px] text-ink-500 transition-colors active:bg-obsidian-800/60"
          >
            {request.cancelLabel ?? 'Keep working'}
          </button>
        </div>
      </div>
    </div>
  );
}
