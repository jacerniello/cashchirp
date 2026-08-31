'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type { PriceDataPoint } from '../../../hooks/usePrices';
import type { OverlayLine } from '../index';

type DateRange = '7D' | '1M' | '3M' | '6M' | '1Y' | '2Y' | '3Y' | '5Y' | 'ALL';

interface UseChartRangeOptions {
  primaryData?: { prices: PriceDataPoint[] } | null;
  /** Comparison ticker price data - used to extend date range when primary has less data */
  comparisonData?: (PriceDataPoint[] | null)[];
  overlayLines?: OverlayLine[];
  defaultRange?: DateRange;
  initialRangeStartDate?: string;
  initialRangeEndDate?: string;
  onVisibleRangeChange?: (startDate: string, endDate: string) => void;
  onRangeChangeEnd?: (startDate: string, endDate: string) => void;
  onDateRangeSelect?: (startDate: string, endDate: string) => void;
}

interface ChartRangeState {
  selectedRange: DateRange;
  customRangeStart: number;
  customRangeEnd: number;
  hasCustomRange: boolean;
  dateRangeLabel: string;
  /** Primary data clipped to the visible range, padded with one point on each
   *  side for smooth line edges. Use this for rendering the line. */
  filteredPrimaryData: PriceDataPoint[];
  /** Primary data clipped to exactly the in-range points (no edge padding).
   *  Use this for the range label and period % change so they reflect the
   *  actual selected window, not the padding point. */
  trimmedPrimaryData: PriceDataPoint[];
  allPriceData: PriceDataPoint[];
  rangeFilteredOverlayLines: OverlayLine[] | undefined;
  /** Visible date range for filtering comparison data */
  visibleDateRange: { startDate: string; endDate: string } | null;
}

interface ChartRangeActions {
  handlePresetRangeChange: (range: DateRange) => void;
  handleRangeBarChange: (start: number, end: number) => void;
  handleRangeBarChangeEnd: (start: number, end: number) => void;
  handleZoomSelection: (startDate: string, endDate: string) => void;
  handleResetRange: () => void;
  getAllDates: () => string[];
}

// Calendar-accurate window lengths. The month ranges use the average month
// length (365.25/12 ≈ 30.44 days) rather than 30/90 so e.g. "3M" back from a
// date lands a full three calendar months earlier, not 90 days.
const RANGE_TO_DAYS: Record<DateRange, number | null> = {
  '7D': 7,
  '1M': 30,
  '3M': 91,
  '6M': 182,
  '1Y': 365,
  '2Y': 730,
  '3Y': 1095,
  '5Y': 1825,
  'ALL': null,
};

// Minimum range of 2 days to prevent zooming in too far
const MIN_RANGE_DAYS = 2;

