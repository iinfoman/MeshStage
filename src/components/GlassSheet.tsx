import type { ReactNode } from 'react';
import { cn } from '../lib/utils';

/**
 * The frosted sheet that carries stage 3 and 4 controls.
 *
 * `backdrop-filter` over a live WebGL canvas is expensive on older iPhones, so
 * the blur is paired with a mostly-opaque tint: if the compositor drops the
 * filter the panel still reads as a solid surface rather than turning
 * transparent over the character.
 */
export function GlassSheet({
  children,
  className,
  grabber = true,
}: {
  children: ReactNode;
  className?: string;
  grabber?: boolean;
}) {
  return (
    <section
      className={cn(
        'glass relative flex min-h-0 flex-col rounded-t-sheet border-t border-white/[0.08]',
        'shadow-[0_-24px_60px_-20px_rgba(0,0,0,0.9)] animate-rise',
        className,
      )}
    >
      {grabber && (
        <div className="flex shrink-0 justify-center pt-2.5 pb-1">
          <span aria-hidden className="h-1 w-9 rounded-full bg-white/18" />
        </div>
      )}
      {children}
    </section>
  );
}

export function SheetSection({
  title,
  hint,
  children,
  action,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[11px] font-semibold tracking-[0.13em] text-ink-500 uppercase">
          {title}
        </h3>
        {action ?? (hint && <span className="text-[11px] text-ink-600">{hint}</span>)}
      </div>
      {children}
    </div>
  );
}
