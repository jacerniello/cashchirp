'use client';

import { memo } from 'react';

interface HoveredData {
  date: string;
  close: number;
  open: number;
  high: number;
  low: number;
  volume: number;
}

interface OverlayValue {
  label: string;
  value: number;
  color: string;
  format?: 'currency' | 'number';
  /** The date/period this value is from (e.g., "2024-Q1" or "2024") */
  date?: string;
}

interface ComparisonPrice {
  ticker: string;
  close: number;
  color: string;
}

interface HoverValuesHeaderProps {
  hoveredData: HoveredData | null;
  hoveredDateOnly?: string | null;  // For overlay-only charts without price data
  hoveredOverlayData?: OverlayValue[] | null;  // Overlay values at hover position
  hoveredComparisonPrices?: ComparisonPrice[] | null;  // Comparison ticker prices at hover
  hasCustomRange: boolean;
  onResetRange: () => void;
  boldOverlayValues?: boolean;  // Use semibold for overlay values (default: false)
}

function formatVolume(volume: number): string {
  if (volume >= 1_000_000) {
    return `${(volume / 1_000_000).toFixed(1)}M`;
  }
  if (volume >= 1_000) {
    return `${(volume / 1_000).toFixed(1)}K`;
  }
  return volume.toLocaleString();
}

