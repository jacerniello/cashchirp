import { memo } from 'react';
import type { OverlayLine } from '../index';
import type { LineConfig } from '../hooks/useLineSettings';

interface ChartLine {
  ticker: string;
  color: string;
}

interface ChartLegendProps {
  chartLines: ChartLine[];
  overlayLines?: OverlayLine[];
  /** Display name for the primary ticker (first chartLine). If not provided, uses ticker. */
  primaryDisplayName?: string;
  /** Current per-line settings (visibility lives here). */
  lineSettings?: Map<string, LineConfig>;
  /** Toggle a line's visibility by its id (ticker for chart lines, label for overlays). */
  onToggleVisibility?: (id: string) => void;
}

export const ChartLegend = memo(function ChartLegend({
  chartLines,
  overlayLines,
  primaryDisplayName,
  lineSettings,
  onToggleVisibility,
}: ChartLegendProps) {
  if (chartLines.length <= 1 && (!overlayLines || overlayLines.length === 0)) {
    return null;
  }

  const isHidden = (id: string) => lineSettings?.get(id)?.visible === false;

  return (
    <div className="flex flex-wrap items-center gap-4 mt-4 pt-4 border-t border-rule-light">
      {chartLines.map((line, index) => {
        const label = index === 0 && primaryDisplayName ? primaryDisplayName : line.ticker;
        // The primary line (index 0) is always shown — its visibility is fixed —
        // so only comparison lines are click-to-toggle.
        const canToggle = index > 0 && !!onToggleVisibility;
        const off = isHidden(line.ticker);
        const swatch = <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: line.color }} />;
        const text = <span className={`text-xs font-semibold text-ink ${off ? 'line-through opacity-50' : ''}`}>{label}</span>;
        return canToggle ? (
          <button
            key={line.ticker}
            type="button"
            onClick={() => onToggleVisibility!(line.ticker)}
            title={off ? 'Show' : 'Hide'}
            className={`flex items-center gap-2 bg-transparent border-none cursor-pointer p-0 transition-opacity ${off ? 'opacity-60' : 'hover:opacity-70'}`}
          >
            {swatch}
            {text}
          </button>
        ) : (
          <div key={line.ticker} className="flex items-center gap-2">
            {swatch}
            {text}
          </div>
        );
      })}
      {overlayLines?.map((line) => {
        const off = isHidden(line.label);
        const swatch = (
          <span
            className={`w-3 h-0.5 shrink-0 ${line.dashed ? 'border-t-2 border-dashed' : ''}`}
            style={{
              backgroundColor: line.dashed ? 'transparent' : line.color,
              borderColor: line.color,
            }}
          />
        );
        const text = <span className={`text-xs font-semibold text-ink ${off ? 'line-through opacity-50' : ''}`}>{line.label}</span>;
        return onToggleVisibility ? (
          <button
            key={line.label}
            type="button"
            onClick={() => onToggleVisibility(line.label)}
            title={off ? 'Show' : 'Hide'}
            className={`flex items-center gap-2 bg-transparent border-none cursor-pointer p-0 transition-opacity ${off ? 'opacity-60' : 'hover:opacity-70'}`}
          >
            {swatch}
            {text}
          </button>
        ) : (
          <div key={line.label} className="flex items-center gap-2">
            {swatch}
            {text}
          </div>
        );
      })}
    </div>
  );
});