export function useChartRange(options: UseChartRangeOptions): ChartRangeState & ChartRangeActions {
  const {
    primaryData,
    comparisonData,
    overlayLines,
    defaultRange = '3Y',
    initialRangeStartDate,
    initialRangeEndDate,
    onVisibleRangeChange,
    onRangeChangeEnd,
    onDateRangeSelect,
  } = options;

  const [selectedRange, setSelectedRange] = useState<DateRange>(defaultRange);
  const [customRangeStart, setCustomRangeStart] = useState(0);
  const [customRangeEnd, setCustomRangeEnd] = useState(1);
  const [rangeInitialized, setRangeInitialized] = useState(false);
  const userInteractedRef = useRef(false);
  const appliedParamsRef = useRef<{ start: string | undefined; end: string | undefined }>({ start: undefined, end: undefined });
  const prevInitialRangeRef = useRef<{ start: string | undefined; end: string | undefined }>({ start: initialRangeStartDate, end: initialRangeEndDate });

  // Reset range when initial range props change (e.g., from URL updates)
  useEffect(() => {
    const prevStart = prevInitialRangeRef.current.start;
    const prevEnd = prevInitialRangeRef.current.end;

    if (prevStart !== initialRangeStartDate || prevEnd !== initialRangeEndDate) {
      // Initial range props changed - reset state to allow re-initialization
      setRangeInitialized(false);
      userInteractedRef.current = false;
      appliedParamsRef.current = { start: undefined, end: undefined };
      prevInitialRangeRef.current = { start: initialRangeStartDate, end: initialRangeEndDate };
    }
  }, [initialRangeStartDate, initialRangeEndDate]);

  // Helper to parse overlay dates including quarter format
  const parseOverlayDate = useCallback((dateStr: string): Date => {
    const quarterMatch = dateStr.match(/^(\d{4})-Q(\d)$/);
    if (quarterMatch) {
      const year = parseInt(quarterMatch[1]);
      const quarter = parseInt(quarterMatch[2]);
      const month = (quarter - 1) * 3 + 1;
      return new Date(year, month, 15);
    }
    return new Date(dateStr + 'T00:00:00');
  }, []);

  // Get all dates (union of price data, comparison data, and overlay lines)
  const getAllDates = useCallback(() => {
    const dateSet = new Set<string>();

    const normalizeDate = (dateStr: string): string => {
      const quarterMatch = dateStr.match(/^(\d{4})-Q(\d)$/);
      if (quarterMatch) {
        const year = parseInt(quarterMatch[1]);
        const quarter = parseInt(quarterMatch[2]);
        const month = String((quarter - 1) * 3 + 1).padStart(2, '0');
        return `${year}-${month}-15`;
      }
      return dateStr;
    };

    // Collect from primary data
    if (primaryData?.prices && primaryData.prices.length > 0) {
      primaryData.prices.forEach((p) => dateSet.add(p.date));
    }

    // Collect from comparison data
    if (comparisonData) {
      comparisonData.forEach((prices) => {
        if (prices && prices.length > 0) {
          prices.forEach((p) => dateSet.add(p.date));
        }
      });
    }

    // Collect from overlay lines
    if (overlayLines && overlayLines.length > 0) {
      overlayLines.forEach((line) => {
        if (line.data) {
          line.data.forEach((point) => {
            dateSet.add(normalizeDate(point.date));
          });
        }
      });
    }

    return Array.from(dateSet).sort();
  }, [primaryData?.prices, comparisonData, overlayLines]);

  // Get date bounds from available data - uses the widest range among all sources
  const getDateBounds = useCallback((): { oldest: Date; newest: Date } | null => {
    const allDates: Date[] = [];

    // Collect dates from primary data
    if (primaryData?.prices && primaryData.prices.length > 0) {
      primaryData.prices.forEach((p) => {
        allDates.push(new Date(p.date + 'T00:00:00'));
      });
    }

    // Collect dates from comparison data
    if (comparisonData) {
      comparisonData.forEach((prices) => {
        if (prices && prices.length > 0) {
          prices.forEach((p) => {
            allDates.push(new Date(p.date + 'T00:00:00'));
          });
        }
      });
    }

    // Collect dates from overlay lines
    if (overlayLines && overlayLines.length > 0) {
      overlayLines.forEach((line) => {
        if (line.data) {
          line.data.forEach((point) => {
            allDates.push(parseOverlayDate(point.date));
          });
        }
      });
    }

    if (allDates.length >= 2) {
      allDates.sort((a, b) => a.getTime() - b.getTime());
      return { oldest: allDates[0], newest: allDates[allDates.length - 1] };
    }

    return null;
  }, [primaryData?.prices, comparisonData, overlayLines, parseOverlayDate]);

  // Range initialization effect
  useEffect(() => {
    const bounds = getDateBounds();
    if (!bounds) return;

    const totalMs = bounds.newest.getTime() - bounds.oldest.getTime();
    if (totalMs <= 0) {
      setCustomRangeStart(0);
      setCustomRangeEnd(1);
      setRangeInitialized(true);
      return;
    }

    // If URL params provided, use them (but only on initial load, not after user interaction)
    if (initialRangeStartDate || initialRangeEndDate) {
      if (userInteractedRef.current) return;

      const paramsChanged =
        appliedParamsRef.current.start !== initialRangeStartDate ||
        appliedParamsRef.current.end !== initialRangeEndDate;

      if (!paramsChanged && rangeInitialized) return;

      let startRatio = 0;
      let endRatio = 1;

      if (initialRangeStartDate) {
        const startDateObj = new Date(initialRangeStartDate + 'T00:00:00');
        startRatio = Math.max(0, Math.min(1, (startDateObj.getTime() - bounds.oldest.getTime()) / totalMs));
      }

      if (initialRangeEndDate) {
        const endDateObj = new Date(initialRangeEndDate + 'T00:00:00');
        endRatio = Math.max(0, Math.min(1, (endDateObj.getTime() - bounds.oldest.getTime()) / totalMs));
      }

      // Handle single day case - center the point with buffer on each side
      if (startRatio === endRatio) {
        const dayRatio = (24 * 60 * 60 * 1000) / totalMs; // One day as ratio
        const desiredBuffer = dayRatio * 7; // 7 days on each side for visibility
        const centerRatio = startRatio;

        // Calculate available space on each side
        const spaceLeft = centerRatio;
        const spaceRight = 1 - centerRatio;

        // Use symmetric buffer (limited by the smaller side) to keep centered
        const actualBuffer = Math.min(desiredBuffer, spaceLeft, spaceRight);

        startRatio = centerRatio - actualBuffer;
        endRatio = centerRatio + actualBuffer;
      }

      if (startRatio <= endRatio) {
        setCustomRangeStart(startRatio);
        setCustomRangeEnd(endRatio);
        appliedParamsRef.current = { start: initialRangeStartDate, end: initialRangeEndDate };
        setRangeInitialized(true);
      }
      return;
    }

    // No URL params - apply default range (but only once)
    if (rangeInitialized) return;

    const totalDays = totalMs / (1000 * 60 * 60 * 24);
    const targetDays = RANGE_TO_DAYS[defaultRange] ?? totalDays;

    if (targetDays >= totalDays) {
      setCustomRangeStart(0);
      setCustomRangeEnd(1);
    } else {
      const startRatio = Math.max(0, 1 - (targetDays / totalDays));
      setCustomRangeStart(startRatio);
      setCustomRangeEnd(1);
    }

    setRangeInitialized(true);
  }, [getDateBounds, defaultRange, rangeInitialized, initialRangeStartDate, initialRangeEndDate, primaryData?.prices?.length, overlayLines?.length]);

  // Handle preset range change
  const handlePresetRangeChange = useCallback((range: DateRange) => {
    setSelectedRange(range);

    const bounds = getDateBounds();
    if (!bounds) return;

    const totalMs = bounds.newest.getTime() - bounds.oldest.getTime();
    const totalDays = totalMs / (1000 * 60 * 60 * 24);
    const targetDays = RANGE_TO_DAYS[range] ?? totalDays;

    if (targetDays >= totalDays) {
      setCustomRangeStart(0);
      setCustomRangeEnd(1);
    } else {
      const startRatio = Math.max(0, 1 - (targetDays / totalDays));
      setCustomRangeStart(startRatio);
      setCustomRangeEnd(1);
    }
  }, [getDateBounds]);

  // Handle range bar change using DATE-based calculations
  const handleRangeBarChange = useCallback((start: number, end: number) => {
    const bounds = getDateBounds();
    if (!bounds) return;

    const totalMs = bounds.newest.getTime() - bounds.oldest.getTime();
    if (totalMs <= 0) return;

    // Enforce minimum range of 2 days
    const minRangePercent = (MIN_RANGE_DAYS * 24 * 60 * 60 * 1000) / totalMs;

    let adjustedStart = start;
    let adjustedEnd = end;

    if (end - start < minRangePercent) {
      // If range is too small, expand it to minimum
      const midpoint = (start + end) / 2;
      adjustedStart = Math.max(0, midpoint - minRangePercent / 2);
      adjustedEnd = Math.min(1, midpoint + minRangePercent / 2);

      // If we hit a boundary, adjust the other end
      if (adjustedStart === 0) {
        adjustedEnd = Math.min(1, minRangePercent);
      } else if (adjustedEnd === 1) {
        adjustedStart = Math.max(0, 1 - minRangePercent);
      }
    }

    setCustomRangeStart(adjustedStart);
    setCustomRangeEnd(adjustedEnd);

    if (onVisibleRangeChange) {
      // Calculate dates from percentages
      const startDateMs = bounds.oldest.getTime() + adjustedStart * totalMs;
      const endDateMs = bounds.oldest.getTime() + adjustedEnd * totalMs;
      const startDate = new Date(startDateMs).toISOString().split('T')[0];
      const endDate = new Date(endDateMs).toISOString().split('T')[0];
      onVisibleRangeChange(startDate, endDate);
    }
  }, [getDateBounds, onVisibleRangeChange]);

  // Handle range bar drag end using DATE-based calculations
  const handleRangeBarChangeEnd = useCallback((start: number, end: number) => {
    userInteractedRef.current = true;

    const bounds = getDateBounds();
    if (!bounds) return;

    const totalMs = bounds.newest.getTime() - bounds.oldest.getTime();
    if (totalMs <= 0) return;

    // Enforce minimum range of 2 days
    const minRangePercent = (MIN_RANGE_DAYS * 24 * 60 * 60 * 1000) / totalMs;

    let adjustedStart = start;
    let adjustedEnd = end;

    if (end - start < minRangePercent) {
      const midpoint = (start + end) / 2;
      adjustedStart = Math.max(0, midpoint - minRangePercent / 2);
      adjustedEnd = Math.min(1, midpoint + minRangePercent / 2);

      if (adjustedStart === 0) {
        adjustedEnd = Math.min(1, minRangePercent);
      } else if (adjustedEnd === 1) {
        adjustedStart = Math.max(0, 1 - minRangePercent);
      }
    }

    if (onRangeChangeEnd) {
      // Calculate dates from percentages
      const startDateMs = bounds.oldest.getTime() + adjustedStart * totalMs;
      const endDateMs = bounds.oldest.getTime() + adjustedEnd * totalMs;
      const startDate = new Date(startDateMs).toISOString().split('T')[0];
      const endDate = new Date(endDateMs).toISOString().split('T')[0];
      onRangeChangeEnd(startDate, endDate);
    }
  }, [getDateBounds, onRangeChangeEnd]);

  // Handle zoom selection using DATE-based percentages (not index-based)
  // This ensures the zoom matches the visual selection on the chart
  const handleZoomSelection = useCallback((startDate: string, endDate: string) => {
    userInteractedRef.current = true;

    const bounds = getDateBounds();
    if (!bounds) return;

    const totalMs = bounds.newest.getTime() - bounds.oldest.getTime();
    if (totalMs <= 0) return;

    // Parse the selected dates
    const startDateMs = new Date(startDate + 'T00:00:00').getTime();
    const endDateMs = new Date(endDate + 'T00:00:00').getTime();

    // Calculate date-based percentages
    let startPercent = (startDateMs - bounds.oldest.getTime()) / totalMs;
    let endPercent = (endDateMs - bounds.oldest.getTime()) / totalMs;

    // Clamp to valid range
    startPercent = Math.max(0, Math.min(1, startPercent));
    endPercent = Math.max(0, Math.min(1, endPercent));

    // Enforce minimum range
    const minRangePercent = (MIN_RANGE_DAYS * 24 * 60 * 60 * 1000) / totalMs;
    if (endPercent - startPercent < minRangePercent) {
      const midPercent = (startPercent + endPercent) / 2;
      startPercent = Math.max(0, midPercent - minRangePercent / 2);
      endPercent = Math.min(1, midPercent + minRangePercent / 2);

      if (startPercent === 0) {
        endPercent = Math.min(1, minRangePercent);
      } else if (endPercent === 1) {
        startPercent = Math.max(0, 1 - minRangePercent);
      }
    }

    setCustomRangeStart(startPercent);
    setCustomRangeEnd(endPercent);

    onDateRangeSelect?.(startDate, endDate);
    onVisibleRangeChange?.(startDate, endDate);
  }, [getDateBounds, onDateRangeSelect, onVisibleRangeChange]);

  // Handle reset range
  const handleResetRange = useCallback(() => {
    setCustomRangeStart(0);
    setCustomRangeEnd(1);

    if (onVisibleRangeChange) {
      const allDates = getAllDates();
      if (allDates.length > 0) {
        onVisibleRangeChange(allDates[0], allDates[allDates.length - 1]);
      }
    }
  }, [getAllDates, onVisibleRangeChange]);

  // Computed values
  const hasCustomRange = customRangeStart > 0 || customRangeEnd < 1;

  // Filter primary data using DATE-based calculations (not index-based)
  // This ensures visual consistency with overlay lines which also use date-based filtering
  const { filteredPrimaryData, trimmedPrimaryData } = useMemo<{
    filteredPrimaryData: PriceDataPoint[];
    trimmedPrimaryData: PriceDataPoint[];
  }>(() => {
    if (!primaryData?.prices || primaryData.prices.length === 0) {
      return { filteredPrimaryData: [], trimmedPrimaryData: [] };
    }

    const allPrices = primaryData.prices;
    if (customRangeStart === 0 && customRangeEnd === 1) {
      return { filteredPrimaryData: allPrices, trimmedPrimaryData: allPrices };
    }

    // Use global date bounds (union of all data sources) for consistent filtering
    const bounds = getDateBounds();
    if (!bounds) return { filteredPrimaryData: allPrices, trimmedPrimaryData: allPrices };

    const minDate = bounds.oldest.getTime();
    const maxDate = bounds.newest.getTime();
    const dateRange = maxDate - minDate;
    if (dateRange <= 0) return { filteredPrimaryData: allPrices, trimmedPrimaryData: allPrices };

    // Calculate target date range based on percentages
    const targetStartDate = minDate + customRangeStart * dateRange;
    const targetEndDate = minDate + customRangeEnd * dateRange;

    // Find indices of points within range
    let firstInRangeIdx = -1;
    let lastInRangeIdx = -1;

    for (let i = 0; i < allPrices.length; i++) {
      const pointDate = new Date(allPrices[i].date + 'T00:00:00').getTime();
      if (pointDate >= targetStartDate && pointDate <= targetEndDate) {
        if (firstInRangeIdx === -1) firstInRangeIdx = i;
        lastInRangeIdx = i;
      }
    }

    if (firstInRangeIdx === -1) {
      // No points in range - find the two points that bracket the range
      for (let i = 0; i < allPrices.length - 1; i++) {
        const currDate = new Date(allPrices[i].date + 'T00:00:00').getTime();
        const nextDate = new Date(allPrices[i + 1].date + 'T00:00:00').getTime();
        if (currDate < targetStartDate && nextDate > targetEndDate) {
          const bracket = [allPrices[i], allPrices[i + 1]];
          return { filteredPrimaryData: bracket, trimmedPrimaryData: bracket };
        }
      }
      return { filteredPrimaryData: [], trimmedPrimaryData: [] };
    }

    // Trimmed: exactly the in-range points (drives the label + % change).
    const trimmed = allPrices.slice(firstInRangeIdx, lastInRangeIdx + 1);

    // Padded: one point before and one after for smooth line edges (rendering).
    const startIdx = Math.max(0, firstInRangeIdx - 1);
    const endIdx = Math.min(allPrices.length - 1, lastInRangeIdx + 1);
    const padded = allPrices.slice(startIdx, endIdx + 1);

    return { filteredPrimaryData: padded, trimmedPrimaryData: trimmed };
  }, [primaryData?.prices, customRangeStart, customRangeEnd, getDateBounds]);

  const allPriceData = primaryData?.prices || [];

  // Apply custom range to overlay lines using DATE-based filtering (not index-based)
  // This ensures visual consistency between the chart (date-positioned) and range bar
  const rangeFilteredOverlayLines = useMemo((): OverlayLine[] | undefined => {
    if (!overlayLines || overlayLines.length === 0) return overlayLines;
    if (customRangeStart === 0 && customRangeEnd === 1) return overlayLines;

    const parseDate = (dateStr: string): number => {
      const quarterMatch = dateStr.match(/^(\d{4})-Q(\d)$/);
      if (quarterMatch) {
        const year = parseInt(quarterMatch[1]);
        const quarter = parseInt(quarterMatch[2]);
        const month = (quarter - 1) * 3 + 1;
        return new Date(year, month, 15).getTime();
      }
      // Handle year-only format
      const yearMatch = dateStr.match(/^(\d{4})$/);
      if (yearMatch) {
        return new Date(parseInt(yearMatch[1]), 6, 1).getTime();
      }
      return new Date(dateStr + 'T00:00:00').getTime();
    };

    // Use global date bounds (union of all data sources) for consistent filtering
    const bounds = getDateBounds();
    if (!bounds) return overlayLines;

    const minDate = bounds.oldest.getTime();
    const maxDate = bounds.newest.getTime();

    const dateRange = maxDate - minDate;
    if (dateRange <= 0) return overlayLines;

    // Calculate target date range based on percentages
    const targetStartDate = minDate + customRangeStart * dateRange;
    const targetEndDate = minDate + customRangeEnd * dateRange;

    return overlayLines.map((line) => {
      if (!line.data || line.data.length === 0) return line;

      // Sort data by date first
      const sortedData = [...line.data].sort((a, b) => parseDate(a.date) - parseDate(b.date));

      // Find indices of points within range, plus one before and one after
      let firstInRangeIdx = -1;
      let lastInRangeIdx = -1;

      for (let i = 0; i < sortedData.length; i++) {
        const pointDate = parseDate(sortedData[i].date);
        if (pointDate >= targetStartDate && pointDate <= targetEndDate) {
          if (firstInRangeIdx === -1) firstInRangeIdx = i;
          lastInRangeIdx = i;
        }
      }

      // If no points in range, check if the range falls between two points
      if (firstInRangeIdx === -1) {
        for (let i = 0; i < sortedData.length - 1; i++) {
          const currDate = parseDate(sortedData[i].date);
          const nextDate = parseDate(sortedData[i + 1].date);
          if (currDate < targetStartDate && nextDate > targetEndDate) {
            // Range falls between these two points - include both
            return { ...line, data: [sortedData[i], sortedData[i + 1]] };
          }
        }
        return { ...line, data: [] };
      }

      // Include one point before and one point after the visible range
      const startIdx = Math.max(0, firstInRangeIdx - 1);
      const endIdx = Math.min(sortedData.length - 1, lastInRangeIdx + 1);

      return {
        ...line,
        data: sortedData.slice(startIdx, endIdx + 1),
      };
    });
  }, [overlayLines, customRangeStart, customRangeEnd, getDateBounds]);

  const dateRangeLabel = useMemo(() => {
    if (trimmedPrimaryData.length < 2) return '';
    const start = trimmedPrimaryData[0].date;
    const end = trimmedPrimaryData[trimmedPrimaryData.length - 1].date;
    const formatDate = (d: string) => {
      const date = new Date(d + 'T00:00:00');
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    };
    return `${formatDate(start)} - ${formatDate(end)}`;
  }, [trimmedPrimaryData]);

  // Compute visible date range for filtering comparison data
  // Uses local time formatting to match how dates are parsed elsewhere (dateStr + 'T00:00:00')
  const visibleDateRange = useMemo((): { startDate: string; endDate: string } | null => {
    const bounds = getDateBounds();
    if (!bounds) return null;

    const totalMs = bounds.newest.getTime() - bounds.oldest.getTime();
    if (totalMs <= 0) return null;

    const startDateMs = bounds.oldest.getTime() + customRangeStart * totalMs;
    const endDateMs = bounds.oldest.getTime() + customRangeEnd * totalMs;

    // Format as YYYY-MM-DD in local time (not UTC) to match parsing elsewhere
    const formatLocalDate = (ms: number): string => {
      const d = new Date(ms);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    const startDate = formatLocalDate(startDateMs);
    const endDate = formatLocalDate(endDateMs);

    return { startDate, endDate };
  }, [getDateBounds, customRangeStart, customRangeEnd]);

  return {
    selectedRange,
    customRangeStart,
    customRangeEnd,
    hasCustomRange,
    dateRangeLabel,
    filteredPrimaryData,
    trimmedPrimaryData,
    allPriceData,
    rangeFilteredOverlayLines,
    visibleDateRange,
    handlePresetRangeChange,
    handleRangeBarChange,
    handleRangeBarChangeEnd,
    handleZoomSelection,
    handleResetRange,
    getAllDates,
  };
}
