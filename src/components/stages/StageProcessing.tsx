import { Viewport } from '../../three/Viewport';
import { RiggingPreview } from '../../three/RiggingPreview';
import { analyzeImage } from '../../lib/imageAnalysis';
import { useEffect, useState } from 'react';
import type { CharacterAppearance } from '../../three/characterFactory';
import { ActionBar } from '../ActionBar';
import { Button } from '../Button';
import { TrashIcon } from '../icons';
import { useStudio } from '../../state/StudioContext';
import { phaseLocalProgress } from '../../state/studioReducer';
import { cn, hashString } from '../../lib/utils';
import { PIPELINE_PHASES } from '../../types/studio';
import type { ConfirmRequest } from '../ConfirmDialog';

export function StageProcessing({ onConfirm }: { onConfirm: (request: ConfirmRequest) => void }) {
  const { state, dispatch } = useStudio();
  const { progress, phase } = state.pipeline;

  // Preview the asset the finished character will use, so the wireframe the
  // user watches assemble is the mesh they end up with. For an upload that
  // means reading the same pixels the generator reads.
  const [preview, setPreview] = useState<{ seed: number; appearance?: CharacterAppearance }>(() => ({
    seed: hashString(`prompt:${state.prompt.trim()}`),
  }));

  useEffect(() => {
    if (state.inputMode !== 'image' || !state.imageDataUrl) {
      setPreview({ seed: hashString(`prompt:${state.prompt.trim()}`) });
      return;
    }

    let cancelled = false;
    void analyzeImage(state.imageDataUrl)
      .then((analysis) => {
        if (cancelled) return;
        setPreview({
          seed: analysis.contentHash,
          appearance: {
            suit: analysis.dominant,
            accent: analysis.accent,
            shade: analysis.shade,
            lightness: analysis.lightness,
            textureDataUrl: analysis.textureDataUrl,
            mouthAnchor: analysis.mouthAnchor,
          },
        });
      })
      .catch(() => {
        // The generator surfaces the real error; the preview just stays generic.
      });

    return () => {
      cancelled = true;
    };
  }, [state.inputMode, state.imageDataUrl, state.prompt]);

  const seed = preview.seed;

  const percent = Math.round(progress * 100);
  const activeIndex = PIPELINE_PHASES.findIndex((entry) => entry.id === phase);

  const handleDiscard = () => {
    onConfirm({
      title: 'Cancel processing?',
      body:
        'Mesh reconstruction will stop and this job is dropped. Your original input is kept, so you can start over without re-uploading.',
      confirmLabel: 'Discard & start over',
      cancelLabel: 'Keep processing',
      onConfirm: () => dispatch({ type: 'cancelGeneration' }),
    });
  };

  return (
    <>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <Viewport
          className="min-h-0 flex-1"
          interactive={false}
          accent="#38e0f5"
          fit={{ focus: 0.55, padding: 1.45, elevation: 0.16, dependency: seed }}
          overlay={
            <>
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_35%,rgba(34,211,238,0.1),transparent_62%)]"
              />
              <div className="pointer-events-none absolute top-3 left-4 flex items-center gap-2 rounded-full bg-obsidian-950/65 px-3 py-1.5 backdrop-blur-sm">
                <span className="size-1.5 animate-breathe rounded-full bg-beam-400" />
                <span className="font-mono text-[10.5px] tracking-[0.14em] text-beam-400 uppercase">
                  Reconstructing
                </span>
              </div>
            </>
          }
        >
          <RiggingPreview
            seed={seed}
            progress={progress}
            phase={phase}
            appearance={preview.appearance}
          />
        </Viewport>

        <div className="shrink-0 px-4 pb-3">
          <div className="rounded-3xl border border-white/[0.07] bg-obsidian-900/85 p-4 backdrop-blur-xl">
            <div className="flex items-baseline justify-between">
              <h2 className="text-[15px] font-semibold text-ink-100">Building your asset</h2>
              <span className="font-mono text-[22px] leading-none font-semibold tabular-nums text-beam-400">
                {percent}
                <span className="text-[13px] text-ink-500">%</span>
              </span>
            </div>

            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-obsidian-800">
              <div
                className="h-full rounded-full bg-gradient-to-r from-beam-500 to-pulse-500 transition-[width] duration-200 ease-out"
                style={{ width: `${percent}%` }}
              />
            </div>

            <ol className="mt-4 space-y-2.5">
              {PIPELINE_PHASES.map((entry, index) => {
                const done = index < activeIndex || progress >= 1;
                const active = index === activeIndex && progress < 1;
                const local = active ? phaseLocalProgress(progress, entry.id) : done ? 1 : 0;

                return (
                  <li key={entry.id} className="flex items-center gap-3">
                    <span
                      className={cn(
                        'grid size-6 shrink-0 place-items-center rounded-lg text-[10px] font-semibold transition-colors',
                        done && 'bg-ok-400/15 text-ok-400',
                        active && 'bg-beam-500/18 text-beam-400',
                        !done && !active && 'bg-obsidian-800 text-ink-600',
                      )}
                    >
                      {done ? '✓' : index + 1}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span
                          className={cn(
                            'truncate text-[13.5px]',
                            active ? 'font-medium text-ink-100' : done ? 'text-ink-300' : 'text-ink-600',
                          )}
                        >
                          {entry.label}
                        </span>
                        {active && (
                          <span className="shrink-0 font-mono text-[10.5px] text-ink-500 tabular-nums">
                            {Math.round(local * 100)}%
                          </span>
                        )}
                      </span>

                      {active && (
                        <>
                          <span className="mt-0.5 block truncate text-[11.5px] text-ink-600">
                            {entry.detail}
                          </span>
                          <span className="mt-1.5 block h-0.5 overflow-hidden rounded-full bg-obsidian-800">
                            <span
                              className="block h-full rounded-full bg-beam-500/70 transition-[width] duration-200"
                              style={{ width: `${local * 100}%` }}
                            />
                          </span>
                        </>
                      )}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      </div>

      <ActionBar>
        {/* Deliberately disabled: the CTA stays visible so the layout never
            shifts between stages, and it doubles as the progress readout. */}
        <Button variant="primary" block disabled loading>
          Processing Asset ({percent}%)…
        </Button>

        <Button
          variant="destructive"
          block
          icon={<TrashIcon className="size-[17px]" />}
          onClick={handleDiscard}
        >
          Discard & Start Over
        </Button>
      </ActionBar>
    </>
  );
}
