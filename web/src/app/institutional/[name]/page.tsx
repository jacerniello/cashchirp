'use client';

import { use, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Line, Bar } from 'react-chartjs-2';
import type { ChartOptions } from 'chart.js';
import api from '@/lib/api';
import { BubbleChart } from '@/components/BubbleChart';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Spinner } from '@/components/Loading';
import { Table, TableHeader, TableRow, TableCell, TableLink } from '@/components/Table';
import { SEGMENT_COLORS, SOLID_COLORS } from '@/lib/chart-utils';
import {
  formatCurrency,
  formatNumber,
  formatNumberCompact,
  formatPerShare,
} from '@/lib/formatters';

// ============================================================================
// Types — mirror GET /institutional/investor/{name}
//   book is SF3B (per-quarter book); totalvalue/shr/cll/putvalue are in $millions.
//   holdings is the latest-quarter SF3 positions; value is in $ (not millions).
//   sectors is long-format (calendardate, sector, value) for the stacked bar.
// ============================================================================

interface BookRow {
  calendardate: string;
  totalvalue: number | null;
  shrvalue: number | null;
  cllvalue: number | null;
  putvalue: number | null;
  shrholdings: number | null;
  cllholdings: number | null;
  putholdings: number | null;
  shrunits: number | null;
}

interface HoldingRow {
  ticker: string | null;
  permaticker: number | null;
  securitytype: string | null;
  value: number | null;
  units: number | null;
  price: number | null;
}

interface SectorRow {
  calendardate: string;
  sector: string;
  value: number | null;
}

interface InvestorResponse {
  name: string;
  book: BookRow[];
  holdings: HoldingRow[];
  sectors: SectorRow[];
}

// GET /institutional/holdings-timeseries?name=…  (one page of held securities)
interface HoldingTimeseriesRow {
  calendardate: string;
  ticker: string | null;
  permaticker: number | null;
  value: number | null;
  units: number | null;
  adj_units: number | null;
}

interface HoldingsTimeseriesResponse {
  total: number;
  page: number;
  page_size: number;
  holdings: HoldingTimeseriesRow[];
}

// GET /institutional/investor-holdings?name=…&calendardate=…  (reported holdings, paged)
interface ReportedHoldingsResponse {
  name: string;
  calendardate: string | null;
  quarters: string[];
  total: number;
  page: number;
  page_size: number;
  holdings: HoldingRow[];
}

const HOLDINGS_PAGE_SIZE = 10;
const REPORTED_PAGE_SIZE = 25;

type HoldingsMetric = 'value' | 'units';

// ============================================================================
// Page
// ============================================================================

export default function InstitutionalPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name: rawName } = use(params);
  const name = decodeURIComponent(rawName);

  const { data, isLoading, error } = useQuery({
    queryKey: ['institutional-investor', name],
    queryFn: async () =>
      (await api.get<InvestorResponse>(`/institutional/investor/${encodeURIComponent(name)}`))
        .data,
    enabled: !!name,
    staleTime: 1000 * 60 * 10,
  });

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16">
        <div className="flex flex-col items-center justify-center gap-3 text-ink-muted">
          <Spinner className="h-8 w-8 text-green" />
          <span className="text-sm">Loading investor…</span>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16">
        <Card>
          <EmptyState
            iconName="user"
            title="Investor not found"
            description="No 13F filer with this name, or the data could not be loaded."
          />
        </Card>
      </div>
    );
  }

  return <InvestorView data={data} displayName={name} />;
}

// ============================================================================
// View
// ============================================================================

function InvestorView({ data, displayName }: { data: InvestorResponse; displayName: string }) {
  const { book, holdings, sectors } = data;

  const empty = book.length === 0 && holdings.length === 0 && sectors.length === 0;

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
      {/* Breadcrumb */}
      <Link
        href="/screener"
        className="text-sm text-ink-light hover:text-green transition-colors"
      >
        ← Screener
      </Link>

      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-ink">{displayName}</h1>
        <p className="text-sm text-ink-light mt-1">
          13F filer — book value over time and reported holdings by quarter.
        </p>
      </div>

      {empty && (
        <Card>
          <EmptyState
            variant="inline"
            message="No 13F rows for this investor."
          />
        </Card>
      )}

      {/* Book value + composition */}
      {book.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <h2 className="text-lg font-bold text-ink mb-3">Total book value</h2>
            <div className="h-[320px]">
              <BookValueChart book={book} />
            </div>
          </Card>
          <Card>
            <h2 className="text-lg font-bold text-ink mb-3">Composition (positions)</h2>
            <div className="h-[320px]">
              <CompositionChart book={book} />
            </div>
          </Card>
        </div>
      )}

      {/* Holdings over time (paginated bubble chart; bubbles link to companies) */}
      <HoldingsBubble name={displayName} />

      {/* Holdings by sector over time */}
      {sectors.length > 0 && (
        <Card>
          <h2 className="text-lg font-bold text-ink mb-3">Holdings by sector over time</h2>
          <div className="h-[420px]">
            <SectorChart sectors={sectors} />
          </div>
        </Card>
      )}

      {/* Reported holdings — paginated, with a quarter selector */}
      <ReportedHoldings name={displayName} />
    </div>
  );
}

