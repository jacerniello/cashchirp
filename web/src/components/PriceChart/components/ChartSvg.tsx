'use client';

import { useMemo, useCallback, useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import type { PriceDataPoint, CorporateAction } from '../../../hooks/usePrices';
import { useChartInteraction } from '../hooks/useChartInteraction';
import { OHLCRenderer } from '../renderers/OHLCRenderer';
import { MarkerRenderer, type InsiderMarker, type FilingMarker } from '../renderers/MarkerRenderer';
import { HoverOverlay } from '../renderers/HoverOverlay';
import { DragSelectionOverlay } from '../renderers/DragSelectionOverlay';
import type { ChartMode, CursorMode, DateFormat } from '../hooks/usePriceChartSettings';


interface ChartLine {
  ticker: string;
  data: PriceDataPoint[];
  color: string;
}

interface OverlayLine {
  label: string;
  data: { date: string; value: number }[];
  color: string;
  useSecondaryAxis?: boolean;
  dashed?: boolean;
  /** Render as line (default), bar, dot, or stacked bar chart */
  renderAs?: 'line' | 'bar' | 'dot' | 'stackedBar';
  /** Group key for stacking bars together (lines with same stackGroup are stacked) */
  stackGroup?: string;
  /** Format for displaying values: 'currency' adds $ prefix (default), 'number' shows plain number */
  format?: 'currency' | 'number';
  /** Allow gaps in the line where value is 0 (default: false - line is continuous) */
  allowGaps?: boolean;
}

interface LineSettings {
  visible: boolean;
  fill: boolean;
  showDots: boolean;
  color: string;
  dashed: boolean;
}

export type ComparisonScaleMode = 'percentage' | 'independent';

/** Ref handle for ChartSvg - exposes the SVG element for export */
export interface ChartSvgRef {
  getSvgElement: () => SVGSVGElement | null;
}

interface ChartSvgProps {
  data: PriceDataPoint[];
  corporateActions?: CorporateAction[];
  width: number;
  height: number;

  // Display modes
  chartMode?: ChartMode;
  cursorMode?: CursorMode;
  dateFormat?: DateFormat;

  // Visibility toggles
  showVolume?: boolean;
  showCorporateActions?: boolean;
  showFill?: boolean;

  // Styling
  lineColor?: string;
  areaColor?: string;

  // Markers
  newsMarkers?: { date: string; count: number }[];
  insiderMarkers?: InsiderMarker[];
  filingMarkers?: FilingMarker[];
  /** Whether to show filing markers visually. Filing dates are still used for overlay positioning. */
  showFilingMarkers?: boolean;
  onInsiderMarkerClick?: (date: string, accessionNumbers: string[]) => void;
  onFilingMarkerClick?: (marker: FilingMarker) => void;

  // Dot scaling (for insider markers)
  dotScale?: number;
  dotScaleMode?: 'logarithmic' | 'linear';

  // Interaction
  onDateRangeSelect?: (startDate: string, endDate: string) => void;
  onDateClick?: (date: string) => void;
  onHoverChange?: (date: string | null) => void;
  onHoverDataChange?: (data: { date: string; close: number; open: number; high: number; low: number; volume: number } | null) => void;
  onComparisonHoverChange?: (data: { ticker: string; close: number; color: string }[] | null) => void;
  onOverlayHoverChange?: (data: { label: string; value: number; color: string; format?: 'currency' | 'number'; date?: string }[] | null) => void;
  /** Fires with the live drag-selection date span (during a drag and its confirm), null otherwise. */
  onDragSelectionChange?: (selection: { startDate: string; endDate: string } | null) => void;

  // Additional lines
  additionalLines?: ChartLine[];
  overlayLines?: OverlayLine[];

  // Visible date range - used to set the x-axis scale consistently
  // When provided, this takes precedence over calculating the range from data points
  visibleDateRange?: { startDate: string; endDate: string } | null;

  // Comparison scale mode: 'percentage' normalizes all lines, 'independent' uses own scale
  comparisonScaleMode?: ComparisonScaleMode;

  // Tooltip settings
  pinnedTooltip?: boolean;

  // Line settings from useLineSettings hook
  lineSettings?: Map<string, LineSettings>;

  // When true, don't clear hover state on mouse leave
  isHoverLocked?: boolean;

  // Date to highlight with a vertical line (e.g., when filtering to a single date)
  highlightDate?: string;
}

export const ChartSvg = forwardRef<ChartSvgRef, ChartSvgProps>(function ChartSvg({
  data,
  corporateActions = [],
  width,
  height,
  chartMode = 'line',
  cursorMode = 'crosshair',
  dateFormat = 'full',
  showVolume = true,
  showCorporateActions = true,
  showFill = false,
  lineColor = 'var(--color-ink)',
  areaColor = 'var(--color-ink)',
  newsMarkers,
  insiderMarkers,
  filingMarkers,
  showFilingMarkers = true,
  onInsiderMarkerClick,
  onFilingMarkerClick,
  dotScale = 1.0,
  dotScaleMode = 'logarithmic',
  onDateRangeSelect,
  onDateClick,
  onHoverChange,
  onHoverDataChange,
  onComparisonHoverChange,
  onOverlayHoverChange,
  onDragSelectionChange,
  additionalLines = [],
  overlayLines = [],
  visibleDateRange,
  comparisonScaleMode = 'percentage',
  pinnedTooltip = false,
  lineSettings,
  isHoverLocked = false,
  highlightDate,
}, ref) {
  const svgRef = useRef<SVGSVGElement>(null);

  // Expose SVG element through ref
  useImperativeHandle(ref, () => ({
    getSvgElement: () => svgRef.current,
  }), []);

  // Calculate chart data and layout
  const chartData = useMemo(() => {
    const hasOverlayData = overlayLines && overlayLines.length > 0 && overlayLines.some(l => l.data && l.data.length > 0);
    const hasComparisonData = additionalLines && additionalLines.length > 0 && additionalLines.some(l => l.data && l.data.length > 0);

    // Return null only if we have no price data, no overlay data, AND no comparison data
    if ((!data || data.length === 0) && !hasOverlayData && !hasComparisonData) return null;

    const padding = { top: 20, right: 20, bottom: showVolume ? 60 : 40, left: 60 };
    const volumeHeight = showVolume ? 35 : 0;
    const priceChartHeight = height - padding.top - padding.bottom - volumeHeight;
    const chartWidth = width - padding.left - padding.right;

    // Handle overlay-only mode (no price data)
    const hasPriceData = data && data.length > 0;

    // Pre-compute date-to-index lookup for efficient overlay alignment
    // This avoids O(n*m) search when aligning overlay dates to price dates
    const priceDateToIndex = new Map<string, number>();
    const priceDateTimestamps: { ts: number; index: number }[] = [];
    if (hasPriceData) {
      data.forEach((point, index) => {
        priceDateToIndex.set(point.date, index);
        priceDateTimestamps.push({
          ts: new Date(point.date + 'T00:00:00').getTime(),
          index,
        });
      });
    }

    // Helper to find the closest price index for a given date (uses binary search for performance)
    const findClosestPriceIndex = (targetTs: number): number => {
      if (priceDateTimestamps.length === 0) return 0;

      // Binary search for closest timestamp
      let left = 0;
      let right = priceDateTimestamps.length - 1;

      while (left < right) {
        const mid = Math.floor((left + right) / 2);
        if (priceDateTimestamps[mid].ts < targetTs) {
          left = mid + 1;
        } else {
          right = mid;
        }
      }

      // Check if left or left-1 is closer
      if (left > 0) {
        const leftDiff = Math.abs(priceDateTimestamps[left].ts - targetTs);
        const prevDiff = Math.abs(priceDateTimestamps[left - 1].ts - targetTs);
        if (prevDiff < leftDiff) {
          return priceDateTimestamps[left - 1].index;
        }
      }
      return priceDateTimestamps[left].index;
    };

    // Calculate global date range FIRST - this determines the x-axis for ALL lines
    // When visibleDateRange is provided, use it for consistent positioning during pan/zoom
    // Otherwise fall back to calculating from data points
    let globalMinDateMs: number;
    let globalMaxDateMs: number;

    if (visibleDateRange) {
      // Use the provided visible date range for consistent x-axis positioning
      globalMinDateMs = new Date(visibleDateRange.startDate + 'T00:00:00').getTime();
      globalMaxDateMs = new Date(visibleDateRange.endDate + 'T00:00:00').getTime();
    } else {
      // Fall back to calculating from data points
      const allGlobalDates: number[] = [];

      // From primary price data
      if (data.length > 0) {
        data.forEach((d) => {
          allGlobalDates.push(new Date(d.date + 'T00:00:00').getTime());
        });
      }

      // From comparison lines
      additionalLines.forEach((line) => {
        if (line.data && line.data.length > 0) {
          line.data.forEach((d) => {
            allGlobalDates.push(new Date(d.date + 'T00:00:00').getTime());
          });
        }
      });

      // From overlay lines (need to parse special date formats)
      overlayLines.forEach((overlay) => {
        if (overlay.data) {
          overlay.data.forEach((point) => {
            const quarterMatch = point.date.match(/^(\d{4})-Q(\d)$/);
            if (quarterMatch) {
              const year = parseInt(quarterMatch[1]);
              const quarter = parseInt(quarterMatch[2]);
              const endMonth = quarter * 3 - 1;
              const lastDay = new Date(year, endMonth + 1, 0).getDate();
              allGlobalDates.push(new Date(year, endMonth, lastDay).getTime());
            } else {
              const yearMatch = point.date.match(/^(\d{4})$/);
              if (yearMatch) {
                allGlobalDates.push(new Date(parseInt(yearMatch[1]), 11, 31).getTime());
              } else {
                allGlobalDates.push(new Date(point.date + 'T00:00:00').getTime());
              }
            }
          });
        }
      });

      if (allGlobalDates.length > 0) {
        globalMinDateMs = Math.min(...allGlobalDates);
        globalMaxDateMs = Math.max(...allGlobalDates);
      } else {
        globalMinDateMs = 0;
        globalMaxDateMs = 1;
      }
    }
    const globalDateRangeMs = globalMaxDateMs - globalMinDateMs || 1;

    // Helper to get x position from date (date-based positioning)
    const getXFromDate = (dateStr: string): number => {
      const dateMs = new Date(dateStr + 'T00:00:00').getTime();
      const dateRatio = (dateMs - globalMinDateMs) / globalDateRangeMs;
      return padding.left + dateRatio * chartWidth;
    };

    // Now calculate price data using DATE-BASED positioning (not index-based)
    // This ensures price line is positioned correctly within the global date range
    let closes: number[] = [];
    let minPrice = 0;
    let maxPrice = 100;
    let priceRange = 100;
    let pricePadding = 10;
    let volumes: number[] = [];
    let maxVolume = 1;
    let points: any[] = [];

    if (hasPriceData) {
      closes = data.map((d) => d.close);
      minPrice = Math.min(...closes);
      maxPrice = Math.max(...closes);
      priceRange = maxPrice - minPrice || 1;
      pricePadding = priceRange * 0.1;

      volumes = data.map((d) => d.volume);
      maxVolume = Math.max(...volumes, 1);

      // Map data points to pixel coordinates using DATE-BASED x positioning
      points = data.map((point, index) => {
        const x = getXFromDate(point.date);  // Use date-based positioning, not index-based
        const y =
          padding.top +
          priceChartHeight -
          ((point.close - (minPrice - pricePadding)) / (priceRange + pricePadding * 2)) * priceChartHeight;
        const volumeY =
          height - padding.bottom + 10 + volumeHeight - (point.volume / maxVolume) * volumeHeight;
        return { x, y, volumeY, index, ...point };
      });
    }

    // Process additional lines (stock comparisons)
    // When comparisonScaleMode is 'percentage', normalize comparison lines to percentage change
    // Overlay lines (holdings, etc.) are always scaled independently to fit the chart
    const hasAdditionalLines = additionalLines.length > 0;
    const usePercentageScale = hasAdditionalLines && comparisonScaleMode === 'percentage';

    // If we have additional comparison lines and using percentage mode, normalize them
    let normalizedPrimaryPoints = points;
    let percentMinValue = 0;
    let percentMaxValue = 0;

    if (usePercentageScale && data.length > 0) {
      const basePrice = data[0].close;
      const percentChanges = data.map((d) => ((d.close - basePrice) / basePrice) * 100);
      const allPercentChanges = [...percentChanges];

      // Calculate percent changes for all additional comparison lines
      additionalLines.forEach((line) => {
        if (line.data && line.data.length > 0) {
          const lineBase = line.data[0].close;
          line.data.forEach((d) => {
            allPercentChanges.push(((d.close - lineBase) / lineBase) * 100);
          });
        }
      });

      const minPercent = Math.min(...allPercentChanges);
      const maxPercent = Math.max(...allPercentChanges);
      const percentRange = maxPercent - minPercent || 1;
      const percentPadding = percentRange * 0.1;

      // Store for Y-axis labels
      percentMinValue = minPercent - percentPadding;
      percentMaxValue = maxPercent + percentPadding;

      // Re-map primary points using combined percentage scale (still date-based x)
      normalizedPrimaryPoints = data.map((point, index) => {
        const percentChange = ((point.close - basePrice) / basePrice) * 100;
        const x = getXFromDate(point.date);  // Use date-based positioning
        const y =
          padding.top +
          priceChartHeight -
          ((percentChange - (minPercent - percentPadding)) / (percentRange + percentPadding * 2)) * priceChartHeight;
        const volumeY =
          height - padding.bottom + 10 + volumeHeight - (point.volume / maxVolume) * volumeHeight;
        return { x, y, volumeY, index, ...point };
      });
    }

    const additionalLinePaths = additionalLines
      .filter((line) => line.data && line.data.length > 0)
      .map((line) => {
        let linePoints;

        if (usePercentageScale) {
          // Percentage mode: normalize to combined percentage scale
          const lineBase = line.data[0].close;
          const primaryBase = data.length > 0 ? data[0].close : 1;
          const primaryPercentChanges = data.map((d) => ((d.close - primaryBase) / primaryBase) * 100);

          // Get all percent changes for combined scale
          const allPercentChanges = [...primaryPercentChanges];
          additionalLines.forEach((l) => {
            if (l.data && l.data.length > 0) {
              const base = l.data[0].close;
              l.data.forEach((d) => {
                allPercentChanges.push(((d.close - base) / base) * 100);
              });
            }
          });

          const minPercent = Math.min(...allPercentChanges);
          const maxPercent = Math.max(...allPercentChanges);
          const percentRange = maxPercent - minPercent || 1;
          const percentPadding = percentRange * 0.1;

          linePoints = line.data.map((point) => {
            const percentChange = ((point.close - lineBase) / lineBase) * 100;
            const x = getXFromDate(point.date);
            const y =
              padding.top +
              priceChartHeight -
              ((percentChange - (minPercent - percentPadding)) / (percentRange + percentPadding * 2)) *
                priceChartHeight;
            return { x, y, date: point.date, close: point.close };
          });
        } else {
          // Independent mode: each line uses its own scale
          const lineCloses = line.data.map((d) => d.close);
          const lineMinPrice = Math.min(...lineCloses);
          const lineMaxPrice = Math.max(...lineCloses);
          const linePriceRange = lineMaxPrice - lineMinPrice || 1;
          const linePricePadding = linePriceRange * 0.1;

          linePoints = line.data.map((point) => {
            const x = getXFromDate(point.date);
            const y =
              padding.top +
              priceChartHeight -
              ((point.close - (lineMinPrice - linePricePadding)) / (linePriceRange + linePricePadding * 2)) *
                priceChartHeight;
            return { x, y, date: point.date, close: point.close };
          });
        }

        const path = linePoints.length > 0 ? `M ${linePoints.map((p) => `${p.x},${p.y}`).join(' L ')}` : '';

        return { ticker: line.ticker, path, color: line.color, points: linePoints };
      });

    // Process overlay lines with independent scaling
    // Each overlay line is scaled to fit the chart based on its own min/max values

    // Helper to parse dates including quarter and year-only formats
    // If filing markers are available, use the actual filing date for alignment
    const parseOverlayDate = (dateStr: string): number => {
      // First, check if we have a filing marker for this period - use the filing date if available
      // This aligns overlay data with the filing markers on the chart
      if (filingMarkers && filingMarkers.length > 0) {
        let matchingMarker = filingMarkers.find(m => m.periodLabel === dateStr);

        // Special case: Q4 data is reported in the 10-K, not a separate 10-Q
        // So for "2024-Q4", look for the "2024" 10-K filing
        if (!matchingMarker) {
          const q4Match = dateStr.match(/^(\d{4})-Q4$/);
          if (q4Match) {
            const year = q4Match[1];
            matchingMarker = filingMarkers.find(m => m.periodLabel === year && m.formType.includes('10-K'));
          }
        }

        if (matchingMarker) {
          return new Date(matchingMarker.date + 'T00:00:00').getTime();
        }
      }

      // Fallback to period end date calculations when no filing marker exists
      // Handle quarter format: "2024-Q1"
      const quarterMatch = dateStr.match(/^(\d{4})-Q(\d)$/);
      if (quarterMatch) {
        const year = parseInt(quarterMatch[1]);
        const quarter = parseInt(quarterMatch[2]);
        // Map quarter to period END date: Q1->Mar 31, Q2->Jun 30, Q3->Sep 30, Q4->Dec 31
        const endMonth = quarter * 3 - 1; // 0-indexed: Q1->2 (Mar), Q2->5 (Jun), Q3->8 (Sep), Q4->11 (Dec)
        const lastDay = new Date(year, endMonth + 1, 0).getDate(); // Get last day of month
        return new Date(year, endMonth, lastDay).getTime();
      }
      // Handle year-only format: "2024" (for annual data, use fiscal year end = Dec 31)
      const yearMatch = dateStr.match(/^(\d{4})$/);
      if (yearMatch) {
        const year = parseInt(yearMatch[1]);
        return new Date(year, 11, 31).getTime(); // December 31
      }
      return new Date(dateStr + 'T00:00:00').getTime();
    };

    // Get the visible date range for filtering overlay points
    // Use visibleDateRange when provided for consistent clipping, otherwise fall back to data bounds
    let primaryStartDate: number;
    let primaryEndDate: number;

    if (visibleDateRange) {
      // Use the provided visible date range for consistent clipping
      primaryStartDate = new Date(visibleDateRange.startDate + 'T00:00:00').getTime();
      primaryEndDate = new Date(visibleDateRange.endDate + 'T00:00:00').getTime();
    } else {
      // Fall back to collecting dates from ALL sources
      const allDatesForRange: number[] = [];

      // From primary price data
      if (hasPriceData) {
        data.forEach((p) => {
          allDatesForRange.push(new Date(p.date + 'T00:00:00').getTime());
        });
      }

      // From comparison lines
      additionalLines.forEach((line) => {
        if (line.data && line.data.length > 0) {
          line.data.forEach((p) => {
            allDatesForRange.push(new Date(p.date + 'T00:00:00').getTime());
          });
        }
      });

      // From overlay lines
      overlayLines.forEach((overlay) => {
        if (overlay.data) {
          overlay.data.forEach((point) => {
            allDatesForRange.push(parseOverlayDate(point.date));
          });
        }
      });

      if (allDatesForRange.length > 0) {
        primaryStartDate = Math.min(...allDatesForRange);
        primaryEndDate = Math.max(...allDatesForRange);
      } else {
        primaryStartDate = 0;
        primaryEndDate = 1;
      }
    }
    const primaryDateRange = primaryEndDate - primaryStartDate || 1;

    // Separate line overlays from bar/dot overlays
    const lineOverlays = overlayLines.filter((o) => o.renderAs !== 'stackedBar' && o.renderAs !== 'bar' && o.renderAs !== 'dot' && o.data && o.data.length > 0);
    const barOverlays = overlayLines.filter((o) => o.renderAs === 'bar' && o.data && o.data.length > 0);
    const dotOverlays = overlayLines.filter((o) => o.renderAs === 'dot' && o.data && o.data.length > 0);
    const stackedBarOverlays = overlayLines.filter((o) => o.renderAs === 'stackedBar' && o.data && o.data.length > 0);

    // Process line overlays
    const overlayLinePaths = lineOverlays.map((overlay) => {
        // Use ALL data for Y-axis scaling to show full range
        const allValues = overlay.data.map((d) => d.value).filter((v) => v != null && !isNaN(v));
        if (allValues.length === 0) {
          return {
            label: overlay.label,
            path: '',
            color: overlay.color,
            dashed: overlay.dashed || false,
            points: [],
            format: overlay.format,
          };
        }

        const minValue = Math.min(...allValues);
        const maxValue = Math.max(...allValues);
        const valueRange = maxValue - minValue || Math.abs(maxValue) * 0.1 || 1;
        const valuePadding = valueRange * 0.1;

        // Sort overlay data by date for processing
        const sortedData = [...overlay.data].sort((a, b) =>
          parseOverlayDate(a.date) - parseOverlayDate(b.date)
        );

        // Find points within visible range, plus edge points for line extension
        const visiblePoints: typeof overlay.data = [];
        let beforePoint: typeof overlay.data[0] | null = null;
        let afterPoint: typeof overlay.data[0] | null = null;

        for (const point of sortedData) {
          const pointDate = parseOverlayDate(point.date);
          if (pointDate < primaryStartDate) {
            beforePoint = point; // Keep updating to get closest before
          } else if (pointDate > primaryEndDate) {
            if (!afterPoint) afterPoint = point; // First point after
          } else {
            visiblePoints.push(point);
          }
        }

        // If no visible points but we have before/after, we still want to draw through
        if (visiblePoints.length === 0 && !beforePoint && !afterPoint) {
          return {
            label: overlay.label,
            path: '',
            color: overlay.color,
            dashed: overlay.dashed || false,
            points: [],
            format: overlay.format,
          };
        }

        // Helper to calculate y position
        const calcY = (value: number) =>
          padding.top +
          priceChartHeight -
          ((value - (minValue - valuePadding)) / (valueRange + valuePadding * 2)) * priceChartHeight;

        // Helper to get x position for a date - uses global date range for consistent positioning
        const getXForDate = (dateStr: string) => {
          const pointDate = parseOverlayDate(dateStr);
          // Always use global date range for x positioning (not price data indices)
          const dateProgress = (pointDate - globalMinDateMs) / globalDateRangeMs;
          return padding.left + dateProgress * chartWidth;
        };

        // Helper to interpolate a point at a specific x position between two points
        const interpolateAtX = (p1: { date: string; value: number }, p2: { date: string; value: number }, targetX: number) => {
          const x1 = getXForDate(p1.date);
          const x2 = getXForDate(p2.date);
          const ratio = (targetX - x1) / (x2 - x1);
          const interpolatedValue = p1.value + ratio * (p2.value - p1.value);
          return { x: targetX, y: calcY(interpolatedValue), date: '', value: interpolatedValue };
        };

        const overlayPoints: { x: number; y: number; date: string; value: number }[] = [];

        // Add interpolated start point if line extends from before visible range
        // Skip edge interpolation for allowGaps since it creates false connections across gaps
        if (!overlay.allowGaps) {
          if (beforePoint && visiblePoints.length > 0) {
            const edgePoint = interpolateAtX(beforePoint, visiblePoints[0], padding.left);
            overlayPoints.push(edgePoint);
          } else if (beforePoint && afterPoint && visiblePoints.length === 0) {
            // Line passes through visible area without any points in it
            const edgePoint = interpolateAtX(beforePoint, afterPoint, padding.left);
            overlayPoints.push(edgePoint);
          }
        }

        // Add visible points
        for (const point of visiblePoints) {
          const x = getXForDate(point.date);
          overlayPoints.push({ x, y: calcY(point.value), date: point.date, value: point.value });
        }

        // Add interpolated end point if line extends beyond visible range
        // Skip edge interpolation for allowGaps since it creates false connections across gaps
        if (!overlay.allowGaps) {
          if (afterPoint && visiblePoints.length > 0) {
            const lastVisible = visiblePoints[visiblePoints.length - 1];
            const edgePoint = interpolateAtX(lastVisible, afterPoint, padding.left + chartWidth);
            overlayPoints.push(edgePoint);
          } else if (beforePoint && afterPoint && visiblePoints.length === 0) {
            // Line passes through visible area without any points in it
            const edgePoint = interpolateAtX(beforePoint, afterPoint, padding.left + chartWidth);
            overlayPoints.push(edgePoint);
          }
        }

        // Sort by x position
        overlayPoints.sort((a, b) => a.x - b.x);

        // Build path - with gaps if allowGaps is true
        let path = '';
        let singlePoints: typeof overlayPoints = [];
        if (overlayPoints.length > 0) {
          if (overlay.allowGaps) {
            // Split into segments at zero values OR date gaps (more than 1 day between points)
            const segments: typeof overlayPoints[] = [];
            let currentSegment: typeof overlayPoints = [];
            let lastDate: number | null = null;
            const ONE_DAY_MS = 24 * 60 * 60 * 1000;
            const GAP_THRESHOLD_MS = ONE_DAY_MS * 1.5; // 1.5 days to account for weekends/slight variations

            for (const point of overlayPoints) {
              // Check for zero value
              if (point.value === 0) {
                if (currentSegment.length > 0) {
                  segments.push(currentSegment);
                  currentSegment = [];
                }
                lastDate = null;
                continue;
              }

              // Check for date gap (only for points with actual dates, not interpolated points)
              if (point.date) {
                const pointDate = parseOverlayDate(point.date);
                if (lastDate !== null && pointDate - lastDate > GAP_THRESHOLD_MS) {
                  // Date gap detected - start new segment
                  if (currentSegment.length > 0) {
                    segments.push(currentSegment);
                    currentSegment = [];
                  }
                }
                lastDate = pointDate;
              }

              currentSegment.push(point);
            }
            if (currentSegment.length > 0) {
              segments.push(currentSegment);
            }
            // Separate single points (render as dots) from multi-point segments (render as lines)
            const lineSegments = segments.filter(seg => seg.length > 1);
            singlePoints = segments.filter(seg => seg.length === 1).map(seg => seg[0]);

            // Build path with separate M commands for each segment
            path = lineSegments
              .map(seg => `M ${seg.map((p) => `${p.x},${p.y}`).join(' L ')}`)
              .join(' ');
          } else {
            path = `M ${overlayPoints.map((p) => `${p.x},${p.y}`).join(' L ')}`;
          }
        }

        // Generate area path for fill (only for continuous lines)
        const areaPath = overlayPoints.length > 0 && !overlay.allowGaps
          ? `M ${overlayPoints[0].x},${padding.top + priceChartHeight} ` +
            overlayPoints.map((p) => `L ${p.x},${p.y}`).join(' ') +
            ` L ${overlayPoints[overlayPoints.length - 1].x},${padding.top + priceChartHeight} Z`
          : '';

        return {
          label: overlay.label,
          path,
          areaPath,
          color: overlay.color,
          dashed: overlay.dashed || false,
          points: overlayPoints,
          format: overlay.format,
          singlePoints,
        };
      });

    // Process simple bar overlays (grouped side-by-side per date)
    type SimpleBar = { date: string; x: number; y: number; height: number; value: number; label: string; color: string; groupIndex: number; isNegative: boolean };
    type BarGroup = { date: string; centerX: number; bars: SimpleBar[] };
    const barGroups: BarGroup[] = [];
    let simpleBarMinValue = 0;
    let simpleBarMaxValue = 0;
    const numBarSeries = barOverlays.length;

    if (barOverlays.length > 0) {
      // Get min and max values across all bar overlays for consistent scaling
      barOverlays.forEach((overlay) => {
        overlay.data.forEach((point) => {
          if (point.value > simpleBarMaxValue) simpleBarMaxValue = point.value;
          if (point.value < simpleBarMinValue) simpleBarMinValue = point.value;
        });
      });

      const valueRange = simpleBarMaxValue - simpleBarMinValue || Math.abs(simpleBarMaxValue) || 1;
      const valuePadding = valueRange * 0.1;
      const totalRange = valueRange + valuePadding * 2;

      // Calculate zero baseline position (where y=0 should be drawn)
      // If all positive: baseline at bottom; if all negative: baseline at top; if mixed: proportional
      const zeroY = padding.top + priceChartHeight * ((simpleBarMaxValue + valuePadding) / totalRange);

      // Collect all unique dates and group bars by date
      const dateToGroup = new Map<string, BarGroup>();

      barOverlays.forEach((overlay, overlayIndex) => {
        overlay.data.forEach((point) => {
          const pointDate = parseOverlayDate(point.date);
          if (pointDate < primaryStartDate || pointDate > primaryEndDate) return;

          // Calculate x position - use global date range for consistent positioning
          const dateProgress = (pointDate - globalMinDateMs) / globalDateRangeMs;
          const centerX = padding.left + Math.max(0, Math.min(1, dateProgress)) * chartWidth;

          const heightRatio = Math.abs(point.value) / totalRange;
          const barHeight = heightRatio * priceChartHeight;
          const isNegative = point.value < 0;
          // Positive bars go up from zero line, negative bars go down
          const y = isNegative ? zeroY : zeroY - barHeight;

          if (!dateToGroup.has(point.date)) {
            dateToGroup.set(point.date, { date: point.date, centerX, bars: [] });
          }

          dateToGroup.get(point.date)!.bars.push({
            date: point.date,
            x: centerX, // Will be adjusted later
            y,
            height: barHeight,
            value: point.value,
            label: overlay.label,
            color: overlay.color,
            groupIndex: overlayIndex,
            isNegative,
          });
        });
      });

      // Convert to array and sort by date
      barGroups.push(...dateToGroup.values());
      barGroups.sort((a, b) => parseOverlayDate(a.date) - parseOverlayDate(b.date));
    }

    // Calculate bar width - each bar in a group gets its own width (thin bars centered on date)
    const uniqueDates = barGroups.length;
    const groupWidth = uniqueDates > 0 ? Math.min(20, Math.max(6, chartWidth / uniqueDates * 0.3)) : 0;
    const singleBarWidth = numBarSeries > 0 ? Math.max(3, groupWidth / numBarSeries - 1) : 0;

    // Adjust x positions for side-by-side layout
    barGroups.forEach((group) => {
      const totalGroupWidth = group.bars.length * singleBarWidth + (group.bars.length - 1) * 2; // 2px gap
      const startX = group.centerX - totalGroupWidth / 2;
      group.bars.forEach((bar, idx) => {
        bar.x = startX + idx * (singleBarWidth + 2) + singleBarWidth / 2;
      });
    });

    // Flatten for backward compatibility
    const simpleBars = barGroups.flatMap((g) => g.bars);
    const simpleBarWidth = singleBarWidth;

    // Process dot overlays - these will be rendered on the price line
    type SimpleDot = { date: string; x: number; value: number; label: string; color: string };
    const simpleDots: SimpleDot[] = [];

    if (dotOverlays.length > 0) {
      dotOverlays.forEach((overlay) => {
        overlay.data.forEach((point) => {
          const pointDate = parseOverlayDate(point.date);
          if (pointDate < primaryStartDate || pointDate > primaryEndDate) return;

          // Calculate x position - use global date range for consistent positioning
          const dateProgress = (pointDate - globalMinDateMs) / globalDateRangeMs;
          const centerX = padding.left + Math.max(0, Math.min(1, dateProgress)) * chartWidth;

          simpleDots.push({
            date: point.date,
            x: centerX,
            value: point.value,
            label: overlay.label,
            color: overlay.color,
          });
        });
      });
    }

    // Process stacked bar overlays
    // Group by stackGroup, then by date
    type StackedBarSegment = { label: string; color: string; value: number; y: number; height: number };
    type StackedBar = { date: string; dateRangeStart?: string; dateRangeEnd?: string; x: number; segments: StackedBarSegment[]; totalValue: number };
    const stackedBars: StackedBar[] = [];
    let stackedBarMaxValue = 0;

    if (stackedBarOverlays.length > 0) {
      // Collect all unique dates across all stacked overlays
      const dateMap = new Map<string, Map<string, number>>(); // date -> (label -> value)
      stackedBarOverlays.forEach((overlay) => {
        overlay.data.forEach((point) => {
          if (!dateMap.has(point.date)) {
            dateMap.set(point.date, new Map());
          }
          dateMap.get(point.date)!.set(overlay.label, point.value);
        });
      });

      // Filter to visible date range first
      const visibleDates: string[] = [];
      dateMap.forEach((_, date) => {
        const pointDate = parseOverlayDate(date);
        if (pointDate >= primaryStartDate && pointDate <= primaryEndDate) {
          visibleDates.push(date);
        }
      });
      visibleDates.sort((a, b) => parseOverlayDate(a) - parseOverlayDate(b));

      // Aggregate bars if too many for performance (max ~150 bars)
      const MAX_BARS = 150;
      let aggregatedDateMap = dateMap;

      // Track date ranges for aggregated buckets
      const dateRangeMap = new Map<string, { start: string; end: string }>();

      if (visibleDates.length > MAX_BARS) {
        const bucketSize = Math.ceil(visibleDates.length / MAX_BARS);
        aggregatedDateMap = new Map();

        for (let i = 0; i < visibleDates.length; i += bucketSize) {
          const bucketDates = visibleDates.slice(i, i + bucketSize);
          // Use middle date of bucket as representative
          const midDate = bucketDates[Math.floor(bucketDates.length / 2)];
          const aggregatedValues = new Map<string, number>();

          bucketDates.forEach((date) => {
            const values = dateMap.get(date);
            if (values) {
              values.forEach((value, label) => {
                aggregatedValues.set(label, (aggregatedValues.get(label) || 0) + value);
              });
            }
          });

          aggregatedDateMap.set(midDate, aggregatedValues);
          // Store the date range for this bucket
          if (bucketDates.length > 1) {
            dateRangeMap.set(midDate, { start: bucketDates[0], end: bucketDates[bucketDates.length - 1] });
          }
        }
      }

      // Calculate max total for scaling (use aggregated data)
      let maxTotal = 0;
      aggregatedDateMap.forEach((labelValues) => {
        let total = 0;
        labelValues.forEach((v) => { total += v; });
        if (total > maxTotal) maxTotal = total;
      });
      stackedBarMaxValue = maxTotal;

      const valueRange = maxTotal || 1;
      const valuePadding = valueRange * 0.1;
      const baselineY = padding.top + priceChartHeight;

      // Build stacked bars from aggregated data
      // When price data is available, align bars to nearest price point's x position
      // Use global date range for consistent positioning across all data sources
      aggregatedDateMap.forEach((labelValues, date) => {
        const pointDate = parseOverlayDate(date);
        if (pointDate < primaryStartDate || pointDate > primaryEndDate) return;

        // Use global date range for x positioning (not price data indices)
        const dateProgress = (pointDate - globalMinDateMs) / globalDateRangeMs;
        const x = padding.left + Math.max(0, Math.min(1, dateProgress)) * chartWidth;

        const segments: StackedBarSegment[] = [];
        let cumulativeY = baselineY;
        let totalValue = 0;

        // Stack in order of overlays
        stackedBarOverlays.forEach((overlay) => {
          const value = labelValues.get(overlay.label) || 0;
          if (value > 0) {
            const heightRatio = value / (valueRange + valuePadding * 2);
            const segmentHeight = heightRatio * priceChartHeight;
            const y = cumulativeY - segmentHeight;

            segments.push({
              label: overlay.label,
              color: overlay.color,
              value,
              y,
              height: segmentHeight,
            });

            cumulativeY = y;
            totalValue += value;
          }
        });

        if (segments.length > 0) {
          const range = dateRangeMap.get(date);
          stackedBars.push({
            date,
            dateRangeStart: range?.start,
            dateRangeEnd: range?.end,
            x,
            segments,
            totalValue,
          });
        }
      });

      // Sort by date
      stackedBars.sort((a, b) => parseOverlayDate(a.date) - parseOverlayDate(b.date));
    }

    // Calculate bar width for stacked bars
    const stackedBarWidth = stackedBars.length > 0
      ? Math.min(12, Math.max(2, chartWidth / stackedBars.length * 0.7))
      : 0;

    // Use normalized points when using percentage scale mode
    const finalPoints = usePercentageScale ? normalizedPrimaryPoints : points;
    const finalLinePath =
      finalPoints.length > 0 ? `M ${finalPoints.map((p) => `${p.x},${p.y}`).join(' L ')}` : '';
    const finalAreaPath =
      finalPoints.length > 0
        ? `M ${padding.left},${padding.top + priceChartHeight} ` +
          finalPoints.map((p) => `L ${p.x},${p.y}`).join(' ') +
          ` L ${padding.left + chartWidth},${padding.top + priceChartHeight} Z`
        : '';

    // Generate x-axis labels - ALWAYS based on global date range, not individual data sources
    // This ensures labels span the full chart range regardless of which data sources have data
    // Use fewer labels on narrow charts to prevent overlap
    let xAxisLabels: { x: number; date: string }[] = [];
    const labelCount = chartWidth < 300 ? 2 : chartWidth < 450 ? 3 : 5;

    // Generate evenly-spaced dates across the global date range
    if (globalDateRangeMs > 0) {
      let targetRatios: number[];
      if (labelCount === 2) {
        targetRatios = [0, 1];
      } else if (labelCount === 3) {
        targetRatios = [0, 0.5, 1];
      } else {
        targetRatios = [0, 0.25, 0.5, 0.75, 1];
      }

      xAxisLabels = targetRatios.map((ratio) => {
        const dateMs = globalMinDateMs + ratio * globalDateRangeMs;
        const date = new Date(dateMs);
        const dateStr = date.toISOString().split('T')[0]; // Format as YYYY-MM-DD
        const x = padding.left + ratio * chartWidth;
        return { x, date: dateStr };
      });
    }

    // Calculate highlight x position if a highlight date is specified
    const highlightX = highlightDate ? getXFromDate(highlightDate) : null;

    return {
      points: finalPoints,
      linePath: finalLinePath,
      areaPath: finalAreaPath,
      minPrice: minPrice - pricePadding,
      maxPrice: maxPrice + pricePadding,
      maxVolume,
      padding,
      chartWidth,
      priceChartHeight,
      volumeHeight,
      additionalLinePaths,
      overlayLinePaths,
      stackedBars,
      stackedBarWidth,
      stackedBarMaxValue,
      simpleBars,
      simpleBarWidth,
      simpleBarMaxValue,
      simpleDots,
      isComparisonMode: hasAdditionalLines,
      usePercentageScale,
      percentMinValue,
      percentMaxValue,
      xAxisLabels,
      hasPriceData,
      highlightX,
    };
  }, [data, width, height, showVolume, additionalLines, overlayLines, visibleDateRange, comparisonScaleMode, filingMarkers, highlightDate]);

  // Memoize interaction points to avoid recreating array on every render
  // Merge ALL dates from all data sources (price, comparison, overlay, stacked bars) so user can hover any date
  const interactionPoints = useMemo(() => {
    if (!chartData) return [];

    // Collect all unique dates and their x/y positions from all data sources
    const dateMap = new Map<string, { x: number; y: number; date: string; dateRangeStart?: string; dateRangeEnd?: string }>();

    // From primary price data
    if (chartData.points && chartData.points.length > 0) {
      chartData.points.forEach((p) => {
        dateMap.set(p.date, { x: p.x, y: p.y, date: p.date });
      });
    }

    // From comparison lines
    if (chartData.additionalLinePaths && chartData.additionalLinePaths.length > 0) {
      chartData.additionalLinePaths.forEach((line) => {
        if (line.points) {
          line.points.forEach((p) => {
            if (!dateMap.has(p.date)) {
              dateMap.set(p.date, { x: p.x, y: p.y, date: p.date });
            }
          });
        }
      });
    }

    // From overlay lines
    if (chartData.overlayLinePaths && chartData.overlayLinePaths.length > 0) {
      chartData.overlayLinePaths.forEach((overlay) => {
        if (overlay.points) {
          overlay.points.forEach((p) => {
            if (p.date && !dateMap.has(p.date)) {
              dateMap.set(p.date, { x: p.x, y: p.y, date: p.date });
            }
          });
        }
      });
    }

    // From stacked bars
    if (chartData.stackedBars && chartData.stackedBars.length > 0) {
      chartData.stackedBars.forEach((b) => {
        if (!dateMap.has(b.date)) {
          dateMap.set(b.date, {
            x: b.x,
            y: chartData.padding.top + chartData.priceChartHeight / 2,
            date: b.date,
            dateRangeStart: b.dateRangeStart,
            dateRangeEnd: b.dateRangeEnd,
          });
        }
      });
    }

    // Convert to array, sort by date, and add index
    const points = Array.from(dateMap.values())
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .map((p, index) => ({ ...p, index }));

    return points;
  }, [chartData]);

  // Use chart interaction hook
  const interaction = useChartInteraction({
    points: interactionPoints,
    chartWidth: chartData?.chartWidth || 0,
    paddingLeft: chartData?.padding.left || 60,
    onDateRangeSelect,
    onDateClick,
    isHoverLocked,
  });

  // Format functions
  const formatPrice = useCallback((price: number) => {
    if (price >= 1000) return `$${(price / 1000).toFixed(1)}K`;
    if (price >= 1) return `$${price.toFixed(0)}`;
    return `$${price.toFixed(2)}`;
  }, []);

  const formatDate = useCallback(
    (dateStr: string) => {
      const date = new Date(dateStr + 'T00:00:00');
      if (dateFormat === 'month') {
        return date.toLocaleDateString('en-US', { month: 'short' });
      }
      // Default: show month and full year like Django (e.g., "Jan 2024")
      return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    },
    [dateFormat]
  );

  // Get hovered point - use interaction.hoveredPoint directly for x/y/date positioning
  // Then look up price data by DATE (not index) since interactionPoints is a merged array
  // Use "at or before" logic so weekends show the previous trading day's price
  let hoveredPoint: { x: number; y: number; date: string; close?: number; open?: number; high?: number; low?: number; volume?: number } | null = null;
  if (chartData && interaction.hoveredPoint) {
    const { x, y, date } = interaction.hoveredPoint;

    // Look up price data by exact date first
    let pricePoint = chartData.points.find((p) => p.date === date);

    // If no exact match (e.g., weekend), find the latest price at or before this date
    if (!pricePoint && chartData.points.length > 0) {
      const hoveredTime = new Date(date + 'T00:00:00').getTime();
      for (const p of chartData.points) {
        const pTime = new Date(p.date + 'T00:00:00').getTime();
        if (pTime <= hoveredTime) {
          pricePoint = p;
        } else {
          break; // Points are sorted, stop once we pass hovered date
        }
      }
    }

    if (pricePoint) {
      hoveredPoint = { x, y: pricePoint.y, date, close: pricePoint.close, open: pricePoint.open, high: pricePoint.high, low: pricePoint.low, volume: pricePoint.volume };
    } else {
      // No price data at or before this date - use interaction point position
      hoveredPoint = { x, y, date };
    }
  }
  // Find corporate action at hovered point, with snapping to nearby markers
  const hoveredAction = useMemo(() => {
    if (!hoveredPoint || !chartData) return undefined;

    // First check for exact date match
    const exactMatch = corporateActions.find((a) => a.date === hoveredPoint.date);
    if (exactMatch) return exactMatch;

    // If no exact match, check if cursor is near any corporate action marker (within ~25px)
    const SNAP_THRESHOLD = 25;
    let closestAction: CorporateAction | undefined;
    let closestDistance = Infinity;

    for (const action of corporateActions) {
      // Find the point for this action's date
      const actionPoint = chartData.points.find((p) => p.date === action.date);
      if (!actionPoint) continue;

      const distance = Math.abs(actionPoint.x - hoveredPoint.x);
      if (distance < SNAP_THRESHOLD && distance < closestDistance) {
        closestDistance = distance;
        closestAction = action;
      }
    }

    return closestAction;
  }, [hoveredPoint, chartData, corporateActions]);

  // Notify parent of hover changes for live value updates
  // Use primitive values in deps to avoid infinite loops
  const hoveredDate = hoveredPoint?.date ?? null;
  const hoveredClose = hoveredPoint?.close;
  const hoveredOpen = hoveredPoint?.open;
  const hoveredHigh = hoveredPoint?.high;
  const hoveredLow = hoveredPoint?.low;
  const hoveredVolume = hoveredPoint?.volume;

  useEffect(() => {
    onHoverChange?.(hoveredDate);
    if (hoveredDate && hoveredClose !== undefined) {
      onHoverDataChange?.({
        date: hoveredDate,
        close: hoveredClose,
        open: hoveredOpen!,
        high: hoveredHigh!,
        low: hoveredLow!,
        volume: hoveredVolume!,
      });
    } else {
      onHoverDataChange?.(null);
    }
  }, [hoveredDate, hoveredClose, hoveredOpen, hoveredHigh, hoveredLow, hoveredVolume, onHoverChange, onHoverDataChange]);

  // Compute overlay points for hover notification - must be before early return to keep hooks stable
  // This is a simplified version that handles the null chartData case
  const overlayPointsForEffect = useMemo(() => {
    if (!chartData || !hoveredPoint) return [];

    const linePoints: { label: string; value: number; color: string; format?: 'currency' | 'number'; date?: string }[] = [];

    // Get overlay line points at hover position
    chartData.overlayLinePaths.forEach((overlay) => {
      if (overlay.points.length === 0) return;
      let closestPoint = overlay.points[0];
      let closestDiff = Infinity;
      for (const point of overlay.points) {
        const diff = Math.abs(point.x - hoveredPoint.x);
        if (diff < closestDiff) {
          closestDiff = diff;
          closestPoint = point;
        }
      }
      if (closestPoint && closestDiff < 50) {
        linePoints.push({
          label: overlay.label,
          value: closestPoint.value,
          color: overlay.color,
          format: overlay.format,
          date: closestPoint.date,
        });
      }
    });

    // Get bar overlay points at hover position
    if (chartData.simpleBars && chartData.simpleBars.length > 0) {
      const barsByDate = new Map<string, typeof chartData.simpleBars>();
      for (const bar of chartData.simpleBars) {
        if (!barsByDate.has(bar.date)) barsByDate.set(bar.date, []);
        barsByDate.get(bar.date)!.push(bar);
      }

      let closestBars: typeof chartData.simpleBars = [];
      let closestDiff = Infinity;
      for (const [, bars] of barsByDate) {
        if (bars.length > 0) {
          const centerX = bars.reduce((sum, b) => sum + b.x, 0) / bars.length;
          const diff = Math.abs(centerX - hoveredPoint.x);
          if (diff < closestDiff) {
            closestDiff = diff;
            closestBars = bars;
          }
        }
      }

      if (closestDiff <= 50) {
        closestBars.forEach((bar) => {
          linePoints.push({
            label: bar.label,
            value: bar.value,
            color: bar.color,
            format: undefined,
            date: bar.date,
          });
        });
      }
    }

    // Get dot overlay points at hover position - get ALL dots at the closest date
    if (chartData.simpleDots && chartData.simpleDots.length > 0) {
      // Group dots by date
      const dotsByDate = new Map<string, typeof chartData.simpleDots>();
      for (const dot of chartData.simpleDots) {
        if (!dotsByDate.has(dot.date)) dotsByDate.set(dot.date, []);
        dotsByDate.get(dot.date)!.push(dot);
      }

      // Find closest date group
      let closestDots: typeof chartData.simpleDots = [];
      let closestDiff = Infinity;
      for (const [, dots] of dotsByDate) {
        if (dots.length > 0) {
          const diff = Math.abs(dots[0].x - hoveredPoint.x);
          if (diff < closestDiff) {
            closestDiff = diff;
            closestDots = dots;
          }
        }
      }

      if (closestDiff <= 50) {
        closestDots.forEach((dot) => {
          linePoints.push({
            label: dot.label,
            value: dot.value,
            color: dot.color,
            format: undefined,
            date: dot.date,
          });
        });
      }
    }

    // Get stacked bar values at hover position
    if (chartData.stackedBars && chartData.stackedBars.length > 0) {
      let closestBar: typeof chartData.stackedBars[0] | null = null;
      let closestDiff = Infinity;
      for (const bar of chartData.stackedBars) {
        const diff = Math.abs(bar.x - hoveredPoint.x);
        if (diff < closestDiff) {
          closestDiff = diff;
          closestBar = bar;
        }
      }

      if (closestBar && closestDiff <= 50) {
        closestBar.segments.forEach((segment) => {
          linePoints.push({
            label: segment.label,
            value: segment.value,
            color: segment.color,
            format: 'number',
            date: closestBar!.date,
          });
        });
      }
    }

    return linePoints;
  }, [chartData, hoveredPoint]);

  // Notify parent of overlay values at hover position - must be before early return
  // Use overlayPointsKey to stabilize dependency (avoid re-running when array reference changes)
  const overlayPointsKey = overlayPointsForEffect.map((p) => `${p.label}:${p.value}`).join('|');
  useEffect(() => {
    if (overlayPointsForEffect.length > 0) {
      onOverlayHoverChange?.(overlayPointsForEffect);
    } else {
      onOverlayHoverChange?.(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlayPointsKey, onOverlayHoverChange]);

  // Compute comparison prices at hover position - must be before early return
  const comparisonPricesForEffect = useMemo(() => {
    if (!chartData || !hoveredPoint || chartData.additionalLinePaths.length === 0) return [];

    const prices: { ticker: string; close: number; color: string }[] = [];

    chartData.additionalLinePaths.forEach((line) => {
      if (line.points.length === 0) return;
      // Find closest point by x position
      let closestPoint = line.points[0];
      let closestDiff = Infinity;
      for (const pt of line.points) {
        const diff = Math.abs(pt.x - hoveredPoint.x);
        if (diff < closestDiff) {
          closestDiff = diff;
          closestPoint = pt;
        }
      }
      if (closestPoint && closestDiff < 50) {
        prices.push({
          ticker: line.ticker,
          close: closestPoint.close,
          color: line.color,
        });
      }
    });

    return prices;
  }, [chartData, hoveredPoint]);

  // Notify parent of comparison prices at hover position - must be before early return
  const comparisonPricesKey = comparisonPricesForEffect.map((p) => `${p.ticker}:${p.close}`).join('|');
  useEffect(() => {
    if (comparisonPricesForEffect.length > 0) {
      onComparisonHoverChange?.(comparisonPricesForEffect);
    } else {
      onComparisonHoverChange?.(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comparisonPricesKey, onComparisonHoverChange]);

  // Surface the live drag selection (date span) to the parent so the top bar can show
  // the % change over the dragged window. Fires during the drag and while the confirm
  // popup is up; clears (null) when the selection is committed or cancelled.
  const dragSelStart = interaction.dragSelection?.startDate ?? null;
  const dragSelEnd = interaction.dragSelection?.endDate ?? null;
  useEffect(() => {
    onDragSelectionChange?.(
      dragSelStart && dragSelEnd ? { startDate: dragSelStart, endDate: dragSelEnd } : null
    );
  }, [dragSelStart, dragSelEnd, onDragSelectionChange]);

  // Return null only if we have no price data AND no comparison lines AND no overlay lines AND no stacked bars
  if (!chartData || (chartData.points.length === 0 && chartData.additionalLinePaths.length === 0 && chartData.overlayLinePaths.length === 0 && (!chartData.stackedBars || chartData.stackedBars.length === 0))) {
    return null;
  }

  // Get additional line points at hover position - find point at or before hovered date
  const additionalLinePoints = hoveredPoint
    ? chartData.additionalLinePaths
        .map((line) => {
          if (!line.points || line.points.length === 0) return null;

          // Find point by exact date match first
          let point = line.points.find((p) => p.date === hoveredPoint.date);

          // If no exact match, find the latest point at or before hovered date
          if (!point) {
            const hoveredTime = new Date(hoveredPoint.date + 'T00:00:00').getTime();
            for (const p of line.points) {
              const pTime = new Date(p.date + 'T00:00:00').getTime();
              if (pTime <= hoveredTime) {
                point = p;
              } else {
                break; // Points are sorted, stop once we pass hovered date
              }
            }
            // If hovered date is before all points, use first point
            if (!point) {
              point = line.points[0];
            }
          }

          return { ticker: line.ticker, x: point.x, y: point.y, color: line.color, close: point.close };
        })
        .filter((p): p is NonNullable<typeof p> => p !== null)
    : [];

  // Get overlay line points at hover position
  // Use hoveredPoint.x to find closest overlay point (overlay data may be sparse e.g. quarterly)
  const overlayLinePoints = hoveredPoint
    ? chartData.overlayLinePaths
        .map((overlay) => {
          if (overlay.points.length === 0) return null;
          let closestPoint = overlay.points[0];
          let closestDiff = Infinity;
          for (const pt of overlay.points) {
            const diff = Math.abs(pt.x - hoveredPoint.x);
            if (diff < closestDiff) {
              closestDiff = diff;
              closestPoint = pt;
            }
          }
          if (!closestPoint) return null;
          // Always show the closest overlay point regardless of distance (data may be sparse)
          // Position the dot at the hovered x position but at the interpolated y position for better UX
          return { label: overlay.label, x: hoveredPoint.x, y: closestPoint.y, color: overlay.color, value: closestPoint.value, date: closestPoint.date, format: overlay.format };
        })
        .filter((p): p is NonNullable<typeof p> => p !== null)
    : [];

  // Get bar overlay points at hover position (find closest bar group by x position)
  const barOverlayPoints = hoveredPoint && chartData.simpleBars && chartData.simpleBars.length > 0
    ? (() => {
        // Find the closest bar group by x position
        let closestBars: typeof chartData.simpleBars = [];
        let closestDiff = Infinity;

        // Group bars by date to find all bars at the closest date
        const barsByDate = new Map<string, typeof chartData.simpleBars>();
        for (const bar of chartData.simpleBars) {
          if (!barsByDate.has(bar.date)) barsByDate.set(bar.date, []);
          barsByDate.get(bar.date)!.push(bar);
        }

        // Find the date with bars closest to hover position
        for (const [, bars] of barsByDate) {
          if (bars.length > 0) {
            const centerX = bars.reduce((sum, b) => sum + b.x, 0) / bars.length;
            const diff = Math.abs(centerX - hoveredPoint.x);
            if (diff < closestDiff) {
              closestDiff = diff;
              closestBars = bars;
            }
          }
        }

        // Only show if within reasonable distance (50px)
        if (closestDiff > 50) return [];

        return closestBars.map((bar) => ({
          label: bar.label,
          x: bar.x,
          y: bar.y,
          color: bar.color,
          value: bar.value,
          date: bar.date,
          format: undefined,
        }));
      })()
    : [];

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      className={`block select-none ${onDateRangeSelect ? 'cursor-crosshair' : 'cursor-default'}`}
      onMouseMove={interaction.handleMouseMove}
      onMouseDown={interaction.handleMouseDown}
      onMouseUp={interaction.handleMouseUp}
      onMouseLeave={interaction.handleMouseLeave}
    >
      {/* SVG Filters */}
      <defs>
        <filter id="dot-shadow" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="1" stdDeviation="1.5" floodColor="rgba(0,0,0,0.12)" />
        </filter>
        <filter id="dot-shadow-hover" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="2" stdDeviation="2.5" floodColor="rgba(0,0,0,0.18)" />
        </filter>
      </defs>

      {/* Y-axis labels - show for price data or stacked bars */}
      {chartData.hasPriceData && (
        <>
          <text x={chartData.padding.left - 8} y={chartData.padding.top + 4} textAnchor="end" className="fill-ink-light text-[11px] font-medium">
            {chartData.usePercentageScale
              ? `${chartData.percentMaxValue >= 0 ? '+' : ''}${chartData.percentMaxValue.toFixed(0)}%`
              : formatPrice(chartData.maxPrice)}
          </text>
          <text
            x={chartData.padding.left - 8}
            y={chartData.padding.top + chartData.priceChartHeight / 2 + 4}
            textAnchor="end"
            className="fill-ink-light text-[11px] font-medium"
          >
            {chartData.usePercentageScale
              ? `${(chartData.percentMaxValue + chartData.percentMinValue) / 2 >= 0 ? '+' : ''}${((chartData.percentMaxValue + chartData.percentMinValue) / 2).toFixed(0)}%`
              : formatPrice((chartData.maxPrice + chartData.minPrice) / 2)}
          </text>
          <text
            x={chartData.padding.left - 8}
            y={chartData.padding.top + chartData.priceChartHeight}
            textAnchor="end"
            className="fill-ink-light text-[11px] font-medium"
          >
            {chartData.usePercentageScale
              ? `${chartData.percentMinValue >= 0 ? '+' : ''}${chartData.percentMinValue.toFixed(0)}%`
              : formatPrice(chartData.minPrice)}
          </text>
        </>
      )}
      {/* Y-axis labels for stacked bars (when no price data) */}
      {!chartData.hasPriceData && chartData.stackedBars && chartData.stackedBars.length > 0 && chartData.stackedBarMaxValue > 0 && (
        <>
          <text x={chartData.padding.left - 8} y={chartData.padding.top + 4} textAnchor="end" className="fill-ink-light text-[11px] font-medium">
            {chartData.stackedBarMaxValue.toLocaleString()}
          </text>
          <text
            x={chartData.padding.left - 8}
            y={chartData.padding.top + chartData.priceChartHeight / 2 + 4}
            textAnchor="end"
            className="fill-ink-light text-[11px] font-medium"
          >
            {Math.round(chartData.stackedBarMaxValue / 2).toLocaleString()}
          </text>
          <text
            x={chartData.padding.left - 8}
            y={chartData.padding.top + chartData.priceChartHeight}
            textAnchor="end"
            className="fill-ink-light text-[11px] font-medium"
          >
            0
          </text>
        </>
      )}

      {/* X-axis labels - 5 evenly spaced labels */}
      {chartData.xAxisLabels.length > 0 &&
        chartData.xAxisLabels.map((label, i) => {
          const textAnchor = i === 0 ? 'start' : i === chartData.xAxisLabels.length - 1 ? 'end' : 'middle';
          return (
            <text
              key={`x-label-${i}`}
              x={label.x}
              y={chartData.padding.top + chartData.priceChartHeight + 16}
              textAnchor={textAnchor}
              className="fill-ink-light text-[11px] font-medium"
            >
              {formatDate(label.date)}
            </text>
          );
        })}

      {/* Grid lines */}
      <line
        x1={chartData.padding.left}
        y1={chartData.padding.top}
        x2={chartData.padding.left + chartData.chartWidth}
        y2={chartData.padding.top}
        stroke="var(--color-rule)"
        strokeDasharray="4 4"
        strokeOpacity={0.5}
      />
      <line
        x1={chartData.padding.left}
        y1={chartData.padding.top + chartData.priceChartHeight / 2}
        x2={chartData.padding.left + chartData.chartWidth}
        y2={chartData.padding.top + chartData.priceChartHeight / 2}
        stroke="var(--color-rule)"
        strokeDasharray="4 4"
        strokeOpacity={0.5}
      />
      <line
        x1={chartData.padding.left}
        y1={chartData.padding.top + chartData.priceChartHeight}
        x2={chartData.padding.left + chartData.chartWidth}
        y2={chartData.padding.top + chartData.priceChartHeight}
        stroke="var(--color-rule)"
      />

      {/* Highlight line for single-date filter */}
      {chartData.highlightX !== null && highlightDate && (
        <>
          <line
            x1={chartData.highlightX}
            y1={chartData.padding.top}
            x2={chartData.highlightX}
            y2={chartData.padding.top + chartData.priceChartHeight}
            stroke="#8b5cf6"
            strokeWidth={2}
            strokeDasharray="4 4"
          />
          <rect
            x={chartData.highlightX - 45}
            y={chartData.padding.top - 20}
            width={90}
            height={18}
            rx={4}
            fill="#8b5cf6"
          />
          <text
            x={chartData.highlightX}
            y={chartData.padding.top - 8}
            textAnchor="middle"
            className="fill-white text-[10px] font-semibold"
          >
            {highlightDate}
          </text>
        </>
      )}

      {/* Area fill (line mode only) - only when we have price data */}
      {chartData.hasPriceData && showFill && chartMode === 'line' && <path d={chartData.areaPath} fill={areaColor} opacity={0.1} />}

      {/* Main chart - Line or OHLC - only when we have price data */}
      {chartData.hasPriceData && (chartMode === 'line' ? (
        <path d={chartData.linePath} fill="none" stroke={lineColor} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <OHLCRenderer
          data={data}
          padding={chartData.padding}
          chartWidth={chartData.chartWidth}
          priceChartHeight={chartData.priceChartHeight}
          minPrice={chartData.minPrice}
          maxPrice={chartData.maxPrice}
        />
        )
      )}

      {/* Additional comparison lines */}
      {chartData.additionalLinePaths.map((line) => {
        // Find the point at or before the hovered date (don't jump ahead to future dates)
        let closestPoint: { x: number; y: number; date: string } | null = null;
        if (hoveredPoint && line.points && line.points.length > 0) {
          const hoveredTime = new Date(hoveredPoint.date + 'T00:00:00').getTime();

          // Find the latest point that is at or before the hovered date
          for (const pt of line.points) {
            const ptTime = new Date(pt.date + 'T00:00:00').getTime();
            if (ptTime <= hoveredTime) {
              closestPoint = pt;
            } else {
              // Points are sorted by date, so we can stop once we pass the hovered date
              break;
            }
          }

          // If hovered date is before all points, use the first point
          if (!closestPoint && line.points.length > 0) {
            closestPoint = line.points[0];
          }
        }

        return (
          <g key={line.ticker}>
            <path d={line.path} fill="none" stroke={line.color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
            {/* Hover dot */}
            {closestPoint && (
              <circle
                cx={closestPoint.x}
                cy={closestPoint.y}
                r={7}
                fill={line.color}
                stroke="white"
                strokeWidth={2}
                filter="url(#dot-shadow-hover)"
                style={{ transition: 'cx 0.05s ease-out, cy 0.05s ease-out' }}
              />
            )}
          </g>
        );
      })}

      {/* Overlay lines */}
      {chartData.overlayLinePaths.map((overlay) => {
        const settings = lineSettings?.get(overlay.label);
        const showFill = settings?.fill ?? false;
        const showDots = settings?.showDots ?? false;
        const lineColor = settings?.color ?? overlay.color;
        const isDashed = settings?.dashed ?? overlay.dashed;

        // Find the closest point to hover position for popping effect
        let closestIdx = -1;
        if (hoveredPoint && overlay.points.length > 0) {
          let closestDiff = Infinity;
          overlay.points.forEach((pt, idx) => {
            const diff = Math.abs(pt.x - hoveredPoint.x);
            if (diff < closestDiff && diff < 50) {
              closestDiff = diff;
              closestIdx = idx;
            }
          });
        }

        return (
          <g key={overlay.label}>
            {/* Fill area */}
            {showFill && overlay.areaPath && (
              <path
                d={overlay.areaPath}
                fill={lineColor}
                fillOpacity={0.15}
                stroke="none"
              />
            )}
            {/* Line */}
            <path
              d={overlay.path}
              fill="none"
              stroke={lineColor}
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={isDashed ? '6 3' : undefined}
            />
            {/* Single isolated points rendered as pronounced dots */}
            {overlay.singlePoints && overlay.singlePoints.map((point, idx) => (
              <circle
                key={`single-${idx}`}
                cx={point.x}
                cy={point.y}
                r={5}
                fill={lineColor}
                stroke="white"
                strokeWidth={2}
              />
            ))}
            {/* Dots with popping effect on hover */}
            {overlay.points.map((point, idx) => {
              const isHovered = idx === closestIdx;
              const baseRadius = showDots ? 4 : 0;
              const hoverRadius = 7;
              const radius = isHovered ? hoverRadius : baseRadius;

              // Always show dot when hovered, otherwise respect showDots setting
              if (!isHovered && !showDots) return null;

              return (
                <circle
                  key={idx}
                  cx={point.x}
                  cy={point.y}
                  r={radius}
                  fill={lineColor}
                  stroke="white"
                  strokeWidth={isHovered ? 2 : 1.5}
                  filter={isHovered ? 'url(#dot-shadow-hover)' : undefined}
                  style={{ transition: 'r 0.15s ease-out, stroke-width 0.15s ease-out' }}
                />
              );
            })}
          </g>
        );
      })}

      {/* Stacked bar chart */}
      {chartData.stackedBars && chartData.stackedBars.length > 0 && (
        <g>
          {chartData.stackedBars.map((bar) => (
            <g key={bar.date}>
              {bar.segments.map((segment) => (
                <rect
                  key={`${bar.date}-${segment.label}`}
                  x={bar.x - chartData.stackedBarWidth / 2}
                  y={segment.y}
                  width={chartData.stackedBarWidth}
                  height={segment.height}
                  fill={segment.color}
                  opacity={hoveredPoint?.date === bar.date ? 0.9 : 0.7}
                  rx={1}
                />
              ))}
            </g>
          ))}
        </g>
      )}

      {/* Filing markers (rendered before bars so they appear behind) */}
      <MarkerRenderer
        points={chartData.points.map((p) => ({ x: p.x, y: p.y, date: p.date }))}
        priceChartHeight={chartData.priceChartHeight}
        paddingTop={chartData.padding.top}
        corporateActions={corporateActions}
        showCorporateActions={showCorporateActions}
        insiderMarkers={insiderMarkers}
        onInsiderMarkerClick={onInsiderMarkerClick}
        dotScale={dotScale}
        dotScaleMode={dotScaleMode}
        newsMarkers={newsMarkers}
        filingMarkers={filingMarkers}
        showFilingMarkers={showFilingMarkers}
        onFilingMarkerClick={onFilingMarkerClick}
        hoveredX={hoveredPoint?.x ?? null}
        activeFilingDate={(() => {
          // Get the overlay date being hovered
          const overlayDate = barOverlayPoints.length > 0 ? barOverlayPoints[0].date : overlayLinePoints.length > 0 ? overlayLinePoints[0].date : null;
          if (!overlayDate) return null;
          // Q4 data is reported in the 10-K, so map "2024-Q4" to "2024" for marker highlighting
          const q4Match = overlayDate.match(/^(\d{4})-Q4$/);
          if (q4Match) return q4Match[1];
          return overlayDate;
        })()}
      />

      {/* Simple bar chart (fundamentals overlay) */}
      {chartData.simpleBars && chartData.simpleBars.length > 0 && (() => {
        // Find the closest bar date to hover position
        let closestBarDate: string | null = null;
        if (hoveredPoint) {
          let closestDiff = Infinity;
          const barsByDate = new Map<string, typeof chartData.simpleBars>();
          for (const bar of chartData.simpleBars) {
            if (!barsByDate.has(bar.date)) barsByDate.set(bar.date, []);
            barsByDate.get(bar.date)!.push(bar);
          }
          for (const [date, bars] of barsByDate) {
            if (bars.length > 0) {
              const centerX = bars.reduce((sum, b) => sum + b.x, 0) / bars.length;
              const diff = Math.abs(centerX - hoveredPoint.x);
              if (diff < closestDiff && diff < 50) {
                closestDiff = diff;
                closestBarDate = date;
              }
            }
          }
        }

        return (
          <g>
            {chartData.simpleBars.map((bar) => {
              const isHovered = bar.date === closestBarDate;
              const isDimmed = closestBarDate !== null && !isHovered;
              return (
                <rect
                  key={`${bar.date}-${bar.label}`}
                  x={bar.x - chartData.simpleBarWidth / 2}
                  y={bar.y}
                  width={chartData.simpleBarWidth}
                  height={bar.height}
                  fill={bar.color}
                  opacity={isHovered ? 0.9 : isDimmed ? 0.3 : 0.6}
                  rx={2}
                  style={{ transition: 'opacity 0.1s ease-out' }}
                >
                  <title>{`${bar.label}: ${bar.value.toLocaleString()} (${bar.date})`}</title>
                </rect>
              );
            })}
          </g>
        );
      })()}

      {/* Simple dot chart (fundamentals overlay) - always show text labels, bigger on hover */}
      {chartData.simpleDots && chartData.simpleDots.length > 0 && chartData.points.length > 0 && (() => {
        // Group dots by date for combined rendering
        const dotsByDate = new Map<string, typeof chartData.simpleDots>();
        chartData.simpleDots.forEach((dot) => {
          if (!dotsByDate.has(dot.date)) dotsByDate.set(dot.date, []);
          dotsByDate.get(dot.date)!.push(dot);
        });

        // Find the closest dot group to hover position
        let closestDate: string | null = null;
        if (hoveredPoint) {
          let closestDiff = Infinity;
          for (const [date, dots] of dotsByDate) {
            if (dots.length > 0) {
              const diff = Math.abs(dots[0].x - hoveredPoint.x);
              if (diff < closestDiff && diff < 50) {
                closestDiff = diff;
                closestDate = date;
              }
            }
          }
        }

        // Format value compactly for label
        const formatValue = (v: number) => {
          if (Math.abs(v) >= 1e12) return `${(v / 1e12).toFixed(1)}T`;
          if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
          if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
          if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
          // For very small values like EPS, show 3 decimal places
          if (Math.abs(v) < 1) return v.toFixed(3);
          if (Math.abs(v) < 100) return v.toFixed(2);
          return v.toFixed(1);
        };

        // Generate pie slice path for segmented dot
        const getPieSlicePath = (cx: number, cy: number, r: number, startAngle: number, endAngle: number) => {
          const start = {
            x: cx + r * Math.cos(startAngle),
            y: cy + r * Math.sin(startAngle),
          };
          const end = {
            x: cx + r * Math.cos(endAngle),
            y: cy + r * Math.sin(endAngle),
          };
          const largeArcFlag = endAngle - startAngle > Math.PI ? 1 : 0;
          return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} 1 ${end.x} ${end.y} Z`;
        };

        // Sort entries so hovered group renders last (on top)
        const sortedEntries = Array.from(dotsByDate.entries()).sort(([dateA], [dateB]) => {
          if (dateA === closestDate) return 1;
          if (dateB === closestDate) return -1;
          return 0;
        });

        return (
          <g>
            {sortedEntries.map(([date, dots]) => {
              // Find nearest price point for this date
              let pricePoint = chartData.points.find((p) => p.date === date);
              if (!pricePoint) {
                // Find closest price point by x position
                let closest = chartData.points[0];
                let minDiff = Math.abs(dots[0].x - closest.x);
                chartData.points.forEach((p) => {
                  const diff = Math.abs(dots[0].x - p.x);
                  if (diff < minDiff) {
                    minDiff = diff;
                    closest = p;
                  }
                });
                pricePoint = closest;
              }
              const y = pricePoint?.y;
              if (y === undefined) return null;

              const x = dots[0].x;
              const isHovered = date === closestDate;
              const baseRadius = 5;
              const hoverRadius = 7;
              const radius = isHovered ? hoverRadius : baseRadius;

              const baseFontSize = 9;
              const hoverFontSize = 11;
              const fontSize = isHovered ? hoverFontSize : baseFontSize;
              const labelHeight = isHovered ? 18 : 14;
              const labelGap = 2;

              // Calculate label widths for stacked layout
              const labelWidths = dots.map((dot) => {
                const valueText = formatValue(dot.value);
                return valueText.length * (fontSize * 0.6) + 8;
              });
              const maxLabelWidth = Math.max(...labelWidths);

              return (
                <g key={`dotgroup-${date}`}>
                  {/* Segmented dot - pie slices for multiple metrics */}
                  {dots.length === 1 ? (
                    <circle
                      cx={x}
                      cy={y}
                      r={radius}
                      fill={dots[0].color}
                      stroke="white"
                      strokeWidth={isHovered ? 2 : 1}
                      filter={isHovered ? 'url(#dot-shadow-hover)' : undefined}
                      style={{ transition: 'r 0.15s ease-out' }}
                    />
                  ) : (
                    <g filter={isHovered ? 'url(#dot-shadow-hover)' : undefined}>
                      {dots.map((dot, i) => {
                        const anglePerSlice = (2 * Math.PI) / dots.length;
                        const startAngle = -Math.PI / 2 + i * anglePerSlice;
                        const endAngle = startAngle + anglePerSlice;
                        return (
                          <path
                            key={`slice-${i}`}
                            d={getPieSlicePath(x, y, radius, startAngle, endAngle)}
                            fill={dot.color}
                            stroke="white"
                            strokeWidth={isHovered ? 1.5 : 0.5}
                            style={{ transition: 'all 0.15s ease-out' }}
                          />
                        );
                      })}
                    </g>
                  )}
                  {/* Value labels - stacked vertically */}
                  {dots.map((dot, i) => {
                    const valueText = formatValue(dot.value);
                    const labelWidth = Math.max(labelWidths[i], maxLabelWidth * 0.8);
                    // Stack labels vertically above the dot
                    const labelY = y - radius - 3 - (dots.length - i) * (labelHeight + labelGap);

                    return (
                      <g key={`label-${i}`}>
                        <rect
                          x={x - labelWidth / 2}
                          y={labelY}
                          width={labelWidth}
                          height={labelHeight}
                          rx={3}
                          fill={dot.color}
                          stroke="white"
                          strokeWidth={isHovered ? 1.5 : 0.5}
                          opacity={isHovered ? 1 : 0.85}
                          style={{ transition: 'all 0.15s ease-out' }}
                        />
                        <text
                          x={x}
                          y={labelY + labelHeight / 2}
                          textAnchor="middle"
                          dominantBaseline="central"
                          fill="white"
                          fontSize={fontSize}
                          fontWeight={isHovered ? '700' : '600'}
                          fontFamily="Plus Jakarta Sans, sans-serif"
                          className="pointer-events-none"
                          style={{ transition: 'font-size 0.15s ease-out' }}
                        >
                          {valueText}
                        </text>
                      </g>
                    );
                  })}
                  <title>{dots.map((d) => `${d.label}: ${d.value.toLocaleString()}`).join('\n')}</title>
                </g>
              );
            })}
          </g>
        );
      })()}

      {/* Volume bars — colored by day direction (up green / down red, matching the
          candles). Rendered as two stroked paths so it stays fast on long series. */}
      {showVolume && (() => {
        const volumeBaseY = height - chartData.padding.bottom + 10 + chartData.volumeHeight;
        const barWidth = Math.max(1, (chartData.chartWidth / chartData.points.length) * 0.7);
        const up: string[] = [];
        const down: string[] = [];
        let prevClose: number | undefined;
        for (const point of chartData.points) {
          const barHeight = (point.volume / chartData.maxVolume) * chartData.volumeHeight;
          if (barHeight > 0) {
            const isUp =
              point.open != null ? point.close >= point.open
              : prevClose != null ? point.close >= prevClose
              : true;
            const seg = `M ${point.x},${volumeBaseY} L ${point.x},${volumeBaseY - barHeight}`;
            (isUp ? up : down).push(seg);
          }
          prevClose = point.close;
        }
        return (
          <g opacity={0.5}>
            <path d={up.join(' ')} stroke="#10b981" strokeWidth={barWidth} fill="none" />
            <path d={down.join(' ')} stroke="#ef4444" strokeWidth={barWidth} fill="none" />
          </g>
        );
      })()}

      {/* Hover overlay */}
      <HoverOverlay
        hoveredPoint={hoveredPoint}
        padding={chartData.padding}
        chartWidth={chartData.chartWidth}
        priceChartHeight={chartData.priceChartHeight}
        cursorMode={cursorMode}
        corporateAction={hoveredAction}
        additionalLinePoints={additionalLinePoints}
        overlayLinePoints={overlayLinePoints}
        pinnedTooltip={pinnedTooltip}
      />

      {/* Drag selection overlay - rendered last to be on top */}
      <DragSelectionOverlay
        selection={interaction.dragSelection}
        isDragging={interaction.isDragging}
        showConfirm={interaction.showDragConfirm}
        paddingTop={chartData.padding.top}
        paddingLeft={chartData.padding.left}
        priceChartHeight={chartData.priceChartHeight}
        onConfirm={interaction.confirmDragSelection}
        onCancel={interaction.cancelDragSelection}
      />
    </svg>
  );
});
