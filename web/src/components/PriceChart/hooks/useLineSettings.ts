'use client';

import { useState, useCallback } from 'react';

export interface LineConfig {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  fill: boolean;
  showDots: boolean;
  scale: 'combined' | 'individual';
  smoothing: number; // 1 = none, 7/14/30/90 = days
  strokeWidth: number;
  dashed: boolean;
}

interface UseLineSettingsReturn {
  lines: Map<string, LineConfig>;

  // Line management
  addLine: (id: string, config: Partial<LineConfig>) => void;
  removeLine: (id: string) => void;
  updateLine: (id: string, updates: Partial<LineConfig>) => void;
  clearAllLines: () => void;

  // Convenience toggles
  toggleLineVisibility: (id: string) => void;
  toggleLineFill: (id: string) => void;
  toggleLineDots: (id: string) => void;
  setLineColor: (id: string, color: string) => void;
  setLineScale: (id: string, scale: 'combined' | 'individual') => void;
  setLineSmoothing: (id: string, smoothing: number) => void;

  // Get visible lines
  visibleLines: LineConfig[];
  hiddenLines: LineConfig[];
}

const DEFAULT_COLORS = [
  '#3b82f6', // blue
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // purple
  '#ec4899', // pink
  '#14b8a6', // teal
  '#84cc16', // lime
];

function getDefaultColor(index: number): string {
  return DEFAULT_COLORS[index % DEFAULT_COLORS.length];
}

export function useLineSettings(): UseLineSettingsReturn {
  const [lines, setLines] = useState<Map<string, LineConfig>>(new Map());

  const addLine = useCallback((id: string, config: Partial<LineConfig>) => {
    setLines((prev) => {
      // If line already exists, don't overwrite it (preserve user settings)
      if (prev.has(id)) {
        return prev;
      }

      const next = new Map(prev);
      const existingCount = next.size;

      next.set(id, {
        id,
        name: config.name || id,
        color: config.color || getDefaultColor(existingCount),
        visible: config.visible !== false,
        fill: config.fill || false,
        showDots: config.showDots || false,
        scale: config.scale || 'combined',
        smoothing: config.smoothing || 1,
        strokeWidth: config.strokeWidth || 2,
        dashed: config.dashed || false,
      });

      return next;
    });
  }, []);

  const removeLine = useCallback((id: string) => {
    setLines((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const updateLine = useCallback((id: string, updates: Partial<LineConfig>) => {
    setLines((prev) => {
      const existing = prev.get(id);
      if (!existing) return prev;

      const next = new Map(prev);
      next.set(id, { ...existing, ...updates });
      return next;
    });
  }, []);

  const clearAllLines = useCallback(() => {
    setLines(new Map());
  }, []);

  const toggleLineVisibility = useCallback((id: string) => {
    setLines((prev) => {
      const existing = prev.get(id);
      if (!existing) return prev;

      const next = new Map(prev);
      next.set(id, { ...existing, visible: !existing.visible });
      return next;
    });
  }, []);

  const toggleLineFill = useCallback((id: string) => {
    setLines((prev) => {
      const existing = prev.get(id);
      if (!existing) return prev;

      const next = new Map(prev);
      next.set(id, { ...existing, fill: !existing.fill });
      return next;
    });
  }, []);

  const toggleLineDots = useCallback((id: string) => {
    setLines((prev) => {
      const existing = prev.get(id);
      if (!existing) return prev;

      const next = new Map(prev);
      next.set(id, { ...existing, showDots: !existing.showDots });
      return next;
    });
  }, []);

  const setLineColor = useCallback((id: string, color: string) => {
    setLines((prev) => {
      const existing = prev.get(id);
      if (!existing) return prev;

      const next = new Map(prev);
      next.set(id, { ...existing, color });
      return next;
    });
  }, []);

  const setLineScale = useCallback((id: string, scale: 'combined' | 'individual') => {
    setLines((prev) => {
      const existing = prev.get(id);
      if (!existing) return prev;

      const next = new Map(prev);
      next.set(id, { ...existing, scale });
      return next;
    });
  }, []);

  const setLineSmoothing = useCallback((id: string, smoothing: number) => {
    setLines((prev) => {
      const existing = prev.get(id);
      if (!existing) return prev;

      const next = new Map(prev);
      next.set(id, { ...existing, smoothing });
      return next;
    });
  }, []);

  const allLines = Array.from(lines.values());
  const visibleLines = allLines.filter((l) => l.visible);
  const hiddenLines = allLines.filter((l) => !l.visible);

  return {
    lines,
    addLine,
    removeLine,
    updateLine,
    clearAllLines,
    toggleLineVisibility,
    toggleLineFill,
    toggleLineDots,
    setLineColor,
    setLineScale,
    setLineSmoothing,
    visibleLines,
    hiddenLines,
  };
}
