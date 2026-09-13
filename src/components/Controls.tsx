import type { ReactNode } from 'react';
import { cn } from '../lib/utils';

/** Segmented tab control — the Upload / Prompt switch on stage 1. */
export function SegmentedTabs<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string; icon?: ReactNode }>;
  ariaLabel: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="grid grid-flow-col rounded-2xl bg-obsidian-850/80 p-1 ring-1 ring-white/[0.06]"
      style={{ gridAutoColumns: '1fr' }}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            role="tab"
            type="button"
            aria-selected={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex min-h-touch items-center justify-center gap-2 rounded-xl px-3 text-[14px] font-medium',
              'transition-colors duration-200',
              selected
                ? 'bg-obsidian-700 text-ink-100 shadow-[0_2px_10px_-4px_rgba(0,0,0,0.9)]'
                : 'text-ink-500 active:text-ink-300',
            )}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Pill toggle group — motion presets on stage 3. */
export function PillGroup<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string; hint?: string }>;
  ariaLabel: string;
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex min-h-touch shrink-0 flex-col items-start justify-center rounded-2xl px-4 py-2 text-left',
              'border transition-colors duration-200',
              selected
                ? 'border-beam-500/45 bg-beam-500/12 text-ink-100'
                : 'border-obsidian-700 bg-obsidian-850/70 text-ink-500 active:bg-obsidian-800',
            )}
          >
            <span className="text-[14px] font-medium">{option.label}</span>
            {option.hint && (
              <span className={cn('text-[11px]', selected ? 'text-beam-400/80' : 'text-ink-600')}>
                {option.hint}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Labelled range input with a 48px hit area despite a thin visual track. */
export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
}) {
  return (
    <label className="flex min-h-touch flex-col justify-center gap-1">
      <span className="flex items-center justify-between text-[12px] text-ink-500">
        {label}
        <span className="font-mono text-[11px] text-ink-300 tabular-nums">
          {format ? format(value) : value.toFixed(2)}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-6 w-full cursor-pointer appearance-none bg-transparent
          [&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-obsidian-700
          [&::-webkit-slider-thumb]:mt-[-7px] [&::-webkit-slider-thumb]:size-[18px] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-beam-500 [&::-webkit-slider-thumb]:shadow-[0_0_0_4px_rgba(34,211,238,0.18)]
          [&::-moz-range-track]:h-1 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-obsidian-700
          [&::-moz-range-thumb]:size-[18px] [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-beam-500"
      />
    </label>
  );
}
