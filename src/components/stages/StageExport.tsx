import { Viewport } from '../../three/Viewport';
import { Character } from '../../three/Character';
import { StageFloor } from '../../three/StageFloor';
import { ActionBar } from '../ActionBar';
import { Button } from '../Button';
import { GlassSheet } from '../GlassSheet';
import { AlertIcon, BoltIcon, CheckIcon, CloudIcon, DownloadIcon, TrashIcon } from '../icons';
import { useStudio } from '../../state/StudioContext';
import { useExportRunner } from '../../hooks/useExportRunner';
import { cn, formatBytes } from '../../lib/utils';
import { EXPORT_FORMATS, type ExportFormatMeta } from '../../types/studio';
import type { ConfirmRequest } from '../ConfirmDialog';

export function StageExport({ onConfirm }: { onConfirm: (request: ConfirmRequest) => void }) {
  const { state, dispatch, lipSync } = useStudio();
  const { run, saveToLibrary, lastResult } = useExportRunner();
  const character = state.character;

  const selected = EXPORT_FORMATS.find((format) => format.id === state.selectedFormat)!;
  const exporting = state.exportJob.status === 'running';
  const outOfCredits = selected.metered && state.tier.rendersLeft <= 0;

  const handleDiscard = () => {
    onConfirm({
      title: 'Discard and start a new character?',
      body: state.cloudSave.status === 'saved'
        ? 'This session is already saved to your library, so you can reopen it later. The studio will reset to step 1.'
        : 'This character has not been saved to your library. The mesh, rig and script will be lost permanently.',
      confirmLabel: 'Discard & new character',
      onConfirm: () => {
        lipSync.stop();
        dispatch({ type: 'discardAll' });
      },
    });
  };

  return (
    <>
      {/* Upper 50%: borderless viewport bleeding into the sheet below. */}
      <div className="flex min-h-0 flex-1 basis-1/2 flex-col">
        <Viewport
          className="min-h-0 flex-1"
          accent="#3b82f6"
          autoRotate
          fit={{ focus: 0.64, padding: 1.3, azimuth: 0.42, dependency: character?.seed }}
          transparent={state.transparentBackground}
          overlay={
            <>
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_15%,rgba(59,130,246,0.14),transparent_58%)]"
              />
              {state.transparentBackground && <TransparencyChecker />}
              {character && (
                <div className="pointer-events-none absolute top-3 left-4 rounded-full bg-obsidian-950/70 px-3 py-1.5 text-[12.5px] font-medium text-ink-100 backdrop-blur-sm">
                  {character.name}
                </div>
              )}
            </>
          }
        >
          {character && <Character seed={character.seed} motion={state.motion} />}
          {!state.transparentBackground && <StageFloor accent="#3b82f6" />}
        </Viewport>
      </div>

      {/* Lower 50%: the SaaS hub. */}
      <GlassSheet className="min-h-0 flex-1 basis-1/2">
        <div className="scroll-pane flex-1 px-4 pb-4">
          <TierBadge
            plan={state.tier.plan}
            left={state.tier.rendersLeft}
            total={state.tier.rendersTotal}
            onUpgrade={() =>
              onConfirm({
                title: 'Upgrade to Creator',
                body: '250 renders a month, 4K video output, transparent-background exports and commercial licensing. $19/month, cancel anytime.',
                confirmLabel: 'Start Creator plan',
                cancelLabel: 'Not now',
                tone: 'neutral',
                onConfirm: () => dispatch({ type: 'upgradeTier' }),
              })
            }
          />

          <ExportStatus
            status={state.exportJob.status}
            progress={state.exportJob.progress}
            message={state.exportJob.message}
            resultBytes={lastResult?.bytes}
            note={lastResult?.note}
            onDismiss={() => dispatch({ type: 'exportDismissed' })}
          />

          <h2 className="mt-4 mb-2 text-[11px] font-semibold tracking-[0.13em] text-ink-500 uppercase">
            Download & save
          </h2>

          <ul className="space-y-2">
            {EXPORT_FORMATS.map((format) => (
              <li key={format.id}>
                <FormatCard
                  format={format}
                  selected={format.id === state.selectedFormat}
                  locked={format.metered && state.tier.rendersLeft <= 0}
                  onSelect={() => dispatch({ type: 'selectFormat', formatId: format.id })}
                />
              </li>
            ))}
          </ul>

          {selected.id === 'video' && (
            <label className="mt-3 flex min-h-touch items-center justify-between gap-3 rounded-2xl border border-obsidian-700 bg-obsidian-850/60 px-4">
              <span className="min-w-0">
                <span className="block text-[13.5px] text-ink-100">Transparent background</span>
                <span className="block text-[11.5px] text-ink-600">
                  Alpha matte for compositing over your own footage.
                </span>
              </span>
              <input
                type="checkbox"
                checked={state.transparentBackground}
                onChange={(event) =>
                  dispatch({ type: 'setTransparentBackground', value: event.target.checked })
                }
                className="size-6 shrink-0 accent-beam-500"
              />
            </label>
          )}

        </div>
      </GlassSheet>

      <ActionBar>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            className="flex-1"
            loading={state.cloudSave.status === 'saving'}
            icon={
              state.cloudSave.status === 'saved' ? (
                <CheckIcon className="size-[17px] text-ok-400" />
              ) : (
                <CloudIcon className="size-[17px]" />
              )
            }
            onClick={() => void saveToLibrary()}
          >
            {state.cloudSave.status === 'saved' ? 'Saved' : 'Save to Cloud'}
          </Button>

          <Button
            variant="primary"
            className="flex-[1.35]"
            loading={exporting}
            disabled={outOfCredits || !character}
            icon={<DownloadIcon className="size-[18px]" />}
            onClick={() => void run(state.selectedFormat)}
          >
            {exporting
              ? selected.id === 'video'
                ? 'Rendering take…'
                : 'Preparing…'
              : outOfCredits
                ? 'Upgrade to render'
                : `Download ${selected.extension.split(' ')[0]}`}
          </Button>
        </div>

        <Button
          variant="destructive"
          block
          icon={<TrashIcon className="size-[17px]" />}
          onClick={handleDiscard}
        >
          Discard & New Character
        </Button>
      </ActionBar>
    </>
  );
}

