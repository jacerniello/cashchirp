'use client';

import { memo } from 'react';
import { Icon } from '../../icons';

interface ComparisonBadgesProps {
  tickers: string[];
  colors: string[];
  onRemove: (ticker: string) => void;
  onSwap?: (ticker: string) => void;
}

export const ComparisonBadges = memo(function ComparisonBadges({
  tickers,
  colors,
  onRemove,
  onSwap,
}: ComparisonBadgesProps) {
  if (tickers.length === 0) return null;

  return (
    <div className="px-4 md:px-6 py-3 border-b border-rule-light flex flex-wrap items-center gap-2">
      <span className="text-xs text-ink-muted">Comparing:</span>
      {tickers.map((ticker, i) => {
        const color = colors[(i + 1) % colors.length];
        return (
          <div
            key={ticker}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold"
            style={{
              backgroundColor: `${color}20`,
              color: color,
            }}
          >
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
            {onSwap ? (
              <button
                onClick={() => onSwap(ticker)}
                className="hover:opacity-70 transition-opacity cursor-pointer"
                title="Make primary"
              >
                {ticker}
              </button>
            ) : (
              ticker
            )}
            <button
              onClick={() => onRemove(ticker)}
              className="hover:opacity-70 transition-opacity"
            >
              <Icon name="close" className="w-3 h-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
});
