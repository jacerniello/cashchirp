'use client';

import { useState, useCallback, useEffect } from 'react';

export type ChartMode = 'line' | 'ohlc';
export type CursorMode = 'crosshair' | 'dot';
export type DateFormat = 'full' | 'month';
export type PriceType = 'adjusted' | 'actual';
export type ComparisonScaleMode = 'percentage' | 'independent';

interface PriceChartSettings {
  // Display modes
  chartMode: ChartMode;
  cursorMode: CursorMode;
  dateFormat: DateFormat;
  priceType: PriceType;

  // Visibility toggles
  showVolume: boolean;
  showCorporateActions: boolean;
  showFill: boolean;

  // Size settings
  labelSize: number;
  dotScale: number;
  dotScaleMode: 'logarithmic' | 'linear';

  // Comparison settings
  comparisonScaleMode: ComparisonScaleMode;

  // Tooltip settings
  pinnedTooltip: boolean;
}

interface UsePriceChartSettingsReturn extends PriceChartSettings {
  // Setters
  setChartMode: (mode: ChartMode) => void;
  setCursorMode: (mode: CursorMode) => void;
  setDateFormat: (format: DateFormat) => void;
  setPriceType: (type: PriceType) => void;
  setShowVolume: (show: boolean) => void;
  setShowCorporateActions: (show: boolean) => void;
  setShowFill: (show: boolean) => void;
  setLabelSize: (size: number) => void;
  setDotScale: (scale: number) => void;
  setDotScaleMode: (mode: 'logarithmic' | 'linear') => void;
  setComparisonScaleMode: (mode: ComparisonScaleMode) => void;
  setPinnedTooltip: (pinned: boolean) => void;

  // Toggles (convenience)
  toggleChartMode: () => void;
  toggleCursorMode: () => void;
  toggleDateFormat: () => void;
  togglePriceType: () => void;
  toggleVolume: () => void;
  toggleCorporateActions: () => void;
  toggleFill: () => void;
  toggleDotScaleMode: () => void;
  toggleComparisonScaleMode: () => void;
  togglePinnedTooltip: () => void;
}

const STORAGE_KEY = 'priceChartSettings';

const defaultSettings: PriceChartSettings = {
  chartMode: 'line',
  cursorMode: 'crosshair',
  dateFormat: 'full',
  priceType: 'adjusted',
  showVolume: false,
  showCorporateActions: true,
  showFill: false,
  labelSize: 13,
  dotScale: 1.0,
  dotScaleMode: 'logarithmic',
  comparisonScaleMode: 'independent',
  pinnedTooltip: false,
};

function loadSettings(): PriceChartSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return { ...defaultSettings, ...JSON.parse(stored) };
    }
  } catch {
    // Ignore localStorage errors
  }
  return defaultSettings;
}

function saveSettings(settings: PriceChartSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore localStorage errors
  }
}

export function usePriceChartSettings(
  initialOverrides?: Partial<PriceChartSettings>
): UsePriceChartSettingsReturn {
  const [settings, setSettings] = useState<PriceChartSettings>(() => ({
    ...loadSettings(),
    ...initialOverrides,
  }));

  // Persist settings to localStorage
  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  // Individual setters
  const setChartMode = useCallback((mode: ChartMode) => {
    setSettings((prev) => ({ ...prev, chartMode: mode }));
  }, []);

  const setCursorMode = useCallback((mode: CursorMode) => {
    setSettings((prev) => ({ ...prev, cursorMode: mode }));
  }, []);

  const setDateFormat = useCallback((format: DateFormat) => {
    setSettings((prev) => ({ ...prev, dateFormat: format }));
  }, []);

  const setPriceType = useCallback((type: PriceType) => {
    setSettings((prev) => ({ ...prev, priceType: type }));
  }, []);

  const setShowVolume = useCallback((show: boolean) => {
    setSettings((prev) => ({ ...prev, showVolume: show }));
  }, []);

  const setShowCorporateActions = useCallback((show: boolean) => {
    setSettings((prev) => ({ ...prev, showCorporateActions: show }));
  }, []);

  const setShowFill = useCallback((show: boolean) => {
    setSettings((prev) => ({ ...prev, showFill: show }));
  }, []);

  const setLabelSize = useCallback((size: number) => {
    setSettings((prev) => ({ ...prev, labelSize: Math.max(10, Math.min(20, size)) }));
  }, []);

  const setDotScale = useCallback((scale: number) => {
    setSettings((prev) => ({ ...prev, dotScale: Math.max(0.5, Math.min(2.0, scale)) }));
  }, []);

  const setDotScaleMode = useCallback((mode: 'logarithmic' | 'linear') => {
    setSettings((prev) => ({ ...prev, dotScaleMode: mode }));
  }, []);

  // Toggle helpers
  const toggleChartMode = useCallback(() => {
    setSettings((prev) => ({ ...prev, chartMode: prev.chartMode === 'line' ? 'ohlc' : 'line' }));
  }, []);

  const toggleCursorMode = useCallback(() => {
    setSettings((prev) => ({ ...prev, cursorMode: prev.cursorMode === 'crosshair' ? 'dot' : 'crosshair' }));
  }, []);

  const toggleDateFormat = useCallback(() => {
    setSettings((prev) => ({ ...prev, dateFormat: prev.dateFormat === 'full' ? 'month' : 'full' }));
  }, []);

  const togglePriceType = useCallback(() => {
    setSettings((prev) => ({ ...prev, priceType: prev.priceType === 'adjusted' ? 'actual' : 'adjusted' }));
  }, []);

  const toggleVolume = useCallback(() => {
    setSettings((prev) => ({ ...prev, showVolume: !prev.showVolume }));
  }, []);

  const toggleCorporateActions = useCallback(() => {
    setSettings((prev) => ({ ...prev, showCorporateActions: !prev.showCorporateActions }));
  }, []);

  const toggleFill = useCallback(() => {
    setSettings((prev) => ({ ...prev, showFill: !prev.showFill }));
  }, []);

  const toggleDotScaleMode = useCallback(() => {
    setSettings((prev) => ({
      ...prev,
      dotScaleMode: prev.dotScaleMode === 'logarithmic' ? 'linear' : 'logarithmic',
    }));
  }, []);

  const setComparisonScaleMode = useCallback((mode: ComparisonScaleMode) => {
    setSettings((prev) => ({ ...prev, comparisonScaleMode: mode }));
  }, []);

  const toggleComparisonScaleMode = useCallback(() => {
    setSettings((prev) => ({
      ...prev,
      comparisonScaleMode: prev.comparisonScaleMode === 'percentage' ? 'independent' : 'percentage',
    }));
  }, []);

  const setPinnedTooltip = useCallback((pinned: boolean) => {
    setSettings((prev) => ({ ...prev, pinnedTooltip: pinned }));
  }, []);

  const togglePinnedTooltip = useCallback(() => {
    setSettings((prev) => ({ ...prev, pinnedTooltip: !prev.pinnedTooltip }));
  }, []);

  return {
    ...settings,
    setChartMode,
    setCursorMode,
    setDateFormat,
    setPriceType,
    setShowVolume,
    setShowCorporateActions,
    setShowFill,
    setLabelSize,
    setDotScale,
    setDotScaleMode,
    setComparisonScaleMode,
    toggleChartMode,
    toggleCursorMode,
    toggleDateFormat,
    togglePriceType,
    toggleVolume,
    toggleCorporateActions,
    toggleFill,
    toggleDotScaleMode,
    toggleComparisonScaleMode,
    setPinnedTooltip,
    togglePinnedTooltip,
  };
}
