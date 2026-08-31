'use client';

import { useState, useCallback, useRef, useMemo } from 'react';

interface ChartPoint {
  x: number;
  y: number;
  date: string;
  index: number;
}

interface DragSelection {
  startDate: string;
  endDate: string;
  startX: number;
  endX: number;
}

interface UseChartInteractionProps {
  points: ChartPoint[];
  chartWidth: number;
  paddingLeft: number;
  onDateRangeSelect?: (startDate: string, endDate: string) => void;
  onDateClick?: (date: string) => void;
  isHoverLocked?: boolean;
}

interface UseChartInteractionReturn {
  // Hover state
  hoveredIndex: number | null;
  hoveredPoint: ChartPoint | null;

  // Drag selection state
  isDragging: boolean;
  dragSelection: DragSelection | null;
  showDragConfirm: boolean;

  // Event handlers
  handleMouseMove: (e: React.MouseEvent<SVGSVGElement>) => void;
  handleMouseDown: (e: React.MouseEvent<SVGSVGElement>) => void;
  handleMouseUp: () => void;
  handleMouseLeave: () => void;

  // Drag confirmation actions
  confirmDragSelection: () => void;
  cancelDragSelection: () => void;
}

// Minimum pixel distance before considering it a drag (prevents accidental drags on click)
const MIN_DRAG_DISTANCE = 5;