function TierBadge({
  plan,
  left,
  total,
  onUpgrade,
}: {
  plan: string;
  left: number;
  total: number;
  onUpgrade: () => void;
}) {
  const pro = plan !== 'free';
  const low = !pro && left <= 1;

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-2xl border px-3.5 py-2.5',
        low
          ? 'border-warn-400/30 bg-warn-400/[0.07]'
          : 'border-white/[0.07] bg-obsidian-850/60',
      )}
    >
      <span
        className={cn(
          'grid size-9 shrink-0 place-items-center rounded-xl',
          pro ? 'bg-beam-500/16 text-beam-400' : 'bg-obsidian-800 text-ink-500',
        )}
      >
        <BoltIcon className="size-[18px]" />
      </span>

      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] font-semibold tracking-wide text-ink-100 uppercase">
          {plan} tier
          <span className="mx-1.5 text-ink-600">•</span>
          <span className={cn('tabular-nums', low ? 'text-warn-400' : 'text-ink-300')}>
            {left}/{total} renders left
          </span>
        </span>
        <span className="mt-1 block h-1 overflow-hidden rounded-full bg-obsidian-800">
          <span
            className={cn(
              'block h-full rounded-full transition-[width] duration-500',
              low ? 'bg-warn-400' : 'bg-gradient-to-r from-beam-500 to-pulse-500',
            )}
            style={{ width: `${total > 0 ? (left / total) * 100 : 0}%` }}
          />
        </span>
      </span>

      {!pro && (
        <button
          type="button"
          onClick={onUpgrade}
          className="min-h-touch shrink-0 rounded-xl bg-gradient-to-r from-beam-500 to-pulse-500 px-4 text-[13px] font-semibold text-obsidian-950 active:scale-[0.98]"
        >
          Upgrade
        </button>
      )}
    </div>
  );
}

