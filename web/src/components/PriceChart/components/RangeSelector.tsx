'use client';

interface RangeSelectorProps {
  selectedRange: string;
  onRangeChange: (range: '7D' | '1M' | '3M' | '6M' | '1Y' | '2Y' | '3Y' | '5Y' | 'ALL') => void;
  ranges?: string[];
}

const DEFAULT_RANGES = ['7D', '1M', '3M', '6M', '1Y', '2Y', '3Y', '5Y', 'ALL'];

export function RangeSelector({
  selectedRange,
  onRangeChange,
  ranges = DEFAULT_RANGES,
}: RangeSelectorProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {ranges.map((range) => (
        <button
          key={range}
          onClick={() => onRangeChange(range as '7D' | '1M' | '3M' | '6M' | '1Y' | '2Y' | '3Y' | '5Y' | 'ALL')}
          className={`
            font-sans text-xs font-semibold py-1 px-3 rounded-full border border-transparent
            cursor-pointer transition-all duration-150
            ${
              selectedRange === range
                ? 'bg-ink text-white'
                : 'bg-surface-warm text-ink-light hover:bg-green-soft hover:text-green-dark'
            }
          `}
        >
          {range}
        </button>
      ))}
    </div>
  );
}
