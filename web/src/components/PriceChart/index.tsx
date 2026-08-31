'use client';

import { useState, useRef, useEffect, useMemo, useCallback, memo } from 'react';
import { usePrices, useMultiplePrices } from '../../hooks/usePrices';
import type { PriceDataPoint } from '../../hooks/usePrices';
import { ChartSvg, type ChartSvgRef } from './components/ChartSvg';
import { RangeBar } from './components/RangeBar';
import { ChartHeader } from './components/ChartHeader';
import { ChartControlBar } from './components/ChartControlBar';
import { LineControlPanel } from './components/LineControlPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { ComparisonBadges } from './components/ComparisonBadges';
import { HoverValuesHeader } from './components/HoverValuesHeader';
import { ChartLegend } from './components/ChartLegend';
import { PerformanceReturns } from './components/PerformanceReturns';
import { usePriceChartSettings } from './hooks/usePriceChartSettings';
import { useLineSettings } from './hooks/useLineSettings';
import { useChartRange } from './hooks/useChartRange';
import { exportSvgAsPng, type ExportLegendItem } from '../../lib/chart-export';
import { ExportButton } from '../charts/ExportButton';
import { Icon } from '../icons';
import type { InsiderMarker, FilingMarker } from './renderers/MarkerRenderer';

type DateRange = '7D' | '1M' | '3M' | '6M' | '1Y' | '2Y' | '3Y' | '5Y' | 'ALL';

/** Custom overlay line data (e.g., holdings, institutional ownership) */
export interface OverlayLine {
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
  /** Whether the line is visible by default (default: true) */
  defaultVisible?: boolean;
  /** Allow gaps in the line where value is 0 (default: false - line is continuous) */
  allowGaps?: boolean;
}

interface PriceChartProps {
  ticker?: string;
  tickers?: string[];
  /** Display name for the ticker (shown in UI). If not provided, uses ticker. */
  displayName?: string;
  showTickerSelector?: boolean;
  /** Show a "Compare" button to add overlay tickers (works even with a fixed primary ticker) */
  showComparisonSelector?: boolean;
  onTickerChange?: (ticker: string) => void;
  height?: number;
  showVolume?: boolean;
  showCorporateActions?: boolean;
  defaultRange?: DateRange;
  showRangeSelector?: boolean;
  showRangeBar?: boolean;
  title?: string;
  newsMarkers?: { date: string; count: number }[];
  onDateRangeSelect?: (startDate: string, endDate: string) => void;
  /** Callback when user clicks on a specific date point (single click, not drag) */
  onDateClick?: (date: string) => void;
  className?: string;
  overlayLines?: OverlayLine[];
  showPerformanceReturns?: boolean;
  showLineControls?: boolean;
  insiderMarkers?: InsiderMarker[];
  filingMarkers?: FilingMarker[];
  /** Whether to show filing markers visually. Filing dates are still used for overlay positioning. Defaults to true. */
  showFilingMarkers?: boolean;
  onInsiderMarkerClick?: (date: string, accessionNumbers: string[]) => void;
  onFilingMarkerClick?: (marker: FilingMarker) => void;
  showFullControls?: boolean;
  defaultPinnedTooltip?: boolean;
  /** Default price type - 'adjusted' (split-adjusted) or 'actual' (raw). Defaults to localStorage value or 'adjusted'. */
  defaultPriceType?: 'adjusted' | 'actual';
  initialRangeStartDate?: string;
  initialRangeEndDate?: string;
  onVisibleRangeChange?: (startDate: string, endDate: string) => void;
  onRangeChangeEnd?: (startDate: string, endDate: string) => void;
  /** Whether the ticker prop is a ticker symbol (AAPL) vs perma_ticker. Defaults to false. */
  isTickerSymbol?: boolean;
  /** Custom controls to render below the chart (e.g., metric toggles) */
  customControls?: React.ReactNode;
  /** Callback when comparison tickers change (for controlled/persistent state) */
  onCompareTickersChange?: (tickers: string[]) => void;
  /** Use semibold font for overlay values in pinned tooltip */
  boldOverlayValues?: boolean;
}

interface ChartLine {
  ticker: string;
  data: PriceDataPoint[];
  color: string;
}

