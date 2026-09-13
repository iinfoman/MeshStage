import { useEffect, useRef } from 'react';
import type { ExportResult } from '../lib/exporters';
import type { InspectionRow } from '../lib/inspect';
import { cn, formatBytes } from '../lib/utils';
import { CheckIcon, AlertIcon, DownloadIcon } from './icons';

/**
 * Post-export verification panel.
 *
 * Shows what was actually produced rather than asserting success: the parsed
 * structure of the asset, and for video an inline player so the take can be
 * watched and *heard* without leaving the page. This is the primary evidence
 * the export worked — the file save is secondary, and in an embedded viewer
 * it may not be available at all.
 */
export function ExportPreview({
  result,
  onSave,
  onDismiss,
}: {
  result: ExportResult;
  onSave: () => void;
  onDismiss: () => void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const { inspection } = result;

  // The panel sits above the format grid, so a user who scrolled down to pick
  // a format would tap Download and see nothing change. Bring the result to
  // them instead of making them hunt for it.
  useEffect(() => {
    panelRef.current?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'nearest',
    });
  }, [result.filename, result.objectUrl]);

  // Autoplay the take once so the user immediately sees (and hears) the result.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.play().catch(() => {
      // Autoplay refused — the controls are right there.
    });
  }, [result.objectUrl]);

  const good = inspection?.valid ?? true;

  return (
    <section
      ref={panelRef}
      aria-label="Export verification"
      className={cn(
        'mt-3 overflow-hidden rounded-2xl border',
        good ? 'border-ok-400/28 bg-ok-400/[0.05]' : 'border-warn-400/30 bg-warn-400/[0.05]',
      )}
    >
      <header className="flex items-start gap-2.5 px-3.5 pt-3">
        <span className={cn('mt-0.5 shrink-0', good ? 'text-ok-400' : 'text-warn-400')}>
          {good ? <CheckIcon className="size-[18px]" /> : <AlertIcon className="size-[18px]" />}
        </span>

        <span className="min-w-0 flex-1">
          <span className={cn('block text-[13px] font-semibold', good ? 'text-ok-400' : 'text-warn-400')}>
            {inspection?.headline ?? 'Export complete'}
          </span>
          <span className="mt-0.5 block truncate font-mono text-[11px] text-ink-500">
            {result.filename} · {formatBytes(result.bytes)}
          </span>
        </span>

        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss verification"
          className="-mt-1 -mr-1.5 grid size-touch shrink-0 place-items-center text-ink-600"
        >
          ✕
        </button>
      </header>

      {/* Inline playback is the real proof for video: you watch the lip-sync
          and hear whether the audio track made it in. */}
      {inspection?.kind === 'video' && result.objectUrl && (
        <div className="mt-3 px-3.5">
          <video
            ref={videoRef}
            src={result.objectUrl}
            controls
            playsInline
            loop
            className="w-full rounded-xl border border-white/[0.07] bg-obsidian-950"
          />
        </div>
      )}

      {inspection && inspection.rows.length > 0 && (
        <dl className="mt-3 grid gap-1.5 px-3.5">
          {inspection.rows.map((row) => (
            <Row key={row.label} row={row} />
          ))}
        </dl>
      )}

      {inspection?.detail && inspection.detail.length > 0 && (
        <details className="mt-2.5 px-3.5">
          <summary className="flex min-h-touch cursor-pointer items-center text-[12px] text-ink-500">
            {inspection.kind === 'glb' ? 'Blendshape names' : 'First keys'}
          </summary>
          <pre className="scroll-pane mt-1 max-h-32 rounded-xl bg-obsidian-950/70 p-2.5 font-mono text-[10.5px] leading-relaxed whitespace-pre-wrap text-ink-500">
            {inspection.detail.join('\n')}
          </pre>
        </details>
      )}

      <div className="mt-3 flex items-center gap-2 border-t border-white/[0.06] px-3.5 py-2.5">
        <button
          type="button"
          onClick={onSave}
          className="inline-flex min-h-touch flex-1 items-center justify-center gap-2 rounded-xl bg-obsidian-800 px-4 text-[13.5px] text-ink-100 active:bg-obsidian-700"
        >
          <DownloadIcon className="size-4" />
          Save to device
        </button>
      </div>

      {result.saveBlocked && (
        <p className="px-3.5 pb-3 text-[11px] leading-relaxed text-ink-600">
          This embedded viewer blocks page-initiated downloads, so the save may not
          start. The verification above is read back from the real exported bytes —
          run the studio locally to keep the file.
        </p>
      )}
    </section>
  );
}

function Row({ row }: { row: InspectionRow }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-[11.5px] text-ink-600">{row.label}</dt>
      <dd
        className={cn(
          // `m-0` is load-bearing: the UA stylesheet gives <dd> a 40px inline
          // start margin, which pushes the value out of the panel entirely.
          'm-0 min-w-0 truncate text-right font-mono text-[11px]',
          row.tone === 'ok' && 'text-ok-400',
          row.tone === 'warn' && 'text-warn-400',
          (!row.tone || row.tone === 'plain') && 'text-ink-300',
        )}
      >
        {row.value}
      </dd>
    </div>
  );
}
