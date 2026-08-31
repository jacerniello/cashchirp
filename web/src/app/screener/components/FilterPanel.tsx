'use client';

import { useState } from 'react';
import { Card } from './shared';
import {
  MARKET_CAP_RANGES,
  SCREEN_METRIC_GROUPS,
  ALL_SCREEN_METRICS,
  FILTER_PRESETS,
  type ScreenMetric,
  type FilterPreset,
} from '../constants';
import type { MarketCapRange } from '@/hooks/useScreener';

// A metric's current min/max state stores DISPLAY values: percents as whole
// numbers (10 = 10%), ratios raw. Convert a preset "lo:hi" (percents as decimals)
// into that display form so it round-trips through filterToParam unchanged.
function presetToMinMax(
  presetValue: string,
  isPercent: boolean
): { min: string; max: string } {
  if (!presetValue) return { min: '', max: '' };
  const [lo, hi] = presetValue.split(':');
  const conv = (v: string) => {
    if (!v) return '';
    const n = parseFloat(v);
    if (isNaN(n)) return '';
    return isPercent ? String(n * 100) : v;
  };
  return { min: conv(lo), max: conv(hi) };
}

// Given a metric's current min/max display state, find which preset (if any) it
// matches so the dropdown shows the right selection.
function minMaxToPresetValue(
  metric: ScreenMetric,
  current: { min: string; max: string } | undefined
): string {
  if (!current || (!current.min && !current.max)) return '';
  for (const opt of metric.presets) {
    if (!opt.value) continue;
    const mm = presetToMinMax(opt.value, metric.isPercent || false);
    if (mm.min === current.min && mm.max === current.max) return opt.value;
  }
  return '__custom__';
}

interface FilterPanelProps {
  selectedRange: MarketCapRange | null;
  selectedSector: string;
  selectedIndustry: string;
  selectedExchange: string;
  excludeCommodities: boolean;
  excludeBiotech: boolean;
  includeDelisted: boolean;
  filters: Record<string, { min: string; max: string }>;
  activePreset: string | null;
  hasActiveFilters: boolean;
  stats?: { ranges: Record<string, number> };
  sectorsData?: { sectors: string[]; industries: string[]; exchanges?: string[] };
  onRangeClick: (range: MarketCapRange) => void;
  onSectorChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  onIndustryChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  onExchangeChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  onToggle: (key: 'commod' | 'biotech' | 'delisted', value: boolean) => void;
  /** Set a metric's min/max directly (display values). */
  onMetricChange: (key: string, minMax: { min: string; max: string }) => void;
  onApplyPreset: (preset: FilterPreset) => void;
  onApplyFilters: () => void;
  onClearFilters: () => void;
}

