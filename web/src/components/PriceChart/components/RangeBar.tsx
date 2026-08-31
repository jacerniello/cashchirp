'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

interface RangeBarProps {
  rangeStart: number; // 0-1 percentage
  rangeEnd: number; // 0-1 percentage
  onRangeChange: (start: number, end: number) => void;
  onRangeChangeEnd?: (start: number, end: number) => void; // Fires only when drag ends
  height?: number;
}

export function RangeBar({
  rangeStart,
  rangeEnd,
  onRangeChange,
  onRangeChangeEnd,
  height = 40,
}: RangeBarProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState<'left' | 'right' | null>(null);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent, handle: 'left' | 'right') => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      setIsDragging(handle);
    },
    []
  );

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      if (!isDragging || !containerRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      const newRatio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));

      if (isDragging === 'left') {
        // Allow handles to swap if dragged past each other
        if (newRatio > rangeEnd) {
          onRangeChange(rangeEnd, newRatio);
          setIsDragging('right');
        } else {
          onRangeChange(newRatio, rangeEnd);
        }
      } else {
        if (newRatio < rangeStart) {
          onRangeChange(newRatio, rangeStart);
          setIsDragging('left');
        } else {
          onRangeChange(rangeStart, newRatio);
        }
      }
    },
    [isDragging, rangeStart, rangeEnd, onRangeChange]
  );

  const handlePointerUp = useCallback(() => {
    if (isDragging) {
      onRangeChangeEnd?.(rangeStart, rangeEnd);
    }
    setIsDragging(null);
  }, [isDragging, rangeStart, rangeEnd, onRangeChangeEnd]);

  // Global pointer events for dragging
  useEffect(() => {
    if (isDragging) {
      document.addEventListener('pointermove', handlePointerMove);
      document.addEventListener('pointerup', handlePointerUp);
      document.addEventListener('pointercancel', handlePointerUp);
      return () => {
        document.removeEventListener('pointermove', handlePointerMove);
        document.removeEventListener('pointerup', handlePointerUp);
        document.removeEventListener('pointercancel', handlePointerUp);
      };
    }
  }, [isDragging, handlePointerMove, handlePointerUp]);

  // Clamp handle positions to stay fully visible within container
  // Left handle: clamp so it doesn't go below 0
  // Right handle: clamp so it doesn't go past 100%
  const leftPercent = Math.max(0, rangeStart * 100);
  const rightPercent = Math.min(100, rangeEnd * 100);

  // Check if handles are close together (for vertical stacking)
  const containerWidth = containerRef.current?.offsetWidth || 400;
  const leftPos = rangeStart * containerWidth;
  const rightPos = rangeEnd * containerWidth;
  const distance = rightPos - leftPos;
  const threshold = 32;
  const handlesClose = distance < threshold;

  return (
    <div
      ref={containerRef}
      className="relative bg-surface rounded-lg select-none mx-2 overflow-visible"
      style={{ height }}
    >
      {/* Selection highlight */}
      <div
        className="absolute top-0 h-full bg-green-soft pointer-events-none rounded-lg"
        style={{
          left: `${leftPercent}%`,
          width: `${rightPercent - leftPercent}%`,
        }}
      />

      {/* Left handle - centered on left edge of selection */}
      <div
        className={`absolute w-5 bg-green rounded cursor-ew-resize hover:bg-green-dark touch-none z-10 ${
          isDragging === 'left' ? 'bg-green-dark' : ''
        } ${handlesClose ? 'top-0 h-1/2' : 'top-0 bottom-0'}`}
        style={{
          left: `calc(${leftPercent}% - 10px)`,
          height: handlesClose ? '50%' : '100%',
        }}
        onPointerDown={(e) => handlePointerDown(e, 'left')}
      />

      {/* Right handle - centered on right edge of selection */}
      <div
        className={`absolute w-5 bg-green rounded cursor-ew-resize hover:bg-green-dark touch-none z-10 ${
          isDragging === 'right' ? 'bg-green-dark' : ''
        } ${handlesClose ? 'bottom-0 h-1/2' : 'top-0 bottom-0'}`}
        style={{
          left: `calc(${rightPercent}% - 10px)`,
          height: handlesClose ? '50%' : '100%',
        }}
        onPointerDown={(e) => handlePointerDown(e, 'right')}
      />
    </div>
  );
}
