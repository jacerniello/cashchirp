'use client';

import { memo, useMemo, useRef, useCallback } from 'react';
import type { Chart as ChartJS, ChartOptions, Plugin } from 'chart.js';
import { Line, Bar } from 'react-chartjs-2';
// Importing chart-utils registers chart.js components (side effect).
import { MULTI_SERIES_COLORS } from '@/lib/chart-utils';
import { exportChartJsAsPng } from '@/lib/chart-export';
import { ExportButton } from '@/components/charts/ExportButton';
import { MultiLineChart } from '@/components/charts/MultiLineChart';
import type { DDChart, ChartYFormat } from '@/components/dd/types';

// ---- value formatting --------------------------------------------------------------------

function makeFormatter(fmt: ChartYFormat | undefined): (v: number) => string {
  switch (fmt) {
    case 'percent':
      return (v) => `${(Math.abs(v) <= 3 ? v * 100 : v).toFixed(1)}%`;
    case 'currency':
      return (v) => {
        const a = Math.abs(v);
        if (a >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
        if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
        if (a >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
        return `$${v.toFixed(2)}`;
      };
    case 'ratio':
      return (v) => v.toFixed(1) + '×';
    default:
      return (v) => v.toLocaleString('en-US');
  }
}

function shortDate(d: string): string {
  const [y, m] = d.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (!m) return y;
  return `${months[parseInt(m, 10) - 1]} '${y.slice(2)}`;
}

const MARKER_COLOR: Record<string, string> = {
  pos: '#16a34a',
  neg: '#dc2626',
  neutral: '#64748b',
};

// ---- price + catalyst-marker chart -------------------------------------------------------

// Draws vertical rules at catalyst dates over a price line. Reads its config off
// chart.options.plugins.ddMarkers (kept stable across renders, like zoneBandsPlugin).
const ddMarkersPlugin: Plugin<'line'> = {
  id: 'ddMarkers',
  afterDatasetsDraw(chart) {
    const cfg = (chart.options.plugins as { ddMarkers?: { items?: { index: number; tone: string; label: string }[] } } | undefined)
      ?.ddMarkers;
    const items = cfg?.items;
    const x = chart.scales.x;
    if (!items?.length || !x) return;
    const { ctx, chartArea } = chart;
    ctx.save();
    for (const it of items) {
      const px = x.getPixelForValue(it.index);
      if (px == null || Number.isNaN(px)) continue;
      const color = MARKER_COLOR[it.tone] ?? MARKER_COLOR.neutral;
      ctx.beginPath();
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = color;
      ctx.moveTo(px, chartArea.top);
      ctx.lineTo(px, chartArea.bottom);
      ctx.stroke();
      // small colored dot at the top of the rule
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.fillStyle = color;
      ctx.arc(px, chartArea.top + 3, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  },
};

const PriceCatalystChart = memo(function PriceCatalystChart({ chart }: { chart: DDChart }) {
  const ref = useRef<ChartJS<'line'>>(null);
  const fmt = useMemo(() => makeFormatter(chart.yFormat ?? 'currency'), [chart.yFormat]);
  const series = chart.series?.[0];

  const { labels, values, markerItems } = useMemo(() => {
    const pts = [...(series?.points ?? [])].sort((a, b) => a.date.localeCompare(b.date));
    const labels = pts.map((p) => p.date);
    const values = pts.map((p) => p.value);
    // Map each marker to the nearest price-date index.
    const markerItems = (chart.markers ?? []).map((mk) => {
      let idx = labels.findIndex((d) => d >= mk.date);
      if (idx < 0) idx = labels.length - 1;
      return { index: Math.max(0, idx), tone: mk.tone ?? 'neutral', label: mk.label };
    });
    return { labels, values, markerItems };
  }, [series, chart.markers]);

  const handleExport = useCallback(async () => {
    await exportChartJsAsPng(ref, chart.title, undefined, chart.title);
  }, [chart.title]);

  const data = useMemo(
    () => ({
      labels: labels.map(shortDate),
      datasets: [
        {
          label: series?.label ?? 'Price',
          data: values,
          borderColor: '#111111',
          backgroundColor: '#111111',
          borderWidth: 1.5,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0,
          fill: false,
          spanGaps: true,
        },
      ],
    }),
    [labels, values, series]
  );

  const options = useMemo<ChartOptions<'line'>>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        // consumed by ddMarkersPlugin
        ...({ ddMarkers: { items: markerItems } } as object),
        tooltip: {
          callbacks: { label: (c) => (c.parsed.y == null ? '' : fmt(Number(c.parsed.y))) },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 10 }, color: '#475569', maxTicksLimit: 8, autoSkip: true } },
        y: {
          grid: { color: '#f1f5f9' },
          ticks: { font: { size: 10 }, color: '#475569', callback: (v) => fmt(Number(v)) },
        },
      },
    }),
    [fmt, markerItems]
  );

  const hasData = values.some((v) => v != null);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-semibold text-ink">{chart.title}</h4>
        {hasData && <ExportButton onExport={handleExport} />}
      </div>
      <div className="h-[320px]">
        {hasData ? (
          <Line ref={ref} data={data} options={options} plugins={[ddMarkersPlugin]} />
        ) : (
          <div className="flex items-center justify-center h-full text-ink-faint text-sm">No data</div>
        )}
      </div>
      {/* Catalyst legend — dated, colored by tone, since the markers themselves are terse. */}
      {chart.markers && chart.markers.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {chart.markers.map((mk, i) => (
            <li key={i} className="flex items-center gap-1.5">
              <span
                className="inline-block w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: MARKER_COLOR[mk.tone ?? 'neutral'] ?? MARKER_COLOR.neutral }}
              />
              <span className="text-ink-muted">{shortDate(mk.date)}</span>
              <span className="text-ink-light">{mk.label}</span>
            </li>
          ))}
        </ul>
      )}
      {chart.note && <p className="mt-2 text-xs text-ink-faint">{chart.note}</p>}
    </div>
  );
});