// ============================================================================
// Reported holdings — paginated table with a per-quarter selector
// ============================================================================

function ReportedHoldings({ name }: { name: string }) {
  const [quarter, setQuarter] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  const query = useQuery({
    queryKey: ['investor-reported-holdings', name, quarter, page],
    queryFn: async () => {
      const cd = quarter ? `&calendardate=${encodeURIComponent(quarter)}` : '';
      return (
        await api.get<ReportedHoldingsResponse>(
          `/institutional/investor-holdings?name=${encodeURIComponent(name)}${cd}&page=${page}&page_size=${REPORTED_PAGE_SIZE}`
        )
      ).data;
    },
    enabled: !!name,
    staleTime: 1000 * 60 * 10,
  });

  const quarters = query.data?.quarters ?? [];
  const holdings = query.data?.holdings ?? [];
  const total = query.data?.total ?? 0;
  const activeQuarter = query.data?.calendardate ?? null;
  const totalPages = Math.max(1, Math.ceil(total / REPORTED_PAGE_SIZE));

  const onSelectQuarter = (q: string) => {
    setQuarter(q);
    setPage(0);
  };

  return (
    <Card>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <h2 className="text-lg font-bold text-ink">
          Reported holdings
          {total > 0 && (
            <span className="ml-2 text-sm font-normal text-ink-muted">({total})</span>
          )}
        </h2>
        <div className="flex items-center gap-2 flex-wrap">
          {quarters.length > 0 && (
            <select
              value={activeQuarter ?? ''}
              onChange={(e) => onSelectQuarter(e.target.value)}
              className="px-2 py-1.5 text-sm rounded border border-rule-light bg-white text-ink focus:outline-none focus:ring-1 focus:ring-green"
            >
              {quarters.map((q) => (
                <option key={q} value={q}>
                  {q}
                </option>
              ))}
            </select>
          )}
          <span className="text-xs text-ink-muted">
            {total > 0
              ? `${page * REPORTED_PAGE_SIZE + 1}–${Math.min((page + 1) * REPORTED_PAGE_SIZE, total)} of ${total}`
              : '—'}
          </span>
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page <= 0 || query.isFetching}
            className="px-3 py-1.5 bg-green text-white font-semibold rounded text-sm hover:bg-green-dark disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed"
          >
            ← Prev
          </button>
          <span className="text-xs text-ink-muted">
            {page + 1} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1 || query.isFetching}
            className="px-3 py-1.5 bg-green text-white font-semibold rounded text-sm hover:bg-green-dark disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed"
          >
            Next →
          </button>
        </div>
      </div>
      {query.isLoading ? (
        <div className="flex items-center justify-center py-10">
          <Spinner className="h-6 w-6 text-green" />
        </div>
      ) : holdings.length > 0 ? (
        <Table>
          <TableHeader columns={['Ticker', 'Type', 'Value', 'Units', 'Price']} />
          <tbody>
            {holdings.map((h, i) => (
              <TableRow key={`${h.permaticker ?? h.ticker}-${i}`}>
                <TableCell>
                  {h.permaticker != null ? (
                    <TableLink href={`/company/${h.permaticker}`}>
                      {h.ticker || h.permaticker}
                    </TableLink>
                  ) : (
                    <span className="font-semibold text-ink">{h.ticker || '-'}</span>
                  )}
                </TableCell>
                <TableCell muted align="center">{h.securitytype || '-'}</TableCell>
                <TableCell align="right">{formatCurrency(h.value)}</TableCell>
                <TableCell align="right">{formatNumberCompact(h.units)}</TableCell>
                <TableCell align="right">
                  {h.price != null ? formatPerShare(h.price) : '-'}
                </TableCell>
              </TableRow>
            ))}
          </tbody>
        </Table>
      ) : (
        <EmptyState variant="inline" message="No reported holdings for this quarter." />
      )}
    </Card>
  );
}

// ============================================================================
// Holdings-over-time bubble chart (paginated; each security links to its company)
// ============================================================================