export function useChartInteraction({
  points,
  chartWidth,
  paddingLeft,
  onDateRangeSelect,
  onDateClick,
  isHoverLocked = false,
}: UseChartInteractionProps): UseChartInteractionReturn {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const hoveredIndexRef = useRef<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  // Store DATES instead of indices so selection stays correct when data changes
  const [dragStartDate, setDragStartDate] = useState<string | null>(null);
  const [dragEndDate, setDragEndDate] = useState<string | null>(null);
  const [showDragConfirm, setShowDragConfirm] = useState(false);

  // Track potential drag start position for distance threshold
  const potentialDragRef = useRef<{ date: string; startX: number } | null>(null);

  // Use refs to avoid recreating callbacks when props change
  const pointsRef = useRef(points);
  const isHoverLockedRef = useRef(isHoverLocked);
  pointsRef.current = points;
  isHoverLockedRef.current = isHoverLocked;
  const chartWidthRef = useRef(chartWidth);
  chartWidthRef.current = chartWidth;
  const paddingLeftRef = useRef(paddingLeft);
  paddingLeftRef.current = paddingLeft;

  // Find closest point by x position using binary search
  // Works correctly for both evenly-distributed and sparse/gapped data
  const findClosestPointIndex = useCallback(
    (clientX: number, rect: DOMRect): number => {
      const currentPoints = pointsRef.current;

      if (currentPoints.length === 0) return 0;
      if (currentPoints.length === 1) return 0;

      const x = clientX - rect.left;

      // Binary search to find closest point by x position - O(log n)
      // This handles gaps in data (e.g., news timeline missing days without articles)
      let left = 0;
      let right = currentPoints.length - 1;

      while (left < right) {
        const mid = Math.floor((left + right) / 2);
        if (currentPoints[mid].x < x) {
          left = mid + 1;
        } else {
          right = mid;
        }
      }

      // Check if left or left-1 is closer
      if (left > 0) {
        const distLeft = Math.abs(currentPoints[left].x - x);
        const distPrev = Math.abs(currentPoints[left - 1].x - x);
        if (distPrev < distLeft) {
          return left - 1;
        }
      }

      return left;
    },
    [] // No dependencies - uses refs
  );

  // Find x position for a date in the current points array
  // Returns interpolated position if date is between points or at edges
  const findXForDate = useCallback((date: string, currentPoints: ChartPoint[]): number => {
    if (currentPoints.length === 0) return paddingLeftRef.current;
    if (currentPoints.length === 1) return currentPoints[0].x;

    const targetTime = new Date(date + 'T00:00:00').getTime();
    const firstTime = new Date(currentPoints[0].date + 'T00:00:00').getTime();
    const lastTime = new Date(currentPoints[currentPoints.length - 1].date + 'T00:00:00').getTime();

    // If date is before first point, extrapolate to left edge
    if (targetTime <= firstTime) {
      const timeRange = lastTime - firstTime;
      if (timeRange <= 0) return currentPoints[0].x;
      const ratio = (targetTime - firstTime) / timeRange;
      const xRange = currentPoints[currentPoints.length - 1].x - currentPoints[0].x;
      return currentPoints[0].x + ratio * xRange;
    }

    // If date is after last point, extrapolate to right edge
    if (targetTime >= lastTime) {
      const timeRange = lastTime - firstTime;
      if (timeRange <= 0) return currentPoints[currentPoints.length - 1].x;
      const ratio = (targetTime - firstTime) / timeRange;
      const xRange = currentPoints[currentPoints.length - 1].x - currentPoints[0].x;
      return currentPoints[0].x + ratio * xRange;
    }

    // Find the two points that bracket the target date
    for (let i = 0; i < currentPoints.length - 1; i++) {
      const currTime = new Date(currentPoints[i].date + 'T00:00:00').getTime();
      const nextTime = new Date(currentPoints[i + 1].date + 'T00:00:00').getTime();

      if (targetTime >= currTime && targetTime <= nextTime) {
        // Interpolate between the two points
        const ratio = (targetTime - currTime) / (nextTime - currTime);
        return currentPoints[i].x + ratio * (currentPoints[i + 1].x - currentPoints[i].x);
      }
    }

    // Fallback - shouldn't reach here
    return currentPoints[0].x;
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const currentPoints = pointsRef.current;
      if (currentPoints.length === 0) return;

      const rect = e.currentTarget.getBoundingClientRect();
      const currentX = e.clientX - rect.left;
      const index = findClosestPointIndex(e.clientX, rect);

      if (index >= 0 && index < currentPoints.length) {
        // Only update state if index actually changed to prevent re-render loops
        if (hoveredIndexRef.current !== index) {
          hoveredIndexRef.current = index;
          setHoveredIndex(index);
        }

        // Check if we should start dragging (distance threshold)
        if (potentialDragRef.current && !isDragging) {
          const distance = Math.abs(currentX - potentialDragRef.current.startX);
          if (distance >= MIN_DRAG_DISTANCE) {
            // Distance threshold met - start actual drag
            setIsDragging(true);
            setDragStartDate(potentialDragRef.current.date);
            setDragEndDate(currentPoints[index].date);
          }
        } else if (isDragging && dragStartDate !== null) {
          setDragEndDate(currentPoints[index].date);
        }
      }
    },
    [findClosestPointIndex, isDragging, dragStartDate]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const currentPoints = pointsRef.current;
      if (currentPoints.length === 0 || !onDateRangeSelect) return;

      // Clear any existing selection and confirmation
      setShowDragConfirm(false);
      setDragStartDate(null);
      setDragEndDate(null);

      const rect = e.currentTarget.getBoundingClientRect();
      const index = findClosestPointIndex(e.clientX, rect);
      const startX = e.clientX - rect.left;

      if (index >= 0 && index < currentPoints.length) {
        // Don't start drag immediately - wait for distance threshold
        // Store DATE instead of index
        potentialDragRef.current = { date: currentPoints[index].date, startX };
      }
    },
    [findClosestPointIndex, onDateRangeSelect]
  );

  const handleMouseUp = useCallback(() => {
    // Check if this was a single click (not a drag)
    const potentialClick = potentialDragRef.current;

    // Clear potential drag tracking
    potentialDragRef.current = null;

    if (isDragging && dragStartDate !== null && dragEndDate !== null) {
      // Only show confirm if selection spans different dates
      if (dragStartDate !== dragEndDate && onDateRangeSelect) {
        setShowDragConfirm(true);
      } else {
        setDragStartDate(null);
        setDragEndDate(null);
      }
    } else if (!isDragging && potentialClick && onDateClick) {
      // Single click (no drag occurred) - fire onDateClick
      onDateClick(potentialClick.date);
    }
    setIsDragging(false);
  }, [isDragging, dragStartDate, dragEndDate, onDateRangeSelect, onDateClick]);

  const handleMouseLeave = useCallback(() => {
    // Don't clear hover if locked (e.g., hovering over pinned tooltip header)
    // Use ref to avoid re-render loop from prop changes
    if (!isHoverLockedRef.current) {
      hoveredIndexRef.current = null;
      setHoveredIndex(null);
    }
    // Clear potential drag tracking on leave
    potentialDragRef.current = null;
    if (isDragging) {
      // Don't cancel if we have a selection in progress
      setIsDragging(false);
    }
  }, [isDragging]); // Removed isHoverLocked - using ref instead

  const confirmDragSelection = useCallback(() => {
    if (dragStartDate !== null && dragEndDate !== null && onDateRangeSelect) {
      // Sort dates to ensure start < end
      const [start, end] = [dragStartDate, dragEndDate].sort();
      onDateRangeSelect(start, end);
    }
    setDragStartDate(null);
    setDragEndDate(null);
    setShowDragConfirm(false);
  }, [dragStartDate, dragEndDate, onDateRangeSelect]);

  const cancelDragSelection = useCallback(() => {
    setDragStartDate(null);
    setDragEndDate(null);
    setShowDragConfirm(false);
  }, []);

  // Calculate drag selection bounds from dates
  // This recalculates x positions when points change, keeping selection at correct visual position
  const dragSelection: DragSelection | null = useMemo(() => {
    if (dragStartDate === null || dragEndDate === null) return null;

    // Sort dates to ensure start < end
    const [startDate, endDate] = [dragStartDate, dragEndDate].sort();

    return {
      startDate,
      endDate,
      startX: findXForDate(startDate, points),
      endX: findXForDate(endDate, points),
    };
  }, [dragStartDate, dragEndDate, points, findXForDate]);

  const hoveredPoint = hoveredIndex !== null ? points[hoveredIndex] : null;

  return {
    hoveredIndex,
    hoveredPoint,
    isDragging,
    dragSelection,
    showDragConfirm,
    handleMouseMove,
    handleMouseDown,
    handleMouseUp,
    handleMouseLeave,
    confirmDragSelection,
    cancelDragSelection,
  };
}
