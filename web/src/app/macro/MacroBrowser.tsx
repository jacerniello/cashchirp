'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Spinner } from '@/components/Loading';
import { ValuationLineChart } from '@/components/charts/ValuationLineChart';

export interface MacroSeries {
  series_id: string;
  dataset: string;
  title: string | null;
  tcode: number | null;
  transform: string | null;
  fred_code: string | null;
  fred_url: string | null;
}

interface SeriesResponse {
  series: MacroSeries[];
  datasets: string[];
}

interface Observation {
  date: string;
  value: number | null;
}

interface ObservationsResponse {
  series_id: string;
  title: string | null;
  vintage: string | null;
  observations: Observation[];
}

interface VintagesResponse {
  series_id: string;
  vintages: string[];
}

async function fetchSeries(dataset?: string): Promise<SeriesResponse> {
  const res = await api.get('/macro/series', {
    params: dataset ? { dataset } : undefined,
  });
  return res.data;
}

async function fetchObservations(
  seriesId: string,
  vintage?: string | null
): Promise<ObservationsResponse> {
  const res = await api.get('/macro/observations', {
    params: vintage ? { series_id: seriesId, vintage } : { series_id: seriesId },
  });
  return res.data;
}

async function fetchVintages(seriesId: string): Promise<VintagesResponse> {
  const res = await api.get('/macro/vintages', { params: { series_id: seriesId } });
  return res.data;
}

interface MacroBrowserProps {
  /** When set, only show series from this dataset; otherwise exclude FRED-Spot. */
  dataset?: string;
  /** Exclude these datasets from the full list (used for the Macro page). */
  excludeDatasets?: string[];
  title: string;
  subtitle: string;
  /** Small caption rendered under the chart (e.g. point-in-time note). */
  chartCaption?: string;
  emptyMessage?: string;
  /**
   * Show the point-in-time vintage selector. FRED-MD/QD series are revised, so the
   * Macro page lets you pin a release (backtest-safe). FRED-Spot market prices are
   * revision-free, so the Commodities page hides it.
   */
  showVintages?: boolean;
}