function HoldingsBubble({ name }: { name: string }) {
  const [page, setPage] = useState(0);
  const [metric, setMetric] = useState<HoldingsMetric>('value');
  const [splitAdj, setSplitAdj] = useState(true);

  const query = useQuery({
    queryKey: ['investor-holdings-ts', name, page],
    queryFn: async () =>
      (
        await api.get<HoldingsTimeseriesResponse>(
          `/institutional/holdings-timeseries?name=${encodeURIComponent(name)}&page=${page}&page_size=${HOLDINGS_PAGE_SIZE}`
        )
      ).data,
    enabled: !!name,
    staleTime: 1000 * 60 * 10,
  });

  // Build BubbleChart inputs from the paginated rows. Entities are keyed by
  // permaticker so each bubble's "Go to page" link points at /company/<permaticker>.
  const bubble = useMemo(() => {
    const rows = query.data?.holdings || [];
    const periodsSet = new Set<string>();
    const nameMap: Record<string, string> = {};
    const processedData: Record<
      string,
      Record<string, number> & { maxShares: number }
    > = {};

    rows.forEach((r) => {
      if (r.permaticker == null) return;
      const id = String(r.permaticker);
      const period = r.calendardate;
      const metricVal =
        metric === 'value'
          ? r.value ?? 0
          : splitAdj
            ? r.adj_units ?? r.units ?? 0
            : r.units ?? 0;
      periodsSet.add(period);
      nameMap[id] = r.ticker || id;
      if (!processedData[id]) processedData[id] = { maxShares: 0 };
      processedData[id][period] = metricVal;
      if (metricVal > processedData[id].maxShares) processedData[id].maxShares = metricVal;
    });

    const periods = [...periodsSet].sort();
    return { periods, nameMap, processedData };
  }, [query.data?.holdings, metric, splitAdj]);

  const total = query.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / HOLDINGS_PAGE_SIZE));

  const segBtn = (active: boolean) =>
    `px-3 py-1 text-xs font-semibold rounded transition-colors ${
      active ? 'bg-green text-white' : 'bg-surface-warm text-ink-light hover:bg-gray-100'
    }`;

  return (
    <Card>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <h2 className="text-lg font-bold text-ink">Holdings over time</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex items-center gap-1">
            {(['value', 'units'] as HoldingsMetric[]).map((m) => (
              <button key={m} onClick={() => setMetric(m)} className={segBtn(metric === m)}>
                {m === 'value' ? 'Value' : 'Shares'}
              </button>
            ))}
          </div>
          {metric === 'units' && (
            <label className="flex items-center gap-1.5 text-xs text-ink-muted cursor-pointer">
              <input
                type="checkbox"
                checked={splitAdj}
                onChange={(e) => setSplitAdj(e.target.checked)}
                className="accent-green"
              />
              Split-adjusted
            </label>
          )}
          <span className="text-xs text-ink-muted">
            {total > 0
              ? `Holdings ${page * HOLDINGS_PAGE_SIZE + 1}–${Math.min((page + 1) * HOLDINGS_PAGE_SIZE, total)} of ${total}`
              : '—'}
          </span>
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page <= 0 || query.isFetching}
            className="px-3 py-1.5 bg-green text-white font-semibold rounded text-sm hover:bg-green-dark disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed"
          >
            ← Prev
          </button>
          <span className="text-xs text-ink-muted">
            {page + 1} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1 || query.isFetching}
            className="px-3 py-1.5 bg-green text-white font-semibold rounded text-sm hover:bg-green-dark disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed"
          >
            Next →
          </button>
        </div>
      </div>
      {bubble.periods.length === 0 && !query.isLoading ? (
        <EmptyState variant="inline" message="No holdings history for this investor." />
      ) : (
        <BubbleChart
          processedData={bubble.processedData}
          periods={bubble.periods}
          nameMap={bubble.nameMap}
          title={`${name} — Holdings`}
          yAxisLabel={
            metric === 'value'
              ? 'Position value ($)'
              : splitAdj
                ? 'Shares (split-adjusted)'
                : 'Shares (as-filed)'
          }
          isLoading={query.isLoading || query.isFetching}
          isSharesMode={metric === 'units'}
          entityLinkPrefix="/company/"
        />
      )}
    </Card>
  );
}

// ============================================================================
// Charts (self-contained Chart.js; chart-utils import registers components)
// ============================================================================

function shortLabel(d: string): string {
  // calendardate is YYYY-MM-DD; render "MMM 'YY" without tz drift.
  const [y, m] = d.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[(m || 1) - 1]} '${String(y).slice(2)}`;
}