// ---- grouped bars (actual vs estimate) ---------------------------------------------------

const BarsChart = memo(function BarsChart({ chart }: { chart: DDChart }) {
  const ref = useRef<ChartJS<'bar'>>(null);
  const fmt = useMemo(() => makeFormatter(chart.yFormat), [chart.yFormat]);

  const handleExport = useCallback(async () => {
    await exportChartJsAsPng(ref as never, chart.title, undefined, chart.title);
  }, [chart.title]);

  const data = useMemo(
    () => ({
      labels: chart.categories ?? [],
      datasets: (chart.series ?? []).map((s, i) => ({
        label: s.label,
        data: s.values ?? [],
        backgroundColor: s.color ?? MULTI_SERIES_COLORS[i % MULTI_SERIES_COLORS.length],
        borderRadius: 3,
      })),
    }),
    [chart.categories, chart.series]
  );

  const options = useMemo<ChartOptions<'bar'>>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'top', labels: { boxWidth: 12, padding: 8, font: { size: 11 } } },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.raw == null ? '—' : fmt(Number(c.raw))}` } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 10 }, color: '#475569' } },
        y: { grid: { color: '#f1f5f9' }, ticks: { font: { size: 10 }, color: '#475569', callback: (v) => fmt(Number(v)) } },
      },
    }),
    [fmt]
  );

  const hasData = (chart.series ?? []).some((s) => (s.values ?? []).some((v) => v != null));

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-semibold text-ink">{chart.title}</h4>
        {hasData && <ExportButton onExport={handleExport} />}
      </div>
      <div className="h-[320px]">
        {hasData ? (
          <Bar ref={ref} data={data} options={options} />
        ) : (
          <div className="flex items-center justify-center h-full text-ink-faint text-sm">No data</div>
        )}
      </div>
      {chart.note && <p className="mt-2 text-xs text-ink-faint">{chart.note}</p>}
    </div>
  );
});

// ---- multiline (implied vs consensus, multiple vs history) -------------------------------

const MultiLine = memo(function MultiLine({ chart }: { chart: DDChart }) {
  const fmt = useMemo(() => makeFormatter(chart.yFormat), [chart.yFormat]);
  const series = (chart.series ?? []).map((s) => ({
    label: s.label,
    color: s.color,
    points: (s.points ?? []).filter((p): p is { date: string; value: number } => p.value != null),
  }));
  return (
    <div>
      <MultiLineChart series={series} title={chart.title} yFormat={fmt} height={320} />
      {chart.note && <p className="mt-2 text-xs text-ink-faint">{chart.note}</p>}
    </div>
  );
});

// ---- dispatcher --------------------------------------------------------------------------

export function DDChartBlock({ chart }: { chart: DDChart }) {
  switch (chart.type) {
    case 'price_catalysts':
      return <PriceCatalystChart chart={chart} />;
    case 'bars':
      return <BarsChart chart={chart} />;
    case 'multiline':
    default:
      return <MultiLine chart={chart} />;
  }
}