function formatCurrency(value: number): string {
  if (Math.abs(value) >= 1_000_000_000) {
    return `$${(value / 1_000_000_000).toFixed(1)}B`;
  }
  if (Math.abs(value) >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M`;
  }
  if (Math.abs(value) >= 1_000) {
    return `$${(value / 1_000).toFixed(1)}K`;
  }
  return `$${value.toFixed(0)}`;
}

function formatNumber(value: number): string {
  if (Math.abs(value) >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(1)}B`;
  }
  if (Math.abs(value) >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (Math.abs(value) >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  // For whole numbers, don't show decimals
  if (Number.isInteger(value)) {
    return value.toString();
  }
  // For very small numbers (like EPS), use 3 decimal places
  if (Math.abs(value) < 1) {
    return value.toFixed(3);
  }
  // For small numbers < 100, use 2 decimal places
  if (Math.abs(value) < 100) {
    return value.toFixed(2);
  }
  return value.toFixed(1);
}

function formatOverlayValue(value: number, format?: 'currency' | 'number'): string {
  return format === 'number' ? formatNumber(value) : formatCurrency(value);
}

function formatPeriod(dateStr: string): string {
  // Handle quarter format: "2024-Q1" -> "Q1 2024"
  const quarterMatch = dateStr.match(/^(\d{4})-Q(\d)$/);
  if (quarterMatch) {
    return `Q${quarterMatch[2]} ${quarterMatch[1]}`;
  }
  // Handle year format: "2024" -> "2024"
  if (/^\d{4}$/.test(dateStr)) {
    return dateStr;
  }
  // Handle full date format: "2024-03-31" -> "Mar 2024"
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  }
  return dateStr;
}

export const HoverValuesHeader = memo(function HoverValuesHeader({
  hoveredData,
  hoveredDateOnly,
  hoveredOverlayData,
  hoveredComparisonPrices,
  hasCustomRange,
  onResetRange,
  boldOverlayValues = false,
}: HoverValuesHeaderProps) {
  // Determine which date to display
  const displayDate = hoveredData?.date || hoveredDateOnly;

  // Sentiment labels and colors for consistent display
  const SENTIMENT_CONFIG = {
    Positive: { color: '#22c55e', order: 0 },
    Negative: { color: '#ef4444', order: 1 },
    Neutral: { color: '#a1a1aa', order: 2 },
  };

  // Normalize overlay data to ensure consistent layout for sentiment values
  // If any sentiment label is present, show all three with "-" for missing values
  const normalizedOverlayData = (() => {
    if (!hoveredOverlayData || hoveredOverlayData.length === 0) return hoveredOverlayData;

    const sentimentLabels = Object.keys(SENTIMENT_CONFIG);
    const hasSentiment = hoveredOverlayData.some(o => sentimentLabels.includes(o.label));

    if (!hasSentiment) return hoveredOverlayData;

    // Separate sentiment and non-sentiment overlays
    const sentimentMap = new Map<string, OverlayValue>();
    const nonSentimentOverlays: OverlayValue[] = [];

    hoveredOverlayData.forEach(overlay => {
      if (sentimentLabels.includes(overlay.label)) {
        sentimentMap.set(overlay.label, overlay);
      } else {
        nonSentimentOverlays.push(overlay);
      }
    });

    // Build normalized sentiment values (always show all three)
    const normalizedSentiment: OverlayValue[] = sentimentLabels.map(label => {
      const existing = sentimentMap.get(label);
      if (existing) return existing;
      // Return placeholder with null value (will show "-")
      return {
        label,
        value: -1, // Sentinel value for "no data"
        color: SENTIMENT_CONFIG[label as keyof typeof SENTIMENT_CONFIG].color,
        format: 'number' as const,
      };
    });

    return [...nonSentimentOverlays, ...normalizedSentiment];
  })();

  // Determine if overlays should wrap to next line (3 or more)
  const overlayCount = normalizedOverlayData?.length ?? 0;
  const shouldWrapOverlays = overlayCount >= 3;

  // Render overlay values
  const renderOverlayValues = (withBorder: boolean) => (
    <div className={`flex items-center gap-3 text-xs ${withBorder ? 'border-l border-gray-300 pl-3 ml-1' : ''}`}>
      {normalizedOverlayData?.map((overlay) => (
        <span key={overlay.label} className="inline-flex items-center gap-1 whitespace-nowrap">
          <span
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: overlay.color }}
          />
          <span className="text-ink-muted">{overlay.label}:</span>
          <span className={`${boldOverlayValues ? 'font-semibold' : 'font-medium'} font-mono tabular-nums min-w-[3.5rem]`} style={{ color: overlay.color }}>
            {overlay.value === -1 ? '-' : formatOverlayValue(overlay.value, overlay.format)}
          </span>
        </span>
      ))}
    </div>
  );

  return (
    <div className={`mb-2 ${shouldWrapOverlays ? 'min-h-[48px]' : 'min-h-[28px]'}`}>
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-1">
          {hoveredData ? (
            <>
              {/* Main row: price, date, OHLCV, and overlays (if < 3) */}
              <div className="flex items-center gap-4 flex-wrap">
                <span className="text-lg font-bold text-green font-mono">
                  ${hoveredData.close.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                {/* Comparison ticker prices */}
                {hoveredComparisonPrices && hoveredComparisonPrices.length > 0 && (
                  <>
                    {hoveredComparisonPrices.map((cp) => (
                      <span key={cp.ticker} className="text-lg font-bold font-mono" style={{ color: cp.color }}>
                        ${cp.close.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    ))}
                  </>
                )}
                <span className="text-xs text-ink-muted">
                  {new Date(hoveredData.date + 'T00:00:00').toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </span>
                <div className="flex items-center gap-4 text-xs text-ink-muted">
                  <span>
                    O: <span className="text-ink font-medium">${hoveredData.open.toFixed(2)}</span>
                  </span>
                  <span>
                    H: <span className="text-[#10b981] font-medium">${hoveredData.high.toFixed(2)}</span>
                  </span>
                  <span>
                    L: <span className="text-[#ef4444] font-medium">${hoveredData.low.toFixed(2)}</span>
                  </span>
                  <span>
                    V: <span className="text-ink font-medium">{formatVolume(hoveredData.volume)}</span>
                  </span>
                </div>
                {/* Overlay values inline if < 3 */}
                {hoveredOverlayData && hoveredOverlayData.length > 0 && !shouldWrapOverlays && renderOverlayValues(true)}
              </div>
              {/* Overlay values on second row if >= 3 */}
              {hoveredOverlayData && shouldWrapOverlays && renderOverlayValues(false)}
            </>
          ) : hoveredComparisonPrices && hoveredComparisonPrices.length > 0 ? (
            <>
              {/* Comparison prices when no primary data */}
              <div className="flex items-center gap-4 flex-wrap">
                {hoveredComparisonPrices.map((cp) => (
                  <span key={cp.ticker} className="text-lg font-bold font-mono" style={{ color: cp.color }}>
                    ${cp.close.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                ))}
                {displayDate && (
                  <span className="text-xs text-ink-muted">
                    {new Date(displayDate + 'T00:00:00').toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </span>
                )}
                {/* Overlay values inline if < 3 */}
                {hoveredOverlayData && hoveredOverlayData.length > 0 && !shouldWrapOverlays && renderOverlayValues(true)}
              </div>
              {/* Overlay values on second row if >= 3 */}
              {hoveredOverlayData && shouldWrapOverlays && renderOverlayValues(false)}
            </>
          ) : displayDate ? (
            <div className="flex items-center gap-4 flex-wrap">
              <span className="text-sm font-medium text-ink">
                {new Date(displayDate + 'T00:00:00').toLocaleDateString('en-US', {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </span>
              {/* Overlay values when no price data */}
              {hoveredOverlayData && hoveredOverlayData.length > 0 && !shouldWrapOverlays && renderOverlayValues(false)}
            </div>
          ) : (
            <span className="text-xs text-ink-muted">Hover over chart to see values</span>
          )}
        </div>
        {hasCustomRange && (
          <button
            onClick={onResetRange}
            className="text-xs text-green font-medium hover:text-green-dark transition-colors flex-shrink-0"
          >
            Reset Range
          </button>
        )}
      </div>
      {/* Overlay values on second row when no price data and >= 3 overlays */}
      {!hoveredData && displayDate && hoveredOverlayData && shouldWrapOverlays && (
        <div className="mt-1">{renderOverlayValues(false)}</div>
      )}
    </div>
  );
});
