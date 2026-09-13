import { STAGES, STAGE_ORDER, type StageId } from '../types/studio';
import { cn } from '../lib/utils';
import { CheckIcon } from './icons';

interface StepBarProps {
  current: StageId;
  /** Stages the user may jump back to; forward travel always goes through the CTA. */
  onNavigate?: (stage: StageId) => void;
  navigable?: StageId[];
}

/**
 * Linear four-step pipeline indicator.
 *
 * Compact by necessity — at 360px wide there is room for four numbered nodes
 * and one label, so only the active step names itself in full while the rest
 * shrink to their number.
 */
export function StepBar({ current, onNavigate, navigable = [] }: StepBarProps) {
  const currentIndex = STAGE_ORDER.indexOf(current);

  return (
    <nav aria-label="Creation pipeline" className="px-4 pt-3 pb-2.5">
      <ol className="flex items-center gap-1.5">
        {STAGES.map((stage, index) => {
          const done = index < currentIndex;
          const active = index === currentIndex;
          const canNavigate = navigable.includes(stage.id) && !active;

          return (
            <li key={stage.id} className={cn('flex items-center', active ? 'flex-1' : 'shrink-0')}>
              <button
                type="button"
                disabled={!canNavigate}
                onClick={canNavigate ? () => onNavigate?.(stage.id) : undefined}
                aria-current={active ? 'step' : undefined}
                className={cn(
                  // The pill reads better at 36px than at 48, so the visual
                  // stays small and an ::after overlay carries the touch
                  // target out to the 48px thumb floor. Tapping just above or
                  // below the pill still activates it.
                  'relative flex h-9 items-center gap-2 rounded-full px-2.5 transition-colors duration-300',
                  'after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-[""]',
                  active && 'w-full bg-gradient-to-r from-beam-500/16 to-pulse-500/10 ring-1 ring-beam-500/28',
                  !active && done && 'bg-obsidian-800/70',
                  !active && !done && 'bg-obsidian-850/50',
                  canNavigate && 'active:bg-obsidian-700',
                )}
              >
                <span
                  className={cn(
                    'grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold tabular-nums',
                    active && 'bg-gradient-to-br from-beam-400 to-pulse-500 text-obsidian-950',
                    done && !active && 'bg-beam-500/22 text-beam-400',
                    !done && !active && 'bg-obsidian-700/60 text-ink-600',
                  )}
                >
                  {done ? <CheckIcon className="size-3.5" /> : stage.index}
                </span>

                <span
                  className={cn(
                    'truncate text-[13px] font-medium transition-all',
                    active ? 'text-ink-100' : 'sr-only',
                  )}
                >
                  {stage.label}
                </span>
              </button>

              {index < STAGES.length - 1 && (
                <span
                  aria-hidden
                  className={cn(
                    'mx-1 h-px w-2.5 shrink-0 rounded-full transition-colors duration-500',
                    done ? 'bg-beam-500/55' : 'bg-obsidian-700',
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
