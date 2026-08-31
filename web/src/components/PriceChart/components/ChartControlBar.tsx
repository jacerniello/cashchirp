'use client';

import { useState } from 'react';
import type { ChartMode, CursorMode, DateFormat, PriceType, ComparisonScaleMode } from '../hooks/usePriceChartSettings';

interface ChartControlBarProps {
  // Display modes
  chartMode: ChartMode;
  cursorMode: CursorMode;
  dateFormat: DateFormat;
  priceType: PriceType;

  // Visibility states
  showVolume: boolean;
  showCorporateActions: boolean;

  // Comparison settings
  comparisonScaleMode?: ComparisonScaleMode;
  hasComparisonLines?: boolean;

  // Toggle handlers
  onToggleChartMode: () => void;
  onToggleCursorMode: () => void;
  onToggleDateFormat: () => void;
  onTogglePriceType: () => void;
  onToggleVolume: () => void;
  onToggleCorporateActions: () => void;
  onToggleComparisonScaleMode?: () => void;

  // Optional: hide certain controls
  hideVolumeControl?: boolean;
  hideCorporateActionsControl?: boolean;
  hidePriceTypeControl?: boolean;

  // Tooltip settings
  pinnedTooltip?: boolean;
  onTogglePinnedTooltip?: () => void;
}

interface ToggleOptionProps {
  label: string;
  checked: boolean;
  onChange: () => void;
}

function ToggleOption({ label, checked, onChange }: ToggleOptionProps) {
  return (
    <label className="flex items-center gap-2.5 cursor-pointer py-1.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="w-4 h-4 accent-green cursor-pointer"
      />
      <span className="text-sm text-ink">{label}</span>
    </label>
  );
}

export function ChartControlBar({
  chartMode,
  cursorMode,
  dateFormat,
  priceType,
  showVolume,
  showCorporateActions,
  comparisonScaleMode,
  hasComparisonLines = false,
  onToggleChartMode,
  onToggleCursorMode,
  onToggleDateFormat,
  onTogglePriceType,
  onToggleVolume,
  onToggleCorporateActions,
  onToggleComparisonScaleMode,
  hideVolumeControl = false,
  hideCorporateActionsControl = false,
  hidePriceTypeControl = false,
  pinnedTooltip = false,
  onTogglePinnedTooltip,
}: ChartControlBarProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="border-t border-rule-light">
      {/* Header - clickable to expand/collapse */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between py-3 px-4 md:px-6 bg-surface-warm hover:bg-surface transition-colors cursor-pointer border-none text-left"
      >
        <span className="text-xs font-bold uppercase tracking-wider text-ink-light">
          Display Options
        </span>
        <svg
          className={`w-4 h-4 text-ink-light transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Collapsible content */}
      {isOpen && (
        <div className="px-4 md:px-6 py-4 bg-white border-t border-rule-light">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-8 gap-y-1">
            {/* Chart Mode */}
            <ToggleOption
              label="Show OHLC"
              checked={chartMode === 'ohlc'}
              onChange={onToggleChartMode}
            />

            {/* Cursor Mode */}
            <ToggleOption
              label="Use Dot Cursor"
              checked={cursorMode === 'dot'}
              onChange={onToggleCursorMode}
            />

            {/* Date Format */}
            <ToggleOption
              label="Show Month Only"
              checked={dateFormat === 'month'}
              onChange={onToggleDateFormat}
            />

            {/* Price Type */}
            {!hidePriceTypeControl && (
              <ToggleOption
                label="Show Actual Price"
                checked={priceType === 'actual'}
                onChange={onTogglePriceType}
              />
            )}

            {/* Volume */}
            {!hideVolumeControl && (
              <ToggleOption
                label="Show Volume"
                checked={showVolume}
                onChange={onToggleVolume}
              />
            )}

            {/* Corporate Actions */}
            {!hideCorporateActionsControl && (
              <ToggleOption
                label="Show Events"
                checked={showCorporateActions}
                onChange={onToggleCorporateActions}
              />
            )}

            {/* Comparison Scale Mode */}
            {hasComparisonLines && onToggleComparisonScaleMode && (
              <ToggleOption
                label="Use % Scale"
                checked={comparisonScaleMode === 'percentage'}
                onChange={onToggleComparisonScaleMode}
              />
            )}

            {/* Pinned Tooltip */}
            {onTogglePinnedTooltip && (
              <ToggleOption
                label="Pin Tooltip"
                checked={pinnedTooltip}
                onChange={onTogglePinnedTooltip}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
