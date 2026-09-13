import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/utils';

type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'outline';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  /** Fills the row — the default for the bottom action bar. */
  block?: boolean;
  icon?: ReactNode;
  loading?: boolean;
}

/**
 * Every variant is min-h-12 (48px). That floor is not negotiable: it is the
 * smallest reliable thumb target on a phone, and the destructive buttons need
 * it as much as the primary ones so a mis-tap is a mis-tap, not a deletion.
 */
const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-gradient-to-r from-beam-500 to-pulse-500 text-obsidian-950 font-semibold shadow-[0_8px_28px_-8px_rgba(34,211,238,0.6)] active:from-beam-600 active:to-pulse-600',
  secondary: 'bg-obsidian-800 text-ink-100 border border-obsidian-700 active:bg-obsidian-700',
  outline: 'border border-beam-500/40 text-beam-400 bg-beam-500/5 active:bg-beam-500/12',
  ghost: 'text-ink-500 active:bg-obsidian-800/60',
  // Subtle by default, red only on intent — discard is reversible-feeling here,
  // the confirmation sheet is what carries the weight.
  destructive:
    'text-danger-400/90 border border-danger-500/22 bg-danger-500/[0.06] active:bg-danger-500/14 active:text-danger-400',
};

export function Button({
  variant = 'secondary',
  block = false,
  icon,
  loading = false,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={cn(
        'relative inline-flex min-h-touch items-center justify-center gap-2 rounded-2xl px-5 text-[15px]',
        'transition-[transform,background-color,opacity] duration-150 select-none',
        'active:scale-[0.985] disabled:pointer-events-none disabled:opacity-45',
        block && 'w-full',
        VARIANTS[variant],
        className,
      )}
      {...props}
    >
      {loading ? (
        <span
          aria-hidden
          className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      ) : (
        icon
      )}
      <span className="truncate">{children}</span>
    </button>
  );
}
