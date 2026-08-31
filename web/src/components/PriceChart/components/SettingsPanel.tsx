'use client';

import { memo } from 'react';
import { SettingsSliders } from './SettingsSliders';

type DateRange = '7D' | '1M' | '3M' | '6M' | '1Y' | '2Y' | '3Y' | '5Y' | 'ALL';

interface SettingsPanelProps {
  // Date range
  startDate: string;
  endDate: string;
  selectedRange: DateRange;
  onStartDateChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
  onPresetRangeChange: (range: DateRange) => void;
  onApplyDateRange: () => void;
  onResetDateRange: () => void;

  // Display settings
  labelSize: number;
  onLabelSizeChange: (value: number) => void;
  dotScale: number;
  onDotScaleChange: (value: number) => void;
  dotScaleMode: 'logarithmic' | 'linear';
  onToggleDotScaleMode: () => void;
  showDotScale: boolean;
  showFill: boolean;
  onToggleFill: () => void;
}

const PRESET_RANGES: DateRange[] = ['7D', '1M', '3M', '6M', '1Y', '2Y', '3Y', '5Y'];

export const SettingsPanel = memo(function SettingsPanel({
  startDate,
  endDate,
  selectedRange,
  onStartDateChange,
  onEndDateChange,
  onPresetRangeChange,
  onApplyDateRange,
  onResetDateRange,
  labelSize,
  onLabelSizeChange,
  dotScale,
  onDotScaleChange,
  dotScaleMode,
  onToggleDotScaleMode,
  showDotScale,
  showFill,
  onToggleFill,
}: SettingsPanelProps) {
  return (
    <div className="bg-white border-b border-rule-light">
      {/* Date Range Section */}
      <div className="p-5 border-b border-rule-light">
        <div className="text-[0.6875rem] font-bold uppercase tracking-wider text-ink-light mb-4">
          Date Range
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div>
            <label htmlFor="start-date" className="block text-xs font-semibold text-ink-light mb-1.5">
              Start Date
            </label>
            <input
              type="date"
              id="start-date"
              value={startDate}
              onChange={(e) => onStartDateChange(e.target.value)}
              className="w-full font-sans text-sm text-ink bg-surface-warm border border-rule-light rounded-md py-2.5 px-3 focus:outline-none focus:border-green focus:bg-white"
            />
          </div>
          <div>
            <label htmlFor="end-date" className="block text-xs font-semibold text-ink-light mb-1.5">
              End Date
            </label>
            <input
              type="date"
              id="end-date"
              value={endDate}
              onChange={(e) => onEndDateChange(e.target.value)}
              className="w-full font-sans text-sm text-ink bg-surface-warm border border-rule-light rounded-md py-2.5 px-3 focus:outline-none focus:border-green focus:bg-white"
            />
          </div>
          <div className="flex gap-2 items-end sm:col-span-2 lg:col-span-1 sm:max-w-xs">
            <button
              onClick={onApplyDateRange}
              className="flex-1 font-sans text-[0.8125rem] font-semibold py-2.5 px-4 rounded-md cursor-pointer transition-all duration-150 border-none bg-green text-white hover:bg-green-dark"
            >
              Apply
            </button>
            <button
              onClick={onResetDateRange}
              className="flex-1 font-sans text-[0.8125rem] font-semibold py-2.5 px-4 rounded-md cursor-pointer transition-all duration-150 bg-surface-warm text-ink-light border border-rule-light hover:bg-surface hover:text-ink"
            >
              Reset
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 mt-4">
          {PRESET_RANGES.map((range) => (
            <button
              key={range}
              onClick={() => onPresetRangeChange(range)}
              className={`font-sans text-xs font-semibold py-1.5 px-3.5 rounded-full border border-transparent cursor-pointer transition-all duration-150 ${
                selectedRange === range
                  ? 'bg-ink text-white'
                  : 'bg-surface-warm text-ink-light hover:bg-green-soft hover:text-green-dark'
              }`}
            >
              {range}
            </button>
          ))}
        </div>
      </div>

      {/* Display Settings Section */}
      <div className="p-5">
        <div className="text-[0.6875rem] font-bold uppercase tracking-wider text-ink-light mb-4">
          Display Settings
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Left column - Sliders */}
          <SettingsSliders
            labelSize={labelSize}
            onLabelSizeChange={onLabelSizeChange}
            dotScale={dotScale}
            onDotScaleChange={onDotScaleChange}
            dotScaleMode={dotScaleMode}
            onToggleDotScaleMode={onToggleDotScaleMode}
            showDotScale={showDotScale}
          />

          {/* Right column - Quick toggles */}
          <div className="space-y-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showFill}
                onChange={onToggleFill}
                className="w-4 h-4 accent-green"
              />
              <span className="text-sm text-ink">Show area fill</span>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
});