const COLORS = ['var(--color-ink)', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

export const PriceChart = memo(function PriceChart({
  ticker: singleTicker,
  tickers: multiTickers,
  displayName,
  showTickerSelector = false,
  showComparisonSelector = true,
  onTickerChange,
  height = 300,
  showVolume: propShowVolume,
  showCorporateActions: propShowCorporateActions,
  defaultRange = '3Y',
  showRangeSelector = true,
  showRangeBar = true,
  title = 'Price Chart',
  newsMarkers,
  onDateRangeSelect,
  onDateClick,
  className = '',
  overlayLines,
  showPerformanceReturns = true,
  showLineControls = false,
  insiderMarkers,
  filingMarkers,
  showFilingMarkers = true,
  onInsiderMarkerClick,
  onFilingMarkerClick,
  showFullControls = true,
  defaultPinnedTooltip = true,
  defaultPriceType,
  initialRangeStartDate,
  initialRangeEndDate,
  onVisibleRangeChange,
  onRangeChangeEnd,
  isTickerSymbol = false,
  customControls,
  onCompareTickersChange,
  boldOverlayValues = false,
}: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartSvgRef = useRef<ChartSvgRef>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [selectedTicker, setSelectedTicker] = useState(singleTicker || '');
  const [compareTickers, setCompareTickers] = useState<string[]>(multiTickers || []);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsStartDate, setSettingsStartDate] = useState('');
  const [settingsEndDate, setSettingsEndDate] = useState('');
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);
  // Live drag-selection span (from ChartSvg) — when set, the top-bar % change reflects
  // the dragged window instead of the visible date range.
  const [dragRange, setDragRange] = useState<{ startDate: string; endDate: string } | null>(null);
  const [hoveredData, setHoveredData] = useState<{
    date: string;
    close: number;
    open: number;
    high: number;
    low: number;
    volume: number;
  } | null>(null);
  const [hoveredOverlayData, setHoveredOverlayData] = useState<{
    label: string;
    value: number;
    color: string;
    format?: 'currency' | 'number';
    date?: string;
  }[] | null>(null);
  // Track last non-null overlay data so values persist when not hovering
  const [lastOverlayData, setLastOverlayData] = useState<{
    label: string;
    value: number;
    color: string;
    format?: 'currency' | 'number';
    date?: string;
  }[] | null>(null);

  // Track if hovering over the header (to prevent clearing hover state)
  const [isHoverLocked, setIsHoverLocked] = useState(false);

  // Update last overlay data when we get new hover data
  useEffect(() => {
    if (hoveredOverlayData && hoveredOverlayData.length > 0) {
      setLastOverlayData(hoveredOverlayData);
    }
  }, [hoveredOverlayData]);

  // Comparison ticker prices at hover position
  const [hoveredComparisonPrices, setHoveredComparisonPrices] = useState<{
    ticker: string;
    close: number;
    color: string;
  }[] | null>(null);

  // Settings hook
  const settings = usePriceChartSettings({
    showVolume: propShowVolume ?? false,
    showCorporateActions: propShowCorporateActions ?? true,
    pinnedTooltip: defaultPinnedTooltip,
    ...(defaultPriceType && { priceType: defaultPriceType }),
  });

  // Line settings hook
  const lineSettings = useLineSettings();
  const { addLine, lines: lineSettingsMap } = lineSettings;

  // Fetch price data (use actual/unadjusted prices based on priceType setting)
  // When isTickerSymbol is true or showTickerSelector is true, user enters ticker symbols (AAPL), so use ticker= API param
  // When ticker prop is passed directly (from parent), it's a perma_ticker, so use perma_ticker= API param
  const useAdjusted = settings.priceType === 'adjusted';
  const useTickerSymbol = isTickerSymbol || showTickerSelector;
  const { data: primaryData, isLoading, error } = usePrices(selectedTicker || null, {
    useAdjusted,
    isTickerSymbol: useTickerSymbol,
  });
  // Comparison tickers are always entered via TickerSelector, so they're always ticker symbols
  const comparisonQueries = useMultiplePrices(compareTickers, {
    useAdjusted,
    isTickerSymbol: true,
  });

  // Extract stable price data from comparison queries to avoid useMemo invalidation
  // useQueries returns new array references on every render, so we memoize the extracted data
  const comparisonPricesData = useMemo(() => {
    return comparisonQueries.map((q) => q.data?.prices ?? null);
  }, [comparisonQueries.map((q) => q.dataUpdatedAt).join(',')]);

  // Chart range hook - pass comparison data so it can extend the date range
  const chartRange = useChartRange({
    primaryData,
    comparisonData: comparisonPricesData,
    overlayLines,
    defaultRange,
    initialRangeStartDate,
    initialRangeEndDate,
    onVisibleRangeChange,
    onRangeChangeEnd,
    onDateRangeSelect,
  });

  // Register overlay lines
  useEffect(() => {
    if (overlayLines && overlayLines.length > 0) {
      overlayLines.forEach((line) => {
        addLine(line.label, {
          name: line.label,
          color: line.color,
          visible: line.defaultVisible !== false, // Default to true unless explicitly false
          fill: false,
          showDots: false,
          dashed: line.dashed || false,
        });
      });
    }
  }, [overlayLines, addLine]);

  // Container width - use ResizeObserver for reliable size detection
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateWidth = () => {
      setContainerWidth(container.offsetWidth);
    };

    // Initial measurement
    updateWidth();

    // Use ResizeObserver for reliable size change detection
    const resizeObserver = new ResizeObserver(() => {
      updateWidth();
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // Update ticker when prop changes
  useEffect(() => {
    if (singleTicker) {
      setSelectedTicker(singleTicker);
    }
  }, [singleTicker]);

  // Update comparison tickers
  useEffect(() => {
    if (multiTickers) {
      setCompareTickers(multiTickers);
    }
  }, [multiTickers]);

  // Build chart lines - uses stable comparisonPricesData instead of comparisonQueries to avoid unnecessary recalculations
  // Filter comparison data by actual dates (not index) to ensure proper alignment
  const chartLines: ChartLine[] = useMemo(() => {
    const lines: ChartLine[] = [];
    if (chartRange.filteredPrimaryData.length > 0) {
      lines.push({
        ticker: selectedTicker,
        data: chartRange.filteredPrimaryData,
        color: COLORS[0],
      });
    }
    compareTickers.forEach((t, i) => {
      const allPrices = comparisonPricesData[i];
      if (allPrices && allPrices.length > 0) {
        // Filter by visible date range instead of index to ensure proper alignment
        let filteredPrices = allPrices;
        if (chartRange.visibleDateRange) {
          const { startDate, endDate } = chartRange.visibleDateRange;
          const startMs = new Date(startDate + 'T00:00:00').getTime();
          const endMs = new Date(endDate + 'T00:00:00').getTime();

          // Find indices within date range, plus one before and after for line continuity
          let firstIdx = -1;
          let lastIdx = -1;
          for (let j = 0; j < allPrices.length; j++) {
            const priceDate = new Date(allPrices[j].date + 'T00:00:00').getTime();
            if (priceDate >= startMs && priceDate <= endMs) {
              if (firstIdx === -1) firstIdx = j;
              lastIdx = j;
            }
          }

          if (firstIdx !== -1) {
            // Include one point before and after for smooth edges
            const startIdx = Math.max(0, firstIdx - 1);
            const endIdx = Math.min(allPrices.length - 1, lastIdx + 1);
            filteredPrices = allPrices.slice(startIdx, endIdx + 1);
          } else {
            // No data in range
            filteredPrices = [];
          }
        }

        if (filteredPrices.length > 0) {
          lines.push({
            ticker: t,
            data: filteredPrices,
            color: COLORS[(i + 1) % COLORS.length],
          });
        }
      }
    });
    return lines;
  }, [chartRange.filteredPrimaryData, chartRange.visibleDateRange, selectedTicker, compareTickers, comparisonPricesData]);

  // Filter visible chart lines
  const visibleChartLines = chartLines.filter((line) => {
    const config = lineSettingsMap.get(line.ticker);
    return !config || config.visible;
  });

  // Ticker handlers
  const handleTickerSelect = useCallback((ticker: string) => {
    setSelectedTicker(ticker);
    onTickerChange?.(ticker);
  }, [onTickerChange]);

  const handleAddCompareTicker = useCallback((ticker: string) => {
    if (!compareTickers.includes(ticker) && ticker !== selectedTicker) {
      const newTickers = [...compareTickers, ticker];
      // Use consistent color based on position in compareTickers (index + 1 because primary is index 0)
      const colorIndex = (newTickers.length) % COLORS.length;
      setCompareTickers(newTickers);
      lineSettings.addLine(ticker, { name: ticker, color: COLORS[colorIndex] });
      onCompareTickersChange?.(newTickers);
    }
  }, [compareTickers, selectedTicker, lineSettings, onCompareTickersChange]);

  const handleRemoveCompareTicker = useCallback((ticker: string) => {
    const newTickers = compareTickers.filter((t) => t !== ticker);
    setCompareTickers(newTickers);
    lineSettings.removeLine(ticker);
    onCompareTickersChange?.(newTickers);
  }, [compareTickers, lineSettings, onCompareTickersChange]);

  const handleRemovePrimaryTicker = useCallback(() => {
    // If there are comparison tickers, promote the first one to primary
    if (compareTickers.length > 0) {
      const newPrimary = compareTickers[0];
      setSelectedTicker(newPrimary);
      setCompareTickers(compareTickers.slice(1));
      lineSettings.removeLine(newPrimary);
      onTickerChange?.(newPrimary);
    } else {
      setSelectedTicker('');
      onTickerChange?.('');
    }
  }, [compareTickers, lineSettings, onTickerChange]);

  // Settings handlers
  const handleApplyDateRange = useCallback(() => {
    if (settingsStartDate && settingsEndDate) {
      chartRange.handleZoomSelection(settingsStartDate, settingsEndDate);
    }
  }, [settingsStartDate, settingsEndDate, chartRange]);

  const handleResetDateRange = useCallback(() => {
    setSettingsStartDate('');
    setSettingsEndDate('');
    chartRange.handlePresetRangeChange('1Y');
  }, [chartRange]);

  // Use displayName for the primary ticker if provided, fallback to meta.name from API, then ticker
  const metaName = primaryData?.meta?.name;
  const primaryDisplayName = displayName || metaName || (chartLines.length > 0 ? chartLines[0].ticker : '');

  // Compute chart title - always prefer meta.name from tickers_meta when available
  const chartTitle = useMemo(() => {
    // If we have a meta name from the API, always use it for consistency
    if (metaName) return metaName;
    // Otherwise fall back to the provided title
    return title;
  }, [title, metaName]);

  // Export handler
  const handleExport = useCallback(async () => {
    const svgElement = chartSvgRef.current?.getSvgElement();
    if (svgElement) {
      const exportTitle = primaryDisplayName || selectedTicker || 'price-chart';

      // Build legend items from visible lines
      const legendItems: ExportLegendItem[] = [];

      // Helper to resolve CSS variables to actual colors
      const resolveColor = (color: string): string => {
        if (color.startsWith('var(')) {
          const varName = color.slice(4, -1); // extract --color-ink from var(--color-ink)
          return getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || '#000000';
        }
        return color;
      };

      // Add primary ticker (no value - just label and color)
      if (chartLines.length > 0) {
        const primaryLine = chartLines[0];
        legendItems.push({
          label: primaryDisplayName || primaryLine.ticker,
          color: resolveColor(primaryLine.color),
        });
      }

      // Add visible overlay lines (no values - just labels and colors)
      if (overlayLines) {
        overlayLines.forEach((line) => {
          const config = lineSettingsMap.get(line.label);
          if (!config || config.visible) {
            legendItems.push({
              label: line.label,
              color: line.color,
            });
          }
        });
      }

      // Build display title for the export
      const displayTitle = chartTitle || primaryDisplayName || selectedTicker;

      await exportSvgAsPng(svgElement, exportTitle, 2, legendItems, displayTitle);
    }
  }, [primaryDisplayName, selectedTicker, chartLines, overlayLines, lineSettingsMap, chartTitle]);

  const lineConfigs = useMemo(() => {
    // Primary ticker config (first in chartLines)
    const primaryLineConfig = chartLines.length > 0 ? [{
      id: chartLines[0].ticker,
      name: primaryDisplayName + ' (Primary)',
      color: chartLines[0].color,
      visible: true,
      fill: false,
      showDots: false,
      scale: 'combined' as const,
      smoothing: 1,
      strokeWidth: 2,
      dashed: false,
    }] : [];

    const comparisonLineConfigs = chartLines.slice(1).map((line) => {
      const existing = lineSettingsMap.get(line.ticker);
      return existing || {
        id: line.ticker,
        name: line.ticker,
        color: line.color,
        visible: true,
        fill: false,
        showDots: false,
        scale: 'combined' as const,
        smoothing: 1,
        strokeWidth: 2,
        dashed: false,
      };
    });

    const overlayLineConfigs = (overlayLines || []).map((line) => {
      const existing = lineSettingsMap.get(line.label);
      return existing || {
        id: line.label,
        name: line.label,
        color: line.color,
        visible: true,
        fill: false,
        showDots: false,
        scale: 'combined' as const,
        smoothing: 1,
        strokeWidth: 2,
        dashed: line.dashed || false,
      };
    });

    return [...primaryLineConfig, ...comparisonLineConfigs, ...overlayLineConfigs];
  }, [chartLines, overlayLines, lineSettingsMap, primaryDisplayName]);

  // Filter visible overlay lines
  const visibleOverlayLines = useMemo(() => {
    if (!chartRange.rangeFilteredOverlayLines) return [];
    return chartRange.rangeFilteredOverlayLines.filter((line) => {
      const config = lineSettingsMap.get(line.label);
      return !config || config.visible;
    });
  }, [chartRange.rangeFilteredOverlayLines, lineSettingsMap]);

  // Line values for LineControlPanel
  const lineValues = useMemo(() => {
    const values = new Map<string, { value: number | null; label?: string }>();

    const parseOverlayDate = (dateStr: string): number => {
      const quarterMatch = dateStr.match(/^(\d{4})-Q(\d)$/);
      if (quarterMatch) {
        const year = parseInt(quarterMatch[1]);
        const quarter = parseInt(quarterMatch[2]);
        const month = (quarter - 1) * 3 + 1;
        return new Date(year, month, 15).getTime();
      }
      return new Date(dateStr + 'T00:00:00').getTime();
    };

    // Add primary ticker value (first in chartLines)
    if (chartLines.length > 0) {
      const primaryLine = chartLines[0];
      let displayValue: number | null = null;
      if (hoveredDate && primaryLine.data && primaryLine.data.length > 0) {
        const hoveredTime = new Date(hoveredDate + 'T00:00:00').getTime();
        let closestPoint = primaryLine.data[0];
        let closestDiff = Infinity;
        for (const point of primaryLine.data) {
          const pointTime = new Date(point.date + 'T00:00:00').getTime();
          const diff = Math.abs(pointTime - hoveredTime);
          if (diff < closestDiff) {
            closestDiff = diff;
            closestPoint = point;
          }
        }
        displayValue = closestPoint?.close ?? null;
      } else {
        displayValue = primaryLine.data && primaryLine.data.length > 0 ? primaryLine.data[primaryLine.data.length - 1]?.close : null;
      }
      values.set(primaryLine.ticker, { value: displayValue, label: '$' });
    }

    // Add comparison ticker values (chartLines excluding the primary ticker)
    chartLines.slice(1).forEach((line) => {
      let displayValue: number | null = null;
      if (hoveredDate && line.data && line.data.length > 0) {
        const hoveredTime = new Date(hoveredDate + 'T00:00:00').getTime();
        let closestPoint = line.data[0];
        let closestDiff = Infinity;
        for (const point of line.data) {
          const pointTime = new Date(point.date + 'T00:00:00').getTime();
          const diff = Math.abs(pointTime - hoveredTime);
          if (diff < closestDiff) {
            closestDiff = diff;
            closestPoint = point;
          }
        }
        displayValue = closestPoint?.close ?? null;
      } else {
        displayValue = line.data && line.data.length > 0 ? line.data[line.data.length - 1]?.close : null;
      }
      values.set(line.ticker, { value: displayValue, label: '$' });
    });

    // Add overlay line values
    visibleOverlayLines.forEach((line) => {
      let displayValue: number | null = null;
      if (hoveredDate && line.data && line.data.length > 0) {
        const hoveredTime = new Date(hoveredDate + 'T00:00:00').getTime();
        let closestPoint = line.data[0];
        let closestDiff = Infinity;
        for (const point of line.data) {
          const pointTime = parseOverlayDate(point.date);
          const diff = Math.abs(pointTime - hoveredTime);
          if (diff < closestDiff) {
            closestDiff = diff;
            closestPoint = point;
          }
        }
        displayValue = closestPoint?.value ?? null;
      } else {
        displayValue = line.data && line.data.length > 0 ? line.data[line.data.length - 1]?.value : null;
      }
      values.set(line.label, { value: displayValue });
    });

    return values;
  }, [chartLines, visibleOverlayLines, hoveredDate]);

  // Display state
  const hasOverlayLines = overlayLines && overlayLines.length > 0;
  const showNoData = !selectedTicker && !showTickerSelector && !hasOverlayLines;
  const showEmptyState = showTickerSelector && !selectedTicker && !hasOverlayLines;

  // % change shown in the top bar: over the drag-selected window when dragging
  // (override), otherwise over the visible date range. Uses the primary line's
  // close (whichever price type is active), first→last point.
  const periodChange = useMemo(() => {
    const visible = chartRange.trimmedPrimaryData;
    if (!visible || visible.length < 2) return null;
    let startPt = visible[0];
    let endPt = visible[visible.length - 1];
    if (dragRange) {
      const all = primaryData?.prices?.length ? primaryData.prices : visible;
      const nearest = (target: string) => {
        const t = new Date(target + 'T00:00:00').getTime();
        let best = all[0];
        let bestDiff = Infinity;
        for (const p of all) {
          const diff = Math.abs(new Date(p.date + 'T00:00:00').getTime() - t);
          if (diff < bestDiff) { bestDiff = diff; best = p; }
        }
        return best;
      };
      startPt = nearest(dragRange.startDate);
      endPt = nearest(dragRange.endDate);
    }
    const a = startPt?.close;
    const b = endPt?.close;
    if (!a || a === 0 || b == null || startPt.date === endPt.date) return null;
    const fmt = (d: string) =>
      new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return {
      pct: ((b - a) / a) * 100,
      label: `${fmt(startPt.date)} → ${fmt(endPt.date)}`,
      dragging: !!dragRange,
    };
  }, [chartRange.trimmedPrimaryData, dragRange, primaryData]);

  return (
    <div className={`bg-white border border-rule rounded-[10px] overflow-hidden ${className}`}>
      {/* Header */}
      <ChartHeader
        title={chartTitle}
        showTickerSelector={showTickerSelector}
        showComparisonSelector={showComparisonSelector}
        selectedTicker={selectedTicker}
        compareTickers={compareTickers}
        showRangeSelector={showRangeSelector}
        selectedRange={chartRange.selectedRange}
        showSettings={showSettings}
        periodChange={periodChange}
        onTickerChange={handleTickerSelect}
        onRemovePrimaryTicker={handleRemovePrimaryTicker}
        onAddCompareTicker={handleAddCompareTicker}
        onRangeChange={chartRange.handlePresetRangeChange}
        onToggleSettings={() => setShowSettings(!showSettings)}
      />

      {/* Settings Panel */}
      {showSettings && selectedTicker && (
        <SettingsPanel
          startDate={settingsStartDate}
          endDate={settingsEndDate}
          selectedRange={chartRange.selectedRange}
          onStartDateChange={setSettingsStartDate}
          onEndDateChange={setSettingsEndDate}
          onPresetRangeChange={(range) => {
            chartRange.handlePresetRangeChange(range);
            setSettingsStartDate('');
            setSettingsEndDate('');
          }}
          onApplyDateRange={handleApplyDateRange}
          onResetDateRange={handleResetDateRange}
          labelSize={settings.labelSize}
          onLabelSizeChange={settings.setLabelSize}
          dotScale={settings.dotScale}
          onDotScaleChange={settings.setDotScale}
          dotScaleMode={settings.dotScaleMode}
          onToggleDotScaleMode={settings.toggleDotScaleMode}
          showDotScale={!!insiderMarkers?.length}
          showFill={settings.showFill}
          onToggleFill={settings.toggleFill}
        />
      )}

      {/* Comparison Badges */}
      <ComparisonBadges
        tickers={compareTickers}
        colors={COLORS}
        onRemove={handleRemoveCompareTicker}
      />

      {/* Chart Area */}
      <div ref={containerRef} className="p-4 md:p-6">
        {/* Loading */}
        {isLoading && selectedTicker && (
          <div className="flex items-center justify-center py-16">
            <Icon name="spinner" className="w-8 h-8 text-green animate-spin" />
            <span className="ml-3 text-ink-light font-medium">Loading price data...</span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 px-5 flex items-start gap-3">
            <Icon name="x-circle" className="w-5 h-5 text-red-600 shrink-0" />
            <p className="text-sm font-medium text-red-700 m-0">Failed to load price data for {selectedTicker}</p>
          </div>
        )}

        {/* Empty state */}
        {showEmptyState && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Icon name="chart-line" className="w-12 h-12 text-ink-muted mb-4" />
            <p className="font-sans text-base font-semibold text-ink-faint mb-1">Select a Ticker</p>
            <p className="font-sans text-sm text-ink-muted">Enter a ticker symbol above to view the price chart</p>
          </div>
        )}

        {/* No data */}
        {showNoData && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Icon name="chart-line" className="w-12 h-12 text-ink-muted mb-4" />
            <p className="font-sans text-base font-semibold text-ink-faint mb-1">No Price Data</p>
            <p className="font-sans text-sm text-ink-muted">Price data is not available for this entity</p>
          </div>
        )}

        {/* Chart */}
        {!isLoading && !error && (chartRange.filteredPrimaryData.length > 0 || hasOverlayLines) && containerWidth > 0 && (
          <>
            {/* Hover Values Header */}
            {settings.pinnedTooltip && (
              <div
                onMouseEnter={() => setIsHoverLocked(true)}
                onMouseLeave={() => setIsHoverLocked(false)}
              >
                <HoverValuesHeader
                  hoveredData={hoveredData}
                  hoveredDateOnly={hoveredDate}
                  hoveredOverlayData={hoveredOverlayData || lastOverlayData}
                  hoveredComparisonPrices={hoveredComparisonPrices}
                  hasCustomRange={chartRange.hasCustomRange}
                  onResetRange={chartRange.handleResetRange}
                  boldOverlayValues={boldOverlayValues}
                />
              </div>
            )}

            {/* Date range label */}
            {!settings.pinnedTooltip && chartRange.hasCustomRange && chartRange.dateRangeLabel && (
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-ink-light font-medium">{chartRange.dateRangeLabel}</span>
                <button
                  onClick={chartRange.handleResetRange}
                  className="text-xs text-green font-medium hover:text-green-dark transition-colors"
                >
                  Reset Range
                </button>
              </div>
            )}

            <div className="relative">
              <div className="absolute top-0 right-0 z-10">
                <ExportButton onExport={handleExport} />
              </div>
              <ChartSvg
                ref={chartSvgRef}
                data={chartRange.filteredPrimaryData}
                corporateActions={primaryData?.corporateActions}
                width={containerWidth - 48}
                height={height}
                chartMode={settings.chartMode}
                cursorMode={settings.cursorMode}
                dateFormat={settings.dateFormat}
                showVolume={settings.showVolume}
                showCorporateActions={settings.showCorporateActions && compareTickers.length === 0}
                showFill={settings.showFill}
                lineColor={COLORS[0]}
                areaColor={COLORS[0]}
                newsMarkers={newsMarkers}
                insiderMarkers={insiderMarkers}
                filingMarkers={filingMarkers}
                showFilingMarkers={showFilingMarkers}
                onInsiderMarkerClick={onInsiderMarkerClick}
                onFilingMarkerClick={onFilingMarkerClick}
                dotScale={settings.dotScale}
                dotScaleMode={settings.dotScaleMode}
                onDateRangeSelect={chartRange.handleZoomSelection}
                onDateClick={onDateClick}
                onHoverChange={setHoveredDate}
                onHoverDataChange={setHoveredData}
                onOverlayHoverChange={setHoveredOverlayData}
                onComparisonHoverChange={setHoveredComparisonPrices}
                onDragSelectionChange={setDragRange}
                additionalLines={visibleChartLines.slice(1)}
                overlayLines={visibleOverlayLines}
                visibleDateRange={chartRange.visibleDateRange}
                comparisonScaleMode={settings.comparisonScaleMode}
                pinnedTooltip={settings.pinnedTooltip}
                lineSettings={lineSettingsMap}
                isHoverLocked={isHoverLocked}
                highlightDate={initialRangeStartDate === initialRangeEndDate ? initialRangeStartDate : undefined}
              />
            </div>
          </>
        )}
      </div>

      {/* Control Bar */}
      {showFullControls && selectedTicker && chartRange.filteredPrimaryData.length > 0 && (
        <ChartControlBar
          chartMode={settings.chartMode}
          cursorMode={settings.cursorMode}
          dateFormat={settings.dateFormat}
          priceType={settings.priceType}
          showVolume={settings.showVolume}
          showCorporateActions={settings.showCorporateActions}
          comparisonScaleMode={settings.comparisonScaleMode}
          hasComparisonLines={compareTickers.length > 0 || (overlayLines?.length ?? 0) > 0}
          onToggleChartMode={settings.toggleChartMode}
          onToggleCursorMode={settings.toggleCursorMode}
          onToggleDateFormat={settings.toggleDateFormat}
          onTogglePriceType={settings.togglePriceType}
          onToggleVolume={settings.toggleVolume}
          onToggleCorporateActions={settings.toggleCorporateActions}
          onToggleComparisonScaleMode={settings.toggleComparisonScaleMode}
          hideVolumeControl={false}
          hideCorporateActionsControl={compareTickers.length > 0}
          pinnedTooltip={settings.pinnedTooltip}
          onTogglePinnedTooltip={settings.togglePinnedTooltip}
        />
      )}

      {/* Line Control Panel */}
      {showLineControls && lineConfigs.length > 0 && (
        <LineControlPanel
          lines={lineConfigs}
          lineValues={lineValues}
          onToggleVisibility={lineSettings.toggleLineVisibility}
          onToggleFill={lineSettings.toggleLineFill}
          onToggleDots={lineSettings.toggleLineDots}
          onSetColor={lineSettings.setLineColor}
          onSetScale={lineSettings.setLineScale}
          onSetSmoothing={lineSettings.setLineSmoothing}
          onRemoveLine={compareTickers.length > 0 ? handleRemoveCompareTicker : undefined}
        />
      )}

      {/* Custom Controls */}
      {customControls && (
        <div className="px-4 py-2 border-t border-rule-light">
          {customControls}
        </div>
      )}

      {/* Range Bar */}
      {showRangeBar && (chartRange.allPriceData.length > 0 || hasOverlayLines) && (
        <div className="p-4 border-t border-rule-light">
          <div className="flex justify-between text-xs font-medium text-ink-light mb-2">
            <span>Start</span>
            <span>End</span>
          </div>
          <RangeBar
            rangeStart={chartRange.customRangeStart}
            rangeEnd={chartRange.customRangeEnd}
            onRangeChange={chartRange.handleRangeBarChange}
            onRangeChangeEnd={chartRange.handleRangeBarChangeEnd}
            height={40}
          />
          <div className="flex justify-center gap-2 mt-4">
            {(['1M', '3M', '1Y', 'ALL'] as const).map((range) => (
              <button
                key={range}
                onClick={() => chartRange.handlePresetRangeChange(range)}
                className={`font-sans text-sm font-semibold py-2.5 px-5 rounded-md cursor-pointer border border-transparent ${
                  chartRange.selectedRange === range
                    ? 'bg-green text-white'
                    : 'bg-surface-warm text-ink-light hover:bg-surface'
                }`}
              >
                {range === 'ALL' ? 'All' : range}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Footer Content */}
      <div className="p-4 md:p-6 pt-0">
        {/* Legend */}
        <ChartLegend chartLines={chartLines} overlayLines={overlayLines} primaryDisplayName={primaryDisplayName}
          lineSettings={lineSettingsMap} onToggleVisibility={lineSettings.toggleLineVisibility} />

        {/* Performance Returns */}
        {primaryData?.prices && showPerformanceReturns && !showTickerSelector && (
          <PerformanceReturns prices={primaryData.prices} />
        )}
      </div>
    </div>
  );
});