function FormatCard({
  format,
  selected,
  locked,
  onSelect,
}: {
  format: ExportFormatMeta;
  selected: boolean;
  locked: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'flex w-full min-h-touch items-start gap-3 rounded-2xl border px-3.5 py-3 text-left transition-colors duration-200',
        selected
          ? 'border-beam-500/45 bg-beam-500/[0.08]'
          : 'border-obsidian-700 bg-obsidian-850/55 active:bg-obsidian-800',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border transition-colors',
          selected ? 'border-beam-500 bg-beam-500 text-obsidian-950' : 'border-obsidian-600',
        )}
      >
        {selected && <CheckIcon className="size-3" strokeWidth={3} />}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[12.5px] font-semibold text-ink-100">
            {format.extension}
          </span>
          <span className="text-[12.5px] text-ink-500">{format.title}</span>

          {format.metered && (
            <span
              className={cn(
                'rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold tracking-wide uppercase',
                locked ? 'bg-danger-500/16 text-danger-400' : 'bg-warn-400/14 text-warn-400',
              )}
            >
              {locked ? 'Credits out' : 'Pay-per-render'}
            </span>
          )}
          {format.delivery === 'cloud' && (
            <span className="rounded-full bg-pulse-500/14 px-1.5 py-0.5 text-[9.5px] font-semibold tracking-wide text-pulse-500 uppercase">
              Cloud
            </span>
          )}
        </span>

        <span className="mt-1 block text-[12px] leading-relaxed text-ink-500">
          {format.description}
        </span>
        <span className="mt-0.5 block truncate font-mono text-[10.5px] text-ink-600">
          {format.targets}
        </span>
      </span>
    </button>
  );
}

function ExportStatus({
  status,
  progress,
  message,
  resultBytes,
  note,
  onDismiss,
}: {
  status: 'idle' | 'running' | 'done' | 'error';
  progress: number;
  message: string | null;
  resultBytes?: number;
  note?: string;
  onDismiss: () => void;
}) {
  if (status === 'idle') return null;

  if (status === 'running') {
    return (
      <div className="mt-3 rounded-2xl border border-beam-500/25 bg-beam-500/[0.06] px-3.5 py-3">
        <div className="flex items-center justify-between text-[12.5px] text-beam-400">
          <span>Preparing export…</span>
          <span className="font-mono tabular-nums">{Math.round(progress * 100)}%</span>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-obsidian-800">
          <div
            className="h-full rounded-full bg-beam-500 transition-[width] duration-200"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      </div>
    );
  }

  const failed = status === 'error';

  return (
    <div
      role="status"
      className={cn(
        'mt-3 flex items-start gap-3 rounded-2xl border px-3.5 py-3',
        failed
          ? 'border-danger-500/25 bg-danger-500/[0.07]'
          : 'border-ok-400/25 bg-ok-400/[0.07]',
      )}
    >
      <span className={cn('mt-0.5 shrink-0', failed ? 'text-danger-400' : 'text-ok-400')}>
        {failed ? <AlertIcon className="size-[18px]" /> : <CheckIcon className="size-[18px]" />}
      </span>

      <span className="min-w-0 flex-1">
        <span className={cn('block text-[13px] font-medium', failed ? 'text-danger-400' : 'text-ok-400')}>
          {message}
          {resultBytes !== undefined && !failed && (
            <span className="ml-1.5 font-mono text-[11px] text-ink-500">
              {formatBytes(resultBytes)}
            </span>
          )}
        </span>
        {note && !failed && <span className="mt-0.5 block text-[11.5px] text-ink-500">{note}</span>}
      </span>

      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="-my-1 -mr-1.5 grid size-touch shrink-0 place-items-center text-ink-600"
      >
        ✕
      </button>
    </div>
  );
}

/** Checkerboard behind the model when alpha output is armed. */
function TransparencyChecker() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-10 opacity-[0.14]"
      style={{
        backgroundImage:
          'linear-gradient(45deg,#fff 25%,transparent 25%),linear-gradient(-45deg,#fff 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#fff 75%),linear-gradient(-45deg,transparent 75%,#fff 75%)',
        backgroundSize: '18px 18px',
        backgroundPosition: '0 0,0 9px,9px -9px,-9px 0',
      }}
    />
  );
}
