'use client';

import { memo } from 'react';
import { Icon } from '../../icons';
import { TickerSelector } from './TickerSelector';
import { RangeSelector } from './RangeSelector';

type DateRange = '7D' | '1M' | '3M' | '6M' | '1Y' | '2Y' | '3Y' | '5Y' | 'ALL';

interface ChartHeaderProps {
  title: string;
  showTickerSelector: boolean;
  showComparisonSelector: boolean;
  selectedTicker: string;
  compareTickers: string[];
  showRangeSelector: boolean;
  selectedRange: DateRange;
  showSettings: boolean;
  /** % change over the visible range (or the active drag selection), for the top bar. */
  periodChange?: { pct: number; label: string; dragging: boolean } | null;
  onTickerChange: (ticker: string) => void;
  onRemovePrimaryTicker: () => void;
  onAddCompareTicker: (ticker: string) => void;
  onRangeChange: (range: DateRange) => void;
  onToggleSettings: () => void;
}

export const ChartHeader = memo(function ChartHeader({
  title,
  showTickerSelector,
  showComparisonSelector,
  selectedTicker,
  compareTickers,
  showRangeSelector,
  selectedRange,
  showSettings,
  periodChange,
  onTickerChange,
  onRemovePrimaryTicker,
  onAddCompareTicker,
  onRangeChange,
  onToggleSettings,
}: ChartHeaderProps) {
  // Show comparison selector if explicitly enabled OR if ticker selector is shown with a selected ticker
  const canShowComparison = (showComparisonSelector || showTickerSelector) && selectedTicker && compareTickers.length < 5;

  return (
    <div className="py-3 px-4 md:px-6 border-b border-rule-light flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-4">
        <h3 className="font-sans text-lg font-bold text-ink m-0">{title}</h3>
        {periodChange && (
          <div className="flex items-baseline gap-2" title={periodChange.dragging ? 'Selected range' : 'Visible range'}>
            <span
              className={`font-sans text-base font-bold tabular-nums ${
                periodChange.pct >= 0 ? 'text-green' : 'text-red-600'
              }`}
            >
              {periodChange.pct >= 0 ? '+' : ''}{periodChange.pct.toFixed(2)}%
            </span>
            <span className="font-sans text-[0.6875rem] text-ink-faint hidden md:inline">
              {periodChange.dragging && <span className="text-ink-light font-semibold">drag · </span>}
              {periodChange.label}
            </span>
          </div>
        )}
        {showTickerSelector && (
          <div className="flex items-center gap-2">
            <TickerSelector
              selectedTicker={selectedTicker}
              onTickerChange={onTickerChange}
              onRemove={selectedTicker ? onRemovePrimaryTicker : undefined}
              placeholder="Add ticker..."
            />
          </div>
        )}
        {canShowComparison && (
          <TickerSelector
            selectedTicker=""
            onTickerChange={onAddCompareTicker}
            placeholder="Add..."
          />
        )}
      </div>

      <div className="flex items-center gap-3">
        {showRangeSelector && selectedTicker && (
          <RangeSelector selectedRange={selectedRange} onRangeChange={onRangeChange} />
        )}
        {selectedTicker && (
          <button
            onClick={onToggleSettings}
            className={`inline-flex items-center gap-2 font-sans text-[0.8125rem] font-semibold py-2 px-4 rounded-md cursor-pointer transition-all duration-150 border ${
              showSettings
                ? 'bg-ink text-white border-ink'
                : 'bg-white text-ink-light border-rule hover:border-ink-light hover:text-ink'
            }`}
          >
            <Icon name="cog" className="w-4 h-4" />
            <span className="hidden sm:inline">{showSettings ? 'Hide Settings' : 'Show Settings'}</span>
          </button>
        )}
      </div>
    </div>
  );
});