export function MacroBrowser({
  dataset,
  excludeDatasets = [],
  title,
  subtitle,
  chartCaption,
  emptyMessage = 'Pick a series to chart it.',
  showVintages = false,
}: MacroBrowserProps) {
  const { data: seriesData, isLoading: seriesLoading } = useQuery({
    queryKey: ['macro-series', dataset ?? 'all'],
    queryFn: () => fetchSeries(dataset),
    staleTime: 5 * 60 * 1000,
  });

  const [datasetFilter, setDatasetFilter] = useState<string>('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  // null = latest-per-date snapshot (most revised); a string pins that release.
  const [vintage, setVintage] = useState<string | null>(null);

  const allSeries = useMemo(() => {
    let list = seriesData?.series ?? [];
    if (excludeDatasets.length) {
      list = list.filter((s) => !excludeDatasets.includes(s.dataset));
    }
    return list;
  }, [seriesData, excludeDatasets]);

  // Dataset chips to offer (only relevant on the multi-dataset macro page).
  const datasetOptions = useMemo(() => {
    const set = new Set(allSeries.map((s) => s.dataset));
    return Array.from(set).sort();
  }, [allSeries]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allSeries.filter((s) => {
      if (datasetFilter && s.dataset !== datasetFilter) return false;
      if (!q) return true;
      return (
        s.series_id.toLowerCase().includes(q) ||
        (s.title ?? '').toLowerCase().includes(q)
      );
    });
  }, [allSeries, search, datasetFilter]);

  const selectedSeries = useMemo(
    () => allSeries.find((s) => s.series_id === selected) ?? null,
    [allSeries, selected]
  );

  // Reset the vintage pin whenever the series changes (a vintage is series-specific).
  const handleSelect = (seriesId: string) => {
    setSelected(seriesId);
    setVintage(null);
  };

  const { data: vintagesData } = useQuery({
    queryKey: ['macro-vintages', selected],
    queryFn: () => fetchVintages(selected as string),
    enabled: showVintages && !!selected,
    staleTime: 5 * 60 * 1000,
  });
  const vintageOptions = vintagesData?.vintages ?? [];

  const { data: obsData, isLoading: obsLoading } = useQuery({
    queryKey: ['macro-observations', selected, vintage],
    queryFn: () => fetchObservations(selected as string, vintage),
    enabled: !!selected,
    staleTime: 5 * 60 * 1000,
  });

  const chartData = useMemo(
    () =>
      (obsData?.observations ?? []).map((o) => ({
        date: o.date,
        value: o.value,
      })),
    [obsData]
  );

  return (
    <div className="max-w-[1200px] mx-auto py-10 px-5 md:py-12 md:px-6">
      <div className="mb-8">
        <h1 className="text-2xl md:text-3xl font-bold text-ink tracking-tight">{title}</h1>
        <p className="text-ink-muted mt-1 max-w-3xl">{subtitle}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6 items-start">
        {/* Series list / sidebar */}
        <Card variant="compact" className="lg:sticky lg:top-6">
          <div className="space-y-3">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search series…"
              className="w-full px-3 py-2 text-sm border border-rule rounded-lg focus:outline-none focus:ring-2 focus:ring-green focus:border-transparent bg-white"
            />

            {datasetOptions.length > 1 && (
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setDatasetFilter('')}
                  className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                    datasetFilter === ''
                      ? 'bg-green text-white border-green'
                      : 'border-rule text-ink-muted hover:bg-surface'
                  }`}
                >
                  All
                </button>
                {datasetOptions.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDatasetFilter(d)}
                    className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                      datasetFilter === d
                        ? 'bg-green text-white border-green'
                        : 'border-rule text-ink-muted hover:bg-surface'
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            )}

            <div className="text-xs text-ink-muted">
              {seriesLoading ? 'Loading…' : `${filtered.length} series`}
            </div>

            <div className="max-h-[60vh] overflow-y-auto -mx-1 px-1 divide-y divide-rule-light">
              {seriesLoading && (
                <div className="flex items-center gap-2 py-6 text-ink-muted text-sm">
                  <Spinner /> Loading series…
                </div>
              )}
              {!seriesLoading &&
                filtered.map((s) => {
                  const active = s.series_id === selected;
                  return (
                    <button
                      key={`${s.dataset}-${s.series_id}`}
                      type="button"
                      onClick={() => handleSelect(s.series_id)}
                      className={`w-full text-left py-2 px-2 rounded-md transition-colors ${
                        active ? 'bg-green/10' : 'hover:bg-surface'
                      }`}
                    >
                      <div
                        className={`text-sm font-medium ${
                          active ? 'text-green' : 'text-ink'
                        }`}
                      >
                        {s.series_id}
                      </div>
                      <div className="text-xs text-ink-muted line-clamp-2">
                        {s.title ?? '—'}
                      </div>
                    </button>
                  );
                })}
              {!seriesLoading && filtered.length === 0 && (
                <div className="py-6 text-sm text-ink-muted">No series match.</div>
              )}
            </div>
          </div>
        </Card>

        {/* Chart panel */}
        <Card>
          {!selected && (
            <EmptyState
              iconName="folder"
              title="No series selected"
              description={emptyMessage}
            />
          )}

          {selected && (
            <div>
              <div className="mb-4">
                <div className="flex items-baseline justify-between gap-4 flex-wrap">
                  <h2 className="text-lg font-bold text-ink">
                    {selectedSeries?.series_id}
                    {selectedSeries?.title ? (
                      <span className="font-normal text-ink-muted">
                        {' '}
                        — {selectedSeries.title}
                      </span>
                    ) : null}
                  </h2>
                  {selectedSeries?.fred_url && (
                    <a
                      href={selectedSeries.fred_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm text-green hover:text-green-dark font-medium whitespace-nowrap"
                    >
                      FRED ↗
                    </a>
                  )}
                </div>
                {selectedSeries?.transform && (
                  <p className="text-xs text-ink-muted mt-1">
                    Transform: {selectedSeries.transform}
                  </p>
                )}

                {showVintages && vintageOptions.length > 0 && (
                  <div className="mt-3 flex items-center gap-2">
                    <label
                      htmlFor="macro-vintage"
                      className="text-xs font-medium text-ink-muted whitespace-nowrap"
                    >
                      Vintage
                    </label>
                    <select
                      id="macro-vintage"
                      value={vintage ?? ''}
                      onChange={(e) => setVintage(e.target.value || null)}
                      className="px-2.5 py-1 text-xs border border-rule rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-green"
                    >
                      <option value="">Latest (most revised)</option>
                      {vintageOptions.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                    <span className="text-[11px] text-ink-light">
                      {vintage
                        ? `Point-in-time: as published ${vintage}`
                        : 'Latest-per-date snapshot'}
                    </span>
                  </div>
                )}
              </div>

              {obsLoading ? (
                <div className="h-[340px] flex items-center justify-center gap-2 text-ink-muted">
                  <Spinner /> Loading observations…
                </div>
              ) : chartData.length === 0 ? (
                <EmptyState
                  variant="inline"
                  message={`No observations for ${selected}`}
                />
              ) : (
                <ValuationLineChart
                  data={chartData}
                  title={`${selectedSeries?.title ?? selected}${
                    showVintages
                      ? vintage
                        ? `  ·  vintage ${vintage}`
                        : '  ·  latest'
                      : ''
                  }`}
                  format="ratio"
                />
              )}

              {chartCaption && (
                <p className="text-xs text-ink-muted mt-3">{chartCaption}</p>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