const baseLineOptions = (yLabel: string, valueFmt: (v: number) => string): ChartOptions<'line'> => ({
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: {
      display: true,
      position: 'bottom',
      labels: { font: { size: 11 }, color: '#475569', boxWidth: 10, usePointStyle: true },
    },
    tooltip: {
      backgroundColor: '#111111',
      padding: 12,
      cornerRadius: 6,
      callbacks: {
        label: (ctx) => ` ${ctx.dataset.label}: ${valueFmt(ctx.parsed.y ?? 0)}`,
      },
    },
  },
  scales: {
    x: {
      grid: { display: false },
      border: { display: false },
      ticks: { font: { size: 10 }, color: '#64748b', maxRotation: 0, autoSkip: true },
    },
    y: {
      title: { display: true, text: yLabel, font: { size: 11, weight: 'bold' }, color: '#475569' },
      grid: { color: '#f1f5f9' },
      border: { display: false },
      ticks: { font: { size: 10 }, color: '#64748b', callback: (v) => valueFmt(Number(v)) },
    },
  },
});

function BookValueChart({ book }: { book: BookRow[] }) {
  const chartData = useMemo(() => {
    const sorted = [...book].sort((a, b) => a.calendardate.localeCompare(b.calendardate));
    return {
      labels: sorted.map((r) => shortLabel(r.calendardate)),
      datasets: [
        {
          label: 'Total book value',
          // sf3b values are in $millions.
          data: sorted.map((r) => (r.totalvalue ?? 0) * 1_000_000),
          borderColor: SOLID_COLORS.green,
          backgroundColor: 'rgba(5, 198, 151, 0.12)',
          fill: true,
          tension: 0.2,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
        },
      ],
    };
  }, [book]);

  return <Line data={chartData} options={baseLineOptions('Book value ($)', formatCurrency)} />;
}

function CompositionChart({ book }: { book: BookRow[] }) {
  const chartData = useMemo(() => {
    const sorted = [...book].sort((a, b) => a.calendardate.localeCompare(b.calendardate));
    const series: Array<{ key: keyof BookRow; label: string; color: string }> = [
      { key: 'shrholdings', label: 'Shares', color: SOLID_COLORS.green },
      { key: 'cllholdings', label: 'Calls', color: SOLID_COLORS.blue },
      { key: 'putholdings', label: 'Puts', color: SOLID_COLORS.amber },
    ];
    const present = series.filter((s) => sorted.some((r) => r[s.key] != null));
    return {
      labels: sorted.map((r) => shortLabel(r.calendardate)),
      datasets: present.map((s) => ({
        label: s.label,
        data: sorted.map((r) => (r[s.key] as number | null) ?? 0),
        borderColor: s.color,
        backgroundColor: s.color,
        fill: false,
        tension: 0.2,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
      })),
    };
  }, [book]);

  return <Line data={chartData} options={baseLineOptions('Positions held', formatNumber)} />;
}

function SectorChart({ sectors }: { sectors: SectorRow[] }) {
  const { labels, datasets } = useMemo(() => {
    // Order sectors by total value held (biggest stacks read consistently).
    const totals = new Map<string, number>();
    const dates = new Set<string>();
    for (const r of sectors) {
      const v = r.value ?? 0;
      totals.set(r.sector, (totals.get(r.sector) ?? 0) + v);
      dates.add(r.calendardate);
    }
    const order = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s);
    const sortedDates = [...dates].sort();
    // Pivot to value[sector][date].
    const lookup = new Map<string, number>();
    for (const r of sectors) lookup.set(`${r.sector}|${r.calendardate}`, r.value ?? 0);

    const datasets = order.map((sector, i) => ({
      label: sector,
      data: sortedDates.map((d) => lookup.get(`${sector}|${d}`) ?? 0),
      backgroundColor: SEGMENT_COLORS[i % SEGMENT_COLORS.length],
      borderColor: SEGMENT_COLORS[i % SEGMENT_COLORS.length],
      borderWidth: 0,
      stack: 'sector',
    }));
    return { labels: sortedDates.map(shortLabel), datasets };
  }, [sectors]);

  const options: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        display: true,
        position: 'bottom',
        labels: { font: { size: 10 }, color: '#475569', boxWidth: 10, usePointStyle: true },
      },
      tooltip: {
        backgroundColor: '#111111',
        padding: 12,
        cornerRadius: 6,
        callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y ?? 0)}` },
      },
    },
    scales: {
      x: {
        stacked: true,
        grid: { display: false },
        border: { display: false },
        ticks: { font: { size: 10 }, color: '#64748b', maxRotation: 0, autoSkip: true },
      },
      y: {
        stacked: true,
        title: { display: true, text: 'Value held ($)', font: { size: 11, weight: 'bold' }, color: '#475569' },
        grid: { color: '#f1f5f9' },
        border: { display: false },
        ticks: { font: { size: 10 }, color: '#64748b', callback: (v) => formatCurrency(Number(v)) },
      },
    },
  };

  return <Bar data={{ labels, datasets }} options={options} />;
}
