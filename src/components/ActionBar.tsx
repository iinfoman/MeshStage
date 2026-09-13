import type { ReactNode } from 'react';
import { cn } from '../lib/utils';

/**
 * Persistent bottom action bar.
 *
 * Fixed to the bottom of the viewport with a safe-area pad so the primary CTA
 * clears the iOS home indicator and Android's gesture pill. The gradient scrim
 * above it keeps the CTA legible over a bright 3D viewport.
 */
export function ActionBar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('relative z-20 shrink-0', className)}>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-8 h-8 bg-gradient-to-t from-obsidian-950 to-transparent"
      />
      <div className="safe-bottom glass border-t border-white/[0.06] px-4 pt-3">
        <div className="mx-auto flex w-full max-w-md flex-col gap-2">{children}</div>
      </div>
    </div>
  );
}
