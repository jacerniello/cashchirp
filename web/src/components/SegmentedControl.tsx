'use client';

import { controlStyles, segItem, cn } from '@/lib/styles';

export interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
  title?: string;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  'aria-label'?: string;
}

/**
 * Dash-style pill bar control (mirrors `.co-tabs` in core/frontend/assets/app.css):
 * transparent bar, muted inactive pills, solid blue (#2563eb) fill + white text on
 * the active one. Use this for any tab/toggle/segmented bar so they read identically
 * across pages. For bespoke bars, `segItem(active)` from lib/styles gives the same look.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className,
  'aria-label': ariaLabel,
}: SegmentedControlProps<T>) {
  return (
    <div className={cn(controlStyles.bar, className)} role="tablist" aria-label={ariaLabel}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            title={opt.title}
            onClick={() => onChange(opt.value)}
            className={segItem(active)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