export function FilterPanel({
  selectedRange,
  selectedSector,
  selectedIndustry,
  selectedExchange,
  excludeCommodities,
  excludeBiotech,
  includeDelisted,
  filters,
  activePreset,
  hasActiveFilters,
  stats,
  sectorsData,
  onRangeClick,
  onSectorChange,
  onIndustryChange,
  onExchangeChange,
  onToggle,
  onMetricChange,
  onApplyPreset,
  onApplyFilters,
  onClearFilters,
}: FilterPanelProps) {
  // Closed by default; open on mount only if the user arrived with active
  // fundamental filters (e.g. a preset or shared URL) so they aren't hidden.
  const [fundamentalsOpen, setFundamentalsOpen] = useState(() =>
    ALL_SCREEN_METRICS.some((m) => filters[m.key]?.min || filters[m.key]?.max)
  );

  const activeMetricCount = ALL_SCREEN_METRICS.filter(
    (m) => filters[m.key]?.min || filters[m.key]?.max
  ).length;

  return (
    <div className="space-y-4">
      {/* Quick presets */}
      <Card>
        <div className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-ink-light">Quick Presets</h3>
            {hasActiveFilters && (
              <button
                onClick={onClearFilters}
                className="text-sm font-medium text-ink-light hover:text-ink transition-colors"
              >
                Clear all
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {FILTER_PRESETS.map((preset) => {
              const isActive = activePreset === preset.key;
              return (
                <button
                  key={preset.key}
                  onClick={() => onApplyPreset(preset)}
                  title={preset.description}
                  className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-all ${
                    isActive
                      ? 'border-green bg-green-soft text-green-dark'
                      : 'border-rule text-ink hover:border-green-light hover:bg-surface'
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      {/* Descriptive filters: market cap, sector, industry */}
      <Card>
        <div className="p-4 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-ink-light mb-2">Market Cap</h3>
            <div className="flex flex-wrap gap-2">
              {MARKET_CAP_RANGES.map((range) => {
                const count = stats?.ranges[range.key] || 0;
                const isSelected = selectedRange === range.key;
                return (
                  <button
                    key={range.key}
                    onClick={() => onRangeClick(range.key)}
                    className={`px-3 py-1.5 rounded-lg border text-sm transition-all ${
                      isSelected
                        ? 'border-green bg-green-soft'
                        : 'border-rule hover:border-green-light hover:bg-surface'
                    }`}
                  >
                    <span className="font-medium text-ink">{range.label}</span>
                    <span className="text-xs text-ink-muted ml-1.5">
                      {count.toLocaleString()}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-semibold text-ink-light block mb-1.5">
                Sector
              </label>
              <select
                value={selectedSector}
                onChange={onSectorChange}
                className="w-full px-3 py-2 border border-rule rounded-lg text-sm text-ink bg-white focus:border-green focus:outline-none"
              >
                <option value="">All Sectors</option>
                {sectorsData?.sectors.map((sector) => (
                  <option key={sector} value={sector}>
                    {sector}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-semibold text-ink-light block mb-1.5">
                Industry
              </label>
              <select
                value={selectedIndustry}
                onChange={onIndustryChange}
                className="w-full px-3 py-2 border border-rule rounded-lg text-sm text-ink bg-white focus:border-green focus:outline-none"
              >
                <option value="">All Industries</option>
                {sectorsData?.industries.map((industry) => (
                  <option key={industry} value={industry}>
                    {industry}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-semibold text-ink-light block mb-1.5">
                Exchange
              </label>
              <select
                value={selectedExchange}
                onChange={onExchangeChange}
                className="w-full px-3 py-2 border border-rule rounded-lg text-sm text-ink bg-white focus:border-green focus:outline-none"
              >
                <option value="">All Exchanges</option>
                {sectorsData?.exchanges?.map((ex) => (
                  <option key={ex} value={ex}>
                    {ex}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Exclusion toggles (Dash: Excl. commodities / Excl. biotech / Incl. delisted) */}
          <div className="flex flex-wrap gap-x-6 gap-y-2 pt-1">
            <label className="flex items-center gap-2 text-sm text-ink cursor-pointer select-none">
              <input
                type="checkbox"
                checked={excludeCommodities}
                onChange={(e) => onToggle('commod', e.target.checked)}
                className="accent-green w-4 h-4"
              />
              Exclude commodities
            </label>
            <label className="flex items-center gap-2 text-sm text-ink cursor-pointer select-none">
              <input
                type="checkbox"
                checked={excludeBiotech}
                onChange={(e) => onToggle('biotech', e.target.checked)}
                className="accent-green w-4 h-4"
              />
              Exclude biotech/pharma
            </label>
            <label className="flex items-center gap-2 text-sm text-ink cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeDelisted}
                onChange={(e) => onToggle('delisted', e.target.checked)}
                className="accent-green w-4 h-4"
              />
              Include delisted
            </label>
          </div>
        </div>
      </Card>

      {/* Expandable fundamental-filter grid */}
      <Card>
        <button
          onClick={() => setFundamentalsOpen((o) => !o)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface transition-colors rounded-t-xl"
        >
          <div className="flex items-center gap-2">
            <span className="font-semibold text-ink">Fundamental filters</span>
            {activeMetricCount > 0 && (
              <span className="px-2 py-0.5 bg-green text-white text-xs font-semibold rounded-full">
                {activeMetricCount}
              </span>
            )}
          </div>
          <svg
            className={`w-5 h-5 text-ink-light transition-transform ${
              fundamentalsOpen ? 'rotate-180' : ''
            }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {fundamentalsOpen && (
          <div className="px-4 pb-4 pt-1 border-t border-rule space-y-5">
            {SCREEN_METRIC_GROUPS.map((group) => (
              <div key={group.title}>
                <h4 className="text-xs font-bold uppercase tracking-wide text-ink-light mb-2">
                  {group.title}
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {group.metrics.map((metric) => {
                    const current = filters[metric.key];
                    const selected = minMaxToPresetValue(metric, current);
                    return (
                      <div key={metric.key}>
                        <label className="text-xs text-ink-muted block mb-1 truncate" title={metric.label}>
                          {metric.label}
                        </label>
                        <select
                          value={selected === '__custom__' ? '' : selected}
                          onChange={(e) =>
                            onMetricChange(
                              metric.key,
                              presetToMinMax(e.target.value, metric.isPercent || false)
                            )
                          }
                          className="w-full px-2 py-1.5 border border-rule rounded text-sm text-ink bg-white focus:border-green focus:outline-none"
                        >
                          {metric.presets.map((opt, i) => (
                            <option key={`${metric.key}-${i}`} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                          {selected === '__custom__' && (
                            <option value="">Custom range</option>
                          )}
                        </select>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            <p className="text-xs text-ink-muted">
              Omitted (need analyst estimates, not in the Sharadar bundle): Forward
              P/E · PEG forward · EPS Growth Next Year/5Y · Earnings &amp; Revenue
              Surprise.
            </p>

            <div className="flex justify-end">
              <button
                onClick={onApplyFilters}
                className="py-2.5 px-6 bg-green text-white font-semibold rounded-lg hover:bg-green-dark transition-colors"
              >
                Apply Filters
              </button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
