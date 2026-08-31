'use client';

import { useState, useMemo, use, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card } from '@/components/Card';
import { InfoCard, InfoGrid } from '@/components/InfoCard';
import { Badge } from '@/components/Badge';
import { EmptyState } from '@/components/EmptyState';
import { Spinner } from '@/components/Loading';
import { Table, TableHeader, TableRow, TableCell, TableLink } from '@/components/Table';
import { PriceChart } from '@/components/PriceChart';
import type { OverlayLine } from '@/components/PriceChart';
import { BubbleChart } from '@/components/BubbleChart';
import { ValuationLineChart, type ZoneBand } from '@/components/charts/ValuationLineChart';
import { FundamentalsBarChart } from '@/components/charts/FundamentalsBarChart';
import { MultiLineChart } from '@/components/charts/MultiLineChart';
import { VolumeChart } from '@/components/charts/VolumeChart';
import {
  formatCurrency,
  formatPercentRaw,
  formatRatio,
  formatNumberCompact,
  formatDate,
  formatPerShare,
} from '@/lib/formatters';
import { SOLID_COLORS } from '@/lib/chart-utils';
import { segItem } from '@/lib/styles';

// ============================================================================
// Types
// ============================================================================

interface Profile {
  ticker: string;
  name: string;
  category?: string;
  exchange: string;
  sector: string;
  industry: string;
  permaticker: string;
  firstpricedate: string;
  lastpricedate: string;
  isdelisted: string;
  companysite: string;
  secfilings: string;
}

interface Snapshot {
  market_cap: number | null;
  revenue: number | null;
  net_income: number | null;
  eps: number | null;
  pe: number | null;
  ps: number | null;
  pb: number | null;
  gross_margin: number | null;
  net_margin: number | null;
  roe: number | null;
  debt_equity: number | null;
  return_1y: number | null;
  beta_1y: number | null;
  altman_z: number | null;
  altman_zone: string | null;
  low_52w: number | null;
  high_52w: number | null;
  last_close: number | null;
  last_date: string | null;
}

interface CompanyResponse {
  profile: Profile;
  snapshot: Snapshot;
}

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'prices', label: 'Prices' },
  { key: 'fundamentals', label: 'Fundamentals' },
  { key: 'valuation', label: 'Valuation' },
  { key: 'insiders', label: 'Insiders' },
  { key: 'institutional', label: 'Institutional' },
  { key: 'short_interest', label: 'Short interest' },
  { key: 'events', label: 'Events' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

// ============================================================================
// Hooks
// ============================================================================

function useCompany(pt: string) {
  return useQuery({
    queryKey: ['company', pt],
    queryFn: async () => (await api.get<CompanyResponse>(`/company/${pt}`)).data,
    enabled: !!pt,
    staleTime: 1000 * 60 * 10,
  });
}

// ============================================================================
// Page
// ============================================================================

export default function CompanyPage({
  params,
}: {
  params: Promise<{ permaticker: string }>;
}) {
  const { permaticker } = use(params);
  const pt = decodeURIComponent(permaticker);

  // Active tab from URL hash on first render, else client state.
  const [activeTab, setActiveTab] = useState<TabKey>(() => {
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      const fromQuery = url.searchParams.get('tab');
      const fromHash = url.hash.replace('#', '');
      const candidate = fromQuery || fromHash;
      if (candidate && TABS.some((t) => t.key === candidate)) {
        return candidate as TabKey;
      }
    }
    return 'overview';
  });

  const { data, isLoading, error } = useCompany(pt);
  const router = useRouter();

  // Funds/ETFs have no fundamentals/insiders/13F — send them to the dedicated page.
  useEffect(() => {
    if (data?.profile?.category === 'ETF') {
      router.replace(`/etf/${pt}`);
    }
  }, [data, pt, router]);

  const handleTab = (key: TabKey) => {
    setActiveTab(key);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', key);
      url.hash = '';
      window.history.replaceState(null, '', url.toString());
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-[1200px] mx-auto px-8 max-md:px-4 py-16 flex items-center justify-center">
        <Spinner className="h-6 w-6 text-green" />
        <span className="ml-3 text-ink-light font-medium">Loading company…</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-[1200px] mx-auto px-8 max-md:px-4 py-8">
        <Card>
          <EmptyState
            iconName="x-circle"
            title="Company not found"
            description={`No company data for permaticker ${pt}.`}
          />
        </Card>
      </div>
    );
  }

  const { profile, snapshot } = data;

  return (
    <div className="bg-surface min-h-screen">
      {/* Sticky header + tab bar */}
      <div className="bg-white border-b border-rule sticky top-0 z-[100]">
        <div className="max-w-[1200px] mx-auto px-8 max-md:px-4 pt-5">
          <div className="flex items-start justify-between gap-4 flex-wrap mb-3">
            <div className="flex items-baseline gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-ink tracking-tight m-0">
                {profile.ticker}
              </h1>
              <span className="text-ink-light text-base">{profile.name}</span>
              {profile.isdelisted === 'Y' && <Badge variant="red">Delisted</Badge>}
            </div>
            <div className="flex items-center gap-2">
              {snapshot.last_close != null && (
                <span className="text-lg font-bold text-ink">
                  {formatPerShare(snapshot.last_close)}
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 mb-1">
            {profile.exchange && <Badge variant="blue">{profile.exchange}</Badge>}
            {profile.sector && <Badge variant="green">{profile.sector}</Badge>}
            {profile.industry && <Badge variant="gray">{profile.industry}</Badge>}
          </div>
          {/* Tab bar — Dash .co-tabs pills */}
          <ul className="flex gap-1 overflow-x-auto scrollbar-hide list-none m-0 p-0 pb-2">
            {TABS.map((t) => {
              const active = t.key === activeTab;
              return (
                <li key={t.key} className="flex-shrink-0">
                  <button onClick={() => handleTab(t.key)} className={segItem(active)}>
                    {t.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {/* Tab content */}
      <div className="max-w-[1200px] mx-auto px-8 max-md:px-4 py-6">
        {activeTab === 'overview' && <OverviewTab pt={pt} profile={profile} snapshot={snapshot} />}
        {activeTab === 'prices' && <PricesTab pt={pt} profile={profile} />}
        {activeTab === 'fundamentals' && <FundamentalsTab pt={pt} />}
        {activeTab === 'valuation' && <ValuationTab pt={pt} />}
        {activeTab === 'insiders' && <InsidersTab pt={pt} />}
        {activeTab === 'institutional' && <InstitutionalTab pt={pt} profile={profile} />}
        {activeTab === 'short_interest' && <ShortInterestTab pt={pt} />}
        {activeTab === 'events' && <EventsTab pt={pt} />}
      </div>
    </div>
  );
}

// ============================================================================
// Shared helpers
// ============================================================================

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-lg font-bold text-ink mb-4">{children}</h2>;
}

// Coerce a DB cell (number | string | null) to a finite number, else null.
function num(value: number | string | null | undefined): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function CenterSpinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center py-16">
      <Spinner className="h-5 w-5 text-green" />
      {label && <span className="ml-3 text-ink-light text-sm">{label}</span>}
    </div>
  );
}

function KpiCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface-warm border border-rule-light rounded-lg p-4">
      <div className="text-xs font-bold uppercase tracking-wider text-ink-light mb-1.5">
        {label}
      </div>
      <p className="text-sm font-semibold text-ink m-0">{value}</p>
    </div>
  );
}

// ============================================================================
// Overview Tab
// ============================================================================

function OverviewTab({
  pt,
  profile,
  snapshot,
}: {
  pt: string;
  profile: Profile;
  snapshot: Snapshot;
}) {
  const range52w =
    snapshot.low_52w != null && snapshot.high_52w != null
      ? `${formatPerShare(snapshot.low_52w)} – ${formatPerShare(snapshot.high_52w)}`
      : '-';

  return (
    <div className="space-y-6">
      {/* Key metrics snapshot — surfaced at the very top so they're hard to miss,
          mirroring the Dash overview snapshot. */}
      <Card>
        <SectionTitle>Key Metrics</SectionTitle>
        <div className="grid grid-cols-4 max-lg:grid-cols-3 max-sm:grid-cols-2 gap-3">
          <KpiCell label="Market Cap" value={formatCurrency(snapshot.market_cap)} />
          <KpiCell label="P/E" value={formatRatio(snapshot.pe)} />
          <KpiCell label="P/S" value={formatRatio(snapshot.ps)} />
          <KpiCell label="P/B" value={formatRatio(snapshot.pb)} />
          <KpiCell
            label="ROE"
            value={snapshot.roe != null ? formatPercentRaw(snapshot.roe * 100) : '-'}
          />
          <KpiCell
            label="Gross Margin"
            value={
              snapshot.gross_margin != null
                ? formatPercentRaw(snapshot.gross_margin * 100)
                : '-'
            }
          />
          <KpiCell
            label="Net Margin"
            value={
              snapshot.net_margin != null
                ? formatPercentRaw(snapshot.net_margin * 100)
                : '-'
            }
          />
          <KpiCell label="Debt / Equity" value={formatRatio(snapshot.debt_equity)} />
          <KpiCell
            label="1Y Return"
            value={snapshot.return_1y != null ? formatPercentRaw(snapshot.return_1y) : '-'}
          />
          <KpiCell
            label="Altman Z"
            value={
              snapshot.altman_z != null
                ? `${formatRatio(snapshot.altman_z)}${
                    snapshot.altman_zone ? ` (${snapshot.altman_zone})` : ''
                  }`
                : '-'
            }
          />
          <KpiCell label="52W Range" value={range52w} />
          <KpiCell label="Beta (1Y)" value={formatRatio(snapshot.beta_1y)} />
          <KpiCell label="Revenue" value={formatCurrency(snapshot.revenue)} />
          <KpiCell label="Net Income" value={formatCurrency(snapshot.net_income)} />
          <KpiCell label="EPS" value={formatPerShare(snapshot.eps)} />
        </div>
      </Card>

      {/* Profile links — kept up top alongside the key metrics. */}
      <Card>
        <SectionTitle>{profile.name}</SectionTitle>
        <InfoGrid cols={3}>
          <InfoCard label="Permaticker" value={profile.permaticker} mono />
          <InfoCard
            label="Company site"
            value={profile.companysite || undefined}
            href={profile.companysite || undefined}
          />
          <InfoCard
            label="SEC filings"
            value={profile.secfilings ? 'EDGAR' : undefined}
            href={profile.secfilings || undefined}
          />
          <InfoCard label="First price" value={formatDate(profile.firstpricedate)} />
          <InfoCard label="Last price" value={formatDate(profile.lastpricedate)} />
          <InfoCard
            label="Status"
            value={profile.isdelisted === 'Y' ? 'Delisted' : 'Active'}
          />
        </InfoGrid>
      </Card>

      {/* Price chart */}
      <PriceChart
        ticker={pt}
        displayName={`${profile.ticker} — ${profile.name}`}
        title={`${profile.ticker} Price`}
        height={350}
        showVolume
        showCorporateActions
        showRangeSelector={false}
        showPerformanceReturns={false}
      />
    </div>
  );
}

// ============================================================================
// Prices Tab
// ============================================================================

function PricesTab({ pt, profile }: { pt: string; profile: Profile }) {
  return (
    <div className="space-y-6">
      <PriceChart
        ticker={pt}
        displayName={`${profile.ticker} — ${profile.name}`}
        title={`${profile.ticker} Price`}
        height={460}
        showVolume={false}
        showCorporateActions
        showPerformanceReturns
      />
      {/* Standalone volume with its own draggable date-range bar for a closer look. */}
      <Card>
        <VolumeChart ticker={pt} height={240} title={`${profile.ticker} Volume`} />
      </Card>
    </div>
  );
}

// ============================================================================
// Fundamentals Tab
// ============================================================================

type Dimension = 'ARY' | 'ARQ' | 'ART';

type FieldKind = 'money' | 'pershare' | 'shares' | 'percent' | 'ratio';

interface FundamentalsResponse {
  dimension: string;
  available_dimensions: string[];
  rows: Record<string, number | string | null>[];
  altman_z: { calendardate: string; altman_z: number }[];
  altman_latest: { value: number | null; zone: string | null };
  groups: Record<string, string[]>;
  labels: Record<string, string>;
  kinds: Record<string, FieldKind>;
}

const DIM_LABELS: Record<Dimension, string> = { ARY: 'Annual', ARQ: 'Quarterly', ART: 'TTM' };

// Mirror of Dash `fmt.value(v, kind)`: Sharadar margins/returns are stored as fractions
// (0.43 -> 43.0%), so the percent kind scales by 100.
function fmtKind(value: number | string | null | undefined, kind: FieldKind): string {
  if (value == null || value === '') return '-';
  const n = typeof value === 'number' ? value : Number(value);
  if (Number.isNaN(n)) return String(value);
  switch (kind) {
    case 'pershare':
      return formatPerShare(n);
    case 'shares':
      return formatNumberCompact(n);
    case 'percent':
      return formatPercentRaw(n * 100);
    case 'ratio':
      return formatRatio(n);
    case 'money':
    default:
      return formatCurrency(n);
  }
}

// Period column header: "2024-09" -> "Sep 2024" (mirrors Dash `_period_label`).
function periodLabel(p: string): string {
  const d = new Date(p.slice(0, 10) + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return p.slice(0, 7);
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

// Altman Z zones drawn behind the line: distress < 1.81 (red) · grey 1.81–2.99 (amber)
// · safe > 2.99 (green). Tints are faint so the line and gridlines stay readable.
const ALTMAN_BANDS: ZoneBand[] = [
  { from: 2.99, color: 'rgba(16, 185, 129, 0.10)' },
  { from: 1.81, to: 2.99, color: 'rgba(245, 158, 11, 0.10)' },
  { to: 1.81, color: 'rgba(239, 68, 68, 0.10)' },
];

// Palette for fundamental metrics overlaid on the price chart as dots. Excludes the
// price line's own near-black so overlays stay distinguishable from it.
const METRIC_COLORS = [
  '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899',
  '#10b981', '#14b8a6', '#f97316', '#6366f1', '#84cc16',
];

interface SelectedMetric {
  field: string;
  color: string;
}

function FundamentalsTab({ pt }: { pt: string }) {
  const [dimension, setDimension] = useState<Dimension>('ARY');
  // Fundamental metrics the user has pinned onto the price chart as dot overlays.
  // Single source of truth for both the table-row indicators and the chart chips.
  const [selectedMetrics, setSelectedMetrics] = useState<SelectedMetric[]>([]);
  // The single metric shown as a bar chart over time (the "bar chart over time" view).
  const [barField, setBarField] = useState<string>('revenue');

  const { data, isLoading } = useQuery({
    queryKey: ['fundamentals', pt, dimension],
    queryFn: async () =>
      (
        await api.get<FundamentalsResponse>(
          `/company/${pt}/fundamentals?dimension=${dimension}`
        )
      ).data,
    enabled: !!pt,
    staleTime: 1000 * 60 * 10,
  });

  const altmanData = useMemo(
    () =>
      (data?.altman_z || [])
        .filter((d) => d.altman_z != null)
        .map((d) => ({ date: d.calendardate, value: d.altman_z })),
    [data?.altman_z]
  );

  // Rows ascending by calendardate for trend charts; periods descending for statements.
  const rowsAsc = useMemo(
    () =>
      [...(data?.rows || [])].sort((a, b) =>
        String(a.calendardate).localeCompare(String(b.calendardate))
      ),
    [data?.rows]
  );

  const revenueSeries = useMemo(
    () => rowsAsc.map((r) => ({ date: String(r.calendardate), value: num(r.revenue) })),
    [rowsAsc]
  );
  const netIncSeries = useMemo(
    () => rowsAsc.map((r) => ({ date: String(r.calendardate), value: num(r.netinc) })),
    [rowsAsc]
  );

  // All periods on record, most-recent first (Dash shows the full history).
  const periods = useMemo(
    () => [...rowsAsc].reverse().map((r) => String(r.calendardate)),
    [rowsAsc]
  );

  const rowByPeriod = useMemo(() => {
    const m = new Map<string, Record<string, number | string | null>>();
    (data?.rows || []).forEach((r) => m.set(String(r.calendardate), r));
    return m;
  }, [data?.rows]);

  const groups = data?.groups || {};
  const labels = useMemo(() => data?.labels || {}, [data?.labels]);
  const kinds = useMemo(() => data?.kinds || {}, [data?.kinds]);
  const availableDims = (data?.available_dimensions as Dimension[]) || ['ARY', 'ARQ', 'ART'];
  const zLatest = data?.altman_latest;

  // field -> assigned color, for the table-row selection indicators.
  const colorByField = useMemo(() => {
    const m = new Map<string, string>();
    selectedMetrics.forEach((s) => m.set(s.field, s.color));
    return m;
  }, [selectedMetrics]);

  // Toggle a metric on/off the chart, assigning the first free palette color on add.
  const toggleMetric = useCallback((field: string) => {
    setSelectedMetrics((prev) => {
      if (prev.some((s) => s.field === field)) {
        return prev.filter((s) => s.field !== field);
      }
      const used = new Set(prev.map((s) => s.color));
      const color =
        METRIC_COLORS.find((c) => !used.has(c)) || METRIC_COLORS[prev.length % METRIC_COLORS.length];
      return [...prev, { field, color }];
    });
  }, []);

  // One dot-overlay per selected metric: report dates plotted on the price line, the
  // value on hover. Multiple metrics on the same date combine into a segmented dot.
  const overlayLines = useMemo<OverlayLine[]>(
    () =>
      selectedMetrics.map((s) => ({
        label: labels[s.field] || s.field,
        color: s.color,
        renderAs: 'dot' as const,
        format:
          kinds[s.field] === 'money' || kinds[s.field] === 'pershare'
            ? ('currency' as const)
            : ('number' as const),
        data: rowsAsc
          .map((r) => ({ date: String(r.calendardate), value: num(r[s.field]) }))
          .filter((d): d is { date: string; value: number } => d.value != null),
      })),
    [selectedMetrics, rowsAsc, labels, kinds]
  );

  // Only render a statement's rows that actually have data, mirroring `_statement`.
  function presentFields(fields: string[]): string[] {
    return fields.filter((f) =>
      periods.some((p) => {
        const v = rowByPeriod.get(p)?.[f];
        return v != null && v !== '';
      })
    );
  }

  // Fields that bar-chart cleanly over time (money / margins / per-share), grouped for
  // the picker. Shares/ratios are excluded — the bar chart's axis can't label them.
  const barFields = useMemo(() => {
    const out: { group: string; field: string; label: string }[] = [];
    for (const [group, fields] of Object.entries(groups)) {
      for (const f of fields) {
        const kind = kinds[f] || 'money';
        if (kind !== 'money' && kind !== 'percent' && kind !== 'pershare') continue;
        if (!rowsAsc.some((r) => num(r[f]) != null)) continue;
        out.push({ group, field: f, label: labels[f] || f });
      }
    }
    return out;
  }, [groups, kinds, labels, rowsAsc]);

  // The selected metric as a bar series over time (ascending), scaled to the chart's
  // conventions: currency in millions, percent ×100 (Sharadar stores fractions), per-share raw.
  const barChart = useMemo(() => {
    const active = barFields.find((b) => b.field === barField) ?? barFields[0];
    if (!active) return null;
    const kind = kinds[active.field] || 'money';
    const labelsArr = rowsAsc.map((r) => periodLabel(String(r.calendardate)));
    const raw = rowsAsc.map((r) => num(r[active.field]));
    const isPercent = kind === 'percent';
    const isPerShare = kind === 'pershare';
    const values = isPercent
      ? raw.map((v) => (v == null ? null : v * 100))
      : isPerShare
        ? raw
        : raw.map((v) => (v == null ? null : v / 1e6)); // money → millions
    return { field: active.field, title: active.label, labels: labelsArr, values, isPercent, isPerShare };
  }, [barFields, barField, kinds, rowsAsc]);

  return (
    <div className="space-y-6">
      {/* Altman Z health gate with safe/grey/distress bands. */}
      <Card>
        <div className="flex items-center justify-between mb-1 gap-3 flex-wrap">
          <SectionTitle>Financial health — Altman Z-score (TTM)</SectionTitle>
          {zLatest?.value != null && (
            <Badge
              variant={
                zLatest.zone?.toLowerCase() === 'safe'
                  ? 'green'
                  : zLatest.zone?.toLowerCase() === 'distress'
                    ? 'red'
                    : 'yellow'
              }
            >
              {formatRatio(zLatest.value)} · {zLatest.zone}
            </Badge>
          )}
        </div>
        {isLoading ? (
          <CenterSpinner />
        ) : altmanData.length > 0 ? (
          <>
            <ValuationLineChart
              data={altmanData}
              title="Altman Z-Score"
              format="ratio"
              color={SOLID_COLORS.purple}
              bands={ALTMAN_BANDS}
            />
            <p className="text-xs text-ink-muted mt-2 mb-0">
              Bankruptcy distance: &gt;2.99 safe · 1.81–2.99 grey · &lt;1.81 distress. TTM flows;
              calibrated for non-financials (banks/REITs read low). A survivability proxy — not
              credit analysis.
            </p>
          </>
        ) : (
          <EmptyState variant="inline" message="No Altman Z history available" />
        )}
      </Card>

      {/* Period basis toggle */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="inline-flex items-center gap-1">
          {(['ARY', 'ARQ', 'ART'] as Dimension[])
            .filter((d) => availableDims.includes(d))
            .map((d) => (
              <button
                key={d}
                onClick={() => setDimension(d)}
                className={segItem(dimension === d)}
              >
                {DIM_LABELS[d]}
              </button>
            ))}
        </div>
        <span className="text-xs text-ink-muted">
          As-reported · all periods on record · most recent first
        </span>
      </div>

      {/* Bar chart over time — pick any income/margin/per-share metric and see it as
          bars across the reported periods (respects the Annual/Quarterly/TTM basis). */}
      <Card>
        <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
          <SectionTitle>Metric over time</SectionTitle>
          <select
            value={barChart?.field ?? barField}
            onChange={(e) => setBarField(e.target.value)}
            className="px-3 py-1.5 text-sm border border-rule rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-green max-w-[60%]"
            aria-label="Metric to bar-chart"
          >
            {Object.entries(groups).map(([group, fields]) => {
              const opts = barFields.filter((b) => b.group === group && fields.includes(b.field));
              if (opts.length === 0) return null;
              return (
                <optgroup key={group} label={group}>
                  {opts.map((b) => (
                    <option key={b.field} value={b.field}>{b.label}</option>
                  ))}
                </optgroup>
              );
            })}
          </select>
        </div>
        {isLoading ? (
          <CenterSpinner />
        ) : barChart && barChart.values.some((v) => v != null) ? (
          <FundamentalsBarChart
            key={`${barChart.field}-${dimension}`}
            title={barChart.title}
            labels={barChart.labels}
            values={barChart.values}
            isPercent={barChart.isPercent}
            isPerShare={barChart.isPerShare}
            signColors={barChart.values.some((v) => v != null && v < 0)}
          />
        ) : (
          <EmptyState variant="inline" message="No data for this metric on this basis" />
        )}
      </Card>

      {/* Price chart with fundamentals overlaid as dots. Pick metrics from the
          statement tables below; they appear here on the report dates, on the price
          line, so you can read fundamental trends against the stock. */}
      <Card>
        <div className="flex items-center justify-between mb-2 gap-3 flex-wrap">
          <SectionTitle>Price vs. reported fundamentals</SectionTitle>
          {selectedMetrics.length > 0 && (
            <button
              onClick={() => setSelectedMetrics([])}
              className="text-xs text-ink-light hover:text-green transition-colors"
            >
              Clear all
            </button>
          )}
        </div>
        {/* Selection chips — the in-chart selection surface: each pinned metric with
            its color; click to remove. Mirrors the row indicators below. */}
        {selectedMetrics.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {selectedMetrics.map((s) => (
              <button
                key={s.field}
                onClick={() => toggleMetric(s.field)}
                className="group inline-flex items-center gap-1.5 pl-2 pr-1.5 py-1 rounded-full border border-rule-light bg-surface-warm text-xs font-medium text-ink hover:bg-gray-100 transition-colors"
                title="Remove from chart"
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                {labels[s.field] || s.field}
                <span className="text-ink-muted group-hover:text-ink">×</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-ink-muted mb-3">
            Click any metric in the statement tables below to plot it here as dots on the
            report dates. Add several to compare their timing against price.
          </p>
        )}
        <PriceChart
          ticker={pt}
          title="Price"
          height={360}
          overlayLines={overlayLines}
          showPerformanceReturns={false}
        />
      </Card>

      {/* Revenue + Net income trend */}
      <div className="grid grid-cols-2 max-lg:grid-cols-1 gap-6">
        <Card>
          {isLoading ? (
            <CenterSpinner />
          ) : (
            <ValuationLineChart
              data={revenueSeries}
              title="Revenue"
              format="currency"
              color={SOLID_COLORS.green}
            />
          )}
        </Card>
        <Card>
          {isLoading ? (
            <CenterSpinner />
          ) : (
            <ValuationLineChart
              data={netIncSeries}
              title="Net income"
              format="currency"
              color={SOLID_COLORS.blue}
            />
          )}
        </Card>
      </div>

      {/* Grouped financial statements — Income / Balance / Cash flow / Margins / Valuation */}
      {isLoading ? (
        <Card>
          <CenterSpinner />
        </Card>
      ) : periods.length === 0 ? (
        <Card>
          <EmptyState variant="inline" message="No fundamentals for this basis" />
        </Card>
      ) : (
        Object.entries(groups).map(([group, fields]) => {
          const present = presentFields(fields);
          if (present.length === 0) return null;
          return (
            <Card key={group}>
              <SectionTitle>{group}</SectionTitle>
              <Table>
                <TableHeader
                  columns={[group, ...periods.map(periodLabel)]}
                  stickyFirstColumn
                />
                <tbody>
                  {present.map((f) => {
                    const sel = colorByField.get(f);
                    return (
                      <TableRow key={f} className={sel ? 'bg-green/[0.04]' : ''}>
                        <TableCell sticky className="font-medium text-ink">
                          <button
                            onClick={() => toggleMetric(f)}
                            className="group flex items-center gap-2 text-left w-full hover:text-green transition-colors"
                            title={sel ? 'Remove from price chart' : 'Plot on price chart as dots'}
                          >
                            <span
                              className={`h-2.5 w-2.5 rounded-full shrink-0 border ${sel ? '' : 'border-rule group-hover:border-green'}`}
                              style={sel ? { backgroundColor: sel, borderColor: sel } : undefined}
                            />
                            <span className={sel ? 'font-semibold text-green-dark' : ''}>
                              {labels[f] || f}
                            </span>
                          </button>
                        </TableCell>
                        {periods.map((p) => (
                          <TableCell key={p} align="right">
                            {fmtKind(rowByPeriod.get(p)?.[f], kinds[f] || 'money')}
                          </TableCell>
                        ))}
                      </TableRow>
                    );
                  })}
                </tbody>
              </Table>
            </Card>
          );
        })
      )}
    </div>
  );
}

// ============================================================================
// Valuation Tab
// ============================================================================

interface ValuationDaily {
  date: string;
  marketcap: number | null;
  ev: number | null;
  pe: number | null;
  ps: number | null;
  pb: number | null;
  evebit: number | null;
  evebitda: number | null;
}

interface ValuationResponse {
  daily: ValuationDaily[];
  metrics: Record<string, number | null>[];
}

// Daily valuation series span ~10 years (~2500 points); a ~500px-wide chart can't
// resolve that many, so plotting them all just burns render time (and a per-point
// Intl date format ×6 charts). Evenly thin to a target count, always keeping the
// first and last point so the range is unchanged.
const VALUATION_CHART_POINTS = 500;

function downsampleByStride<T>(items: T[], target: number): T[] {
  if (items.length <= target) return items;
  const step = (items.length - 1) / (target - 1);
  const out: T[] = [];
  for (let i = 0; i < target; i++) out.push(items[Math.round(i * step)]);
  return out;
}

function ValuationTab({ pt }: { pt: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['valuation', pt],
    queryFn: async () =>
      (await api.get<ValuationResponse>(`/company/${pt}/valuation`)).data,
    enabled: !!pt,
    staleTime: 1000 * 60 * 10,
  });

  const series = useMemo(() => {
    const daily = data?.daily || [];
    const sorted = [...daily].sort((a, b) => a.date.localeCompare(b.date));
    const thinned = downsampleByStride(sorted, VALUATION_CHART_POINTS);
    const pick = (key: keyof ValuationDaily) =>
      thinned.map((d) => ({ date: d.date, value: (d[key] as number | null) ?? null }));
    return {
      pe: pick('pe'),
      ps: pick('ps'),
      pb: pick('pb'),
      evebitda: pick('evebitda'),
      evebit: pick('evebit'),
      marketcap: pick('marketcap'),
    };
  }, [data?.daily]);

  if (isLoading) {
    return (
      <Card>
        <CenterSpinner label="Loading valuation…" />
      </Card>
    );
  }

  if (!data?.daily?.length) {
    return (
      <Card>
        <EmptyState variant="inline" message="No valuation data available" />
      </Card>
    );
  }

  const charts: { title: string; data: { date: string; value: number | null }[]; fmt: 'ratio' | 'currency' }[] = [
    { title: 'P/E Ratio', data: series.pe, fmt: 'ratio' },
    { title: 'P/S Ratio', data: series.ps, fmt: 'ratio' },
    { title: 'P/B Ratio', data: series.pb, fmt: 'ratio' },
    { title: 'EV / EBITDA', data: series.evebitda, fmt: 'ratio' },
    { title: 'EV / EBIT', data: series.evebit, fmt: 'ratio' },
    { title: 'Market Cap', data: series.marketcap, fmt: 'currency' },
  ];

  return (
    <div className="space-y-4">
      <p className="text-xs text-ink-muted m-0">
        Each multiple is shown against its <span className="font-medium text-ink-light">own
        history</span>: the shaded band is the 25th–75th percentile (where it normally trades),
        and the chip reads whether today sits cheap, typical, or rich versus that range.
      </p>
      <div className="grid grid-cols-2 max-lg:grid-cols-1 gap-6">
        {charts.map((c) => (
          <ValuationMetricChart key={c.title} title={c.title} data={c.data} format={c.fmt} />
        ))}
      </div>
    </div>
  );
}

// Quantile of a pre-sorted ascending array (linear interpolation between ranks).
function quantileSorted(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0];
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function ordinal(n: number): string {
  const v = Math.round(n);
  const s = ['th', 'st', 'nd', 'rd'];
  const m = v % 100;
  return v + (s[(m - 20) % 10] || s[m] || s[0]);
}

interface MetricStats {
  current: number;
  median: number;
  p25: number;
  p75: number;
  min: number;
  max: number;
  pctile: number; // 0–100, current's rank within history
}

// A valuation multiple/series in the context of its own history: IQR band behind the
// line + a current / median / range / percentile read + a cheap/typical/rich verdict.
function ValuationMetricChart({
  title,
  data,
  format,
}: {
  title: string;
  data: { date: string; value: number | null }[];
  format: 'ratio' | 'currency';
}) {
  const isRatio = format === 'ratio';

  const stats = useMemo<MetricStats | null>(() => {
    // Negative multiples are meaningless (treated as gaps on the chart), so drop them
    // from the distribution too; keep all finite values for currency series.
    const usable = data
      .map((d) => d.value)
      .filter((v): v is number => v != null && Number.isFinite(v) && (!isRatio || v > 0));
    if (usable.length < 2) return null;
    const sorted = [...usable].sort((a, b) => a - b);
    let current: number | null = null;
    for (let i = data.length - 1; i >= 0; i--) {
      const v = data[i].value;
      if (v != null && Number.isFinite(v) && (!isRatio || v > 0)) {
        current = v;
        break;
      }
    }
    if (current == null) return null;
    const below = sorted.filter((v) => v <= current).length;
    return {
      current,
      median: quantileSorted(sorted, 0.5),
      p25: quantileSorted(sorted, 0.25),
      p75: quantileSorted(sorted, 0.75),
      min: sorted[0],
      max: sorted[sorted.length - 1],
      pctile: (below / sorted.length) * 100,
    };
  }, [data, isRatio]);

  const fmt = useCallback(
    (v: number) => (isRatio ? formatRatio(v) : formatCurrency(v)),
    [isRatio]
  );

  const bands = useMemo<ZoneBand[] | undefined>(
    () =>
      stats
        ? [{ from: stats.p25, to: stats.p75, color: 'rgba(59, 130, 246, 0.10)' }]
        : undefined,
    [stats]
  );

  // Verdict from the current percentile. For multiples, lower = cheaper.
  const verdict = useMemo(() => {
    if (!stats || !isRatio) return null;
    if (stats.pctile <= 33) return { label: 'Cheap vs history', variant: 'green' as const };
    if (stats.pctile >= 67) return { label: 'Rich vs history', variant: 'red' as const };
    return { label: 'Typical', variant: 'gray' as const };
  }, [stats, isRatio]);

  return (
    <Card>
      <div className="flex items-start justify-between gap-2 mb-1">
        <div>
          <h4 className="text-sm font-semibold text-ink m-0">{title}</h4>
          {stats && (
            <p className="text-xs text-ink-muted mt-0.5 mb-0">
              <span className="font-semibold text-ink">{fmt(stats.current)}</span>
              <span className="mx-1.5">·</span>median {fmt(stats.median)}
              <span className="mx-1.5">·</span>
              {fmt(stats.min)}–{fmt(stats.max)}
              <span className="mx-1.5">·</span>
              {ordinal(stats.pctile)} pctile
            </p>
          )}
        </div>
        {verdict && <Badge variant={verdict.variant}>{verdict.label}</Badge>}
      </div>
      <ValuationLineChart
        data={data}
        title=""
        format={format}
        treatNegativeAsGap={isRatio}
        color={SOLID_COLORS.green}
        bands={bands}
      />
    </Card>
  );
}

// ============================================================================
// Insiders Tab
// ============================================================================

interface InsiderTotals {
  insiders: number;
  txns: string | number;
  acquired: number;
  disposed: number;
  net: number;
  acquired_sh: number;
  disposed_sh: number;
  om_buy: number | null;
  om_sell: number | null;
  om_net: number | null;
  om_buy_sh: number | null;
  om_sell_sh: number | null;
  om_txns: string | number | null;
}

interface InsiderTop {
  owner_id: string;
  ownername: string;
  txns: number;
  om_txns: number;
  net_value: number;
  om_net_value: number;
  acquired_value: number;
  disposed_value: number;
  om_buy_value: number;
  om_sell_value: number;
  latest_shares: number | null;
  last_trade: string | null;
}

interface InsiderTxn {
  filingdate: string;
  transactiondate: string;
  ownername: string;
  officertitle: string | null;
  transactioncode: string | null;
  securityadcode: string | null;
  transactionshares: number | null;
  transactionpricepershare: number | null;
  transactionvalue: number | null;
}

interface InsidersResponse {
  totals: InsiderTotals;
  top: InsiderTop[];
  transactions: InsiderTxn[];
  monthly_flow: { month: string; net: number }[];
}

// Open-market (P/S) vs all-codes (A/D) net basis — mirrors the Dash net-basis toggle.
type InsiderBasis = 'om' | 'all';

const TXN_CODE_LABELS: Record<string, string> = {
  P: 'Open-market buy',
  S: 'Open-market sale',
  A: 'Grant / award',
  M: 'Option exercise',
  X: 'Option exercise',
  C: 'Conversion',
  F: 'Tax withholding',
  G: 'Gift',
  D: 'Sale to issuer',
  W: 'Will / inheritance',
  J: 'Other (acquire)',
  K: 'Other (dispose)',
  V: 'Voluntary report',
};

function toTitle(name: string): string {
  return name.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

function InsidersTab({ pt }: { pt: string }) {
  const [basis, setBasis] = useState<InsiderBasis>('om');

  const { data, isLoading } = useQuery({
    queryKey: ['insiders', pt],
    queryFn: async () =>
      (await api.get<InsidersResponse>(`/insiders?perma_ticker=${pt}`)).data,
    enabled: !!pt,
    staleTime: 1000 * 60 * 10,
  });

  const txns = useMemo(() => data?.transactions || [], [data?.transactions]);

  // Per-insider split-adjusted holdings curves (top holders), for the line-per-insider
  // chart. owner_id on each series lets the legend deep-link to the people page.
  const { data: holdingsData } = useQuery({
    queryKey: ['insider-holdings', pt],
    queryFn: async () =>
      (await api.get<{ series: { owner_id: string; ownername: string; ownership?: string; points: { date: string; shares: number }[] }[] }>(
        `/insiders/holdings?perma_ticker=${pt}`
      )).data,
    enabled: !!pt,
    staleTime: 1000 * 60 * 10,
  });

  const holdingsSeries = useMemo(
    () =>
      (holdingsData?.series || []).map((s) => {
        // Flag insiders whose total includes indirect (trust/fund) holdings.
        const tag = s.ownership === 'indirect' ? ' (indirect)'
          : s.ownership === 'both' ? ' (incl. indirect)' : '';
        return {
          label: toTitle(s.ownername) + tag,
          href: `/insider/${s.owner_id}`,
          points: s.points.map((p) => ({ date: p.date, value: p.shares })),
        };
      }),
    [holdingsData?.series]
  );

  // ownername -> owner_id for linking the transactions table (from the rollups that carry it).
  const ownerIdByName = useMemo(() => {
    const m = new Map<string, string>();
    (data?.top || []).forEach((o) => m.set(o.ownername.toUpperCase(), o.owner_id));
    (holdingsData?.series || []).forEach((s) => m.set(s.ownername.toUpperCase(), s.owner_id));
    return m;
  }, [data?.top, holdingsData?.series]);

  // Monthly net $ flow comes from the backend (acquired − disposed, valued at market so
  // RSU vesting / option exercises aren't counted as $0 — see insiders.company_monthly_flow).
  const monthlyNet = useMemo(() => {
    const flow = data?.monthly_flow || [];
    return { labels: flow.map((f) => f.month), values: flow.map((f) => f.net) };
  }, [data?.monthly_flow]);

  // Transactions-table pagination.
  const [txnPage, setTxnPage] = useState(0);
  const TXN_PAGE_SIZE = 25;
  const txnPageCount = Math.max(1, Math.ceil(txns.length / TXN_PAGE_SIZE));
  const pagedTxns = useMemo(
    () => txns.slice(txnPage * TXN_PAGE_SIZE, txnPage * TXN_PAGE_SIZE + TXN_PAGE_SIZE),
    [txns, txnPage]
  );


  if (isLoading) {
    return (
      <Card>
        <CenterSpinner label="Loading insiders…" />
      </Card>
    );
  }

  const totals = data?.totals;
  const top = data?.top || [];

  if (!totals && top.length === 0 && txns.length === 0) {
    return (
      <Card>
        <EmptyState variant="inline" message="No insider data available" />
      </Card>
    );
  }

  // Basis-dependent stat cards (open-market P/S vs all-codes A/D).
  const net = totals ? (basis === 'om' ? totals.om_net : totals.net) : null;
  const acqLabel = basis === 'om' ? 'Bought' : 'Acquired';
  const acqVal = totals ? (basis === 'om' ? totals.om_buy : totals.acquired) : null;
  const acqSh = totals ? (basis === 'om' ? totals.om_buy_sh : totals.acquired_sh) : null;
  const dispLabel = basis === 'om' ? 'Sold' : 'Disposed';
  const dispVal = totals ? (basis === 'om' ? totals.om_sell : totals.disposed) : null;
  const dispSh = totals ? (basis === 'om' ? totals.om_sell_sh : totals.disposed_sh) : null;
  const txnCount = totals ? (basis === 'om' ? totals.om_txns : totals.txns) : null;

  return (
    <div className="space-y-6">
      {/* Net-basis toggle */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="inline-flex items-center gap-1">
          {(['om', 'all'] as InsiderBasis[]).map((b) => (
            <button
              key={b}
              onClick={() => setBasis(b)}
              className={segItem(basis === b)}
            >
              {b === 'om' ? 'Open-market (P/S)' : 'All transactions'}
            </button>
          ))}
        </div>
        <span className="text-xs text-ink-muted">
          Open-market = discretionary buys/sells (conviction). All = also grants, option
          exercises, tax withholding.
        </span>
      </div>

      {totals && (
        <div className="grid grid-cols-4 max-md:grid-cols-2 gap-3">
          <KpiCell
            label={`Net (${basis === 'om' ? 'open-market' : 'all'})`}
            value={formatCurrency(net)}
          />
          <KpiCell
            label={acqLabel}
            value={`${formatCurrency(acqVal)}${acqSh != null ? ` · ${formatNumberCompact(acqSh)} sh` : ''}`}
          />
          <KpiCell
            label={dispLabel}
            value={`${formatCurrency(dispVal)}${dispSh != null ? ` · ${formatNumberCompact(dispSh)} sh` : ''}`}
          />
          <KpiCell
            label="Insiders"
            value={`${totals.insiders} · ${txnCount ?? 0} txns`}
          />
        </div>
      )}

      <Card>
        <SectionTitle>Net insider flow (monthly)</SectionTitle>
        <p className="text-xs text-ink-muted mb-2">
          Acquired − disposed, valued at market (RSU vesting/option exercises included). Most
          big-company insiders receive shares as comp and only sell on the open market, so net
          flow trends negative.
        </p>
        {monthlyNet.labels.length > 0 ? (
          <FundamentalsBarChart
            title="Net $ flow"
            labels={monthlyNet.labels}
            values={monthlyNet.values}
            signColors
          />
        ) : (
          <EmptyState variant="inline" message="No transaction flow available" />
        )}
      </Card>

      {/* Holdings over time — one line per insider (split-adjusted shares owned).
          Legend names link to each insider's people page. */}
      <Card>
        <SectionTitle>Holdings over time (by insider)</SectionTitle>
        <p className="text-xs text-ink-muted mb-3">
          Split-adjusted shares owned for the top holders. Click a name to open that
          insider&apos;s page.
        </p>
        {holdingsSeries.length > 0 ? (
          <MultiLineChart
            series={holdingsSeries}
            stepped
            height={380}
            yAxisLabel="Shares owned"
            yFormat={(v) => formatNumberCompact(v)}
          />
        ) : (
          <EmptyState variant="inline" message="No reported holdings history" />
        )}
      </Card>

      {top.length > 0 && (
        <Card>
          <SectionTitle>
            Top insiders ({basis === 'om' ? 'by net open-market trades (P/S)' : 'by net position change (all codes)'})
          </SectionTitle>
          <Table>
            <TableHeader
              columns={[
                'Insider',
                basis === 'om' ? 'Net $ (open-mkt)' : 'Net $ (all)',
                'Txns',
                'Latest shares',
                'Last trade',
              ]}
            />
            <tbody>
              {[...top]
                .sort((a, b) => {
                  const av = Math.abs(basis === 'om' ? a.om_net_value : a.net_value);
                  const bv = Math.abs(basis === 'om' ? b.om_net_value : b.net_value);
                  return bv - av;
                })
                .map((o, i) => {
                  const netVal = basis === 'om' ? o.om_net_value : o.net_value;
                  const txnN = basis === 'om' ? o.om_txns : o.txns;
                  return (
                    <TableRow key={`${o.owner_id}-${i}`}>
                      <TableCell className="font-semibold">
                        <a
                          href={`/insider/${o.owner_id}`}
                          className="text-green hover:underline"
                        >
                          {toTitle(o.ownername)}
                        </a>
                      </TableCell>
                      <TableCell
                        align="right"
                        className={netVal >= 0 ? 'text-green' : 'text-red'}
                      >
                        {formatCurrency(netVal)}
                      </TableCell>
                      <TableCell align="right">{txnN}</TableCell>
                      <TableCell align="right">{formatNumberCompact(o.latest_shares)}</TableCell>
                      <TableCell align="right">
                        {o.last_trade ? formatDate(o.last_trade) : '-'}
                      </TableCell>
                    </TableRow>
                  );
                })}
            </tbody>
          </Table>
        </Card>
      )}

      {txns.length > 0 && (
        <Card>
          <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
            <SectionTitle>
              All transactions{' '}
              <span className="text-sm font-normal text-ink-muted">({txns.length.toLocaleString()})</span>
            </SectionTitle>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setTxnPage((p) => Math.max(0, p - 1))}
                disabled={txnPage === 0}
                className="px-2.5 py-1 text-sm rounded-md border border-rule text-ink-light disabled:opacity-40 hover:bg-surface-warm"
              >
                Prev
              </button>
              <span className="text-xs text-ink-muted tabular-nums">
                Page {txnPage + 1} / {txnPageCount}
              </span>
              <button
                onClick={() => setTxnPage((p) => Math.min(txnPageCount - 1, p + 1))}
                disabled={txnPage >= txnPageCount - 1}
                className="px-2.5 py-1 text-sm rounded-md border border-rule text-ink-light disabled:opacity-40 hover:bg-surface-warm"
              >
                Next
              </button>
            </div>
          </div>
          <Table>
            <TableHeader
              columns={['Date', 'Insider', 'Title', 'Type', 'Shares', 'Price', 'Value']}
            />
            <tbody>
              {pagedTxns.map((t, i) => (
                <TableRow key={`${t.filingdate}-${txnPage}-${i}`}>
                  <TableCell>{formatDate(t.transactiondate)}</TableCell>
                  <TableCell className="font-semibold text-ink">
                    {ownerIdByName.get(t.ownername.toUpperCase()) ? (
                      <TableLink href={`/insider/${ownerIdByName.get(t.ownername.toUpperCase())}`}>
                        {toTitle(t.ownername)}
                      </TableLink>
                    ) : (
                      toTitle(t.ownername)
                    )}
                  </TableCell>
                  <TableCell muted>{t.officertitle || '-'}</TableCell>
                  <TableCell muted>
                    {t.transactioncode
                      ? TXN_CODE_LABELS[t.transactioncode.toUpperCase()] || t.transactioncode
                      : '-'}
                  </TableCell>
                  <TableCell align="right">{formatNumberCompact(t.transactionshares)}</TableCell>
                  <TableCell align="right">{formatPerShare(t.transactionpricepershare)}</TableCell>
                  <TableCell align="right">{formatCurrency(t.transactionvalue)}</TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}

// ============================================================================
// Institutional Tab
// ============================================================================

interface InstAggregate {
  calendardate: string;
  shrholders: number | null;
  totalvalue: number | null;
}

interface InstOwnership {
  calendardate: string;
  ownership_pct: number | null;
}

interface InstResponse {
  aggregate: InstAggregate[];
  ownership: InstOwnership[];
}

interface TimeseriesHolder {
  calendardate: string;
  investorname: string;
  value: number | null;
  units: number | null;
  adj_units: number | null;
}

interface TimeseriesResponse {
  total: number;
  page: number;
  page_size: number;
  holders: TimeseriesHolder[];
}

interface TopHolder {
  investorname: string;
  securitytype: string | null;
  value: number | null;
  units: number | null;
}

const PAGE_SIZE = 10;

type InstBubbleMetric = 'value' | 'units';

function InstitutionalTab({ pt, profile }: { pt: string; profile: Profile }) {
  const [page, setPage] = useState(0);
  const [bubbleMetric, setBubbleMetric] = useState<InstBubbleMetric>('value');
  const [splitAdj, setSplitAdj] = useState(true);

  const aggQuery = useQuery({
    queryKey: ['institutional-agg', pt],
    queryFn: async () =>
      (await api.get<InstResponse>(`/institutional?perma_ticker=${pt}`)).data,
    enabled: !!pt,
    staleTime: 1000 * 60 * 10,
  });

  const tsQuery = useQuery({
    queryKey: ['institutional-ts', pt, page],
    queryFn: async () =>
      (
        await api.get<TimeseriesResponse>(
          `/institutional/timeseries?perma_ticker=${pt}&page=${page}&page_size=${PAGE_SIZE}`
        )
      ).data,
    enabled: !!pt,
    staleTime: 1000 * 60 * 10,
  });

  const topQuery = useQuery({
    queryKey: ['institutional-top', pt],
    queryFn: async () =>
      (
        await api.get<{ holders: TopHolder[] }>(
          `/institutional/top-holders?perma_ticker=${pt}`
        )
      ).data,
    enabled: !!pt,
    staleTime: 1000 * 60 * 10,
  });

  // Build BubbleChart inputs from the paginated timeseries. Value mode plots position
  // $; Shares mode plots units (split-adjusted by default, mirroring the Dash toggle).
  const bubble = useMemo(() => {
    const holders = tsQuery.data?.holders || [];
    const periodsSet = new Set<string>();
    const nameMap: Record<string, string> = {};
    // entityId (investorname) -> URL-encoded name, for the per-institution link
    // that appears when a holder is selected on the bubble chart.
    const entityLinkMap: Record<string, string> = {};
    const processedData: Record<
      string,
      Record<string, number> & { maxShares: number }
    > = {};

    holders.forEach((h) => {
      const id = h.investorname;
      const period = h.calendardate;
      const metricVal =
        bubbleMetric === 'value'
          ? h.value ?? 0
          : splitAdj
            ? h.adj_units ?? h.units ?? 0
            : h.units ?? 0;
      periodsSet.add(period);
      nameMap[id] = h.investorname;
      entityLinkMap[id] = encodeURIComponent(h.investorname);
      if (!processedData[id]) processedData[id] = { maxShares: 0 };
      processedData[id][period] = metricVal;
      if (metricVal > processedData[id].maxShares) processedData[id].maxShares = metricVal;
    });

    const periods = [...periodsSet].sort();
    return { periods, nameMap, processedData, entityLinkMap };
  }, [tsQuery.data?.holders, bubbleMetric, splitAdj]);

  // Aggregate SF3A trend series (holders / total value / ownership %).
  const aggHolders = useMemo(
    () =>
      (aggQuery.data?.aggregate || [])
        .filter((a) => a.shrholders != null)
        .map((a) => ({ date: a.calendardate, value: a.shrholders })),
    [aggQuery.data?.aggregate]
  );
  const aggValue = useMemo(
    () =>
      (aggQuery.data?.aggregate || [])
        .filter((a) => a.totalvalue != null)
        // SF3A totalvalue is stored in USD millions; scale to absolute for currency fmt.
        .map((a) => ({ date: a.calendardate, value: (a.totalvalue as number) * 1e6 })),
    [aggQuery.data?.aggregate]
  );
  const ownershipPct = useMemo(
    () =>
      (aggQuery.data?.ownership || [])
        .filter((o) => o.ownership_pct != null)
        .map((o) => ({ date: o.calendardate, value: o.ownership_pct })),
    [aggQuery.data?.ownership]
  );

  const total = tsQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const topHolders = topQuery.data?.holders || [];

  return (
    <div className="space-y-6">
      {/* SF3A aggregate trends: holders, total value, ownership % */}
      <div className="grid grid-cols-3 max-lg:grid-cols-1 gap-6">
        <Card>
          <SectionTitle>13F holders over time</SectionTitle>
          {aggQuery.isLoading ? (
            <CenterSpinner />
          ) : aggHolders.length > 0 ? (
            <ValuationLineChart
              data={aggHolders}
              title="Institutional holders"
              format="ratio"
              color={SOLID_COLORS.blue}
            />
          ) : (
            <EmptyState variant="inline" message="No holder history" />
          )}
        </Card>
        <Card>
          <SectionTitle>Total value held</SectionTitle>
          {aggQuery.isLoading ? (
            <CenterSpinner />
          ) : aggValue.length > 0 ? (
            <ValuationLineChart
              data={aggValue}
              title="Total 13F value"
              format="currency"
              color={SOLID_COLORS.green}
            />
          ) : (
            <EmptyState variant="inline" message="No value history" />
          )}
        </Card>
        <Card>
          <div className="flex items-center justify-between gap-2 mb-1">
            <SectionTitle>Institutional ownership %</SectionTitle>
          </div>
          {aggQuery.isLoading ? (
            <CenterSpinner />
          ) : ownershipPct.length > 0 ? (
            <>
              <ValuationLineChart
                data={ownershipPct}
                title="Ownership %"
                format="percent"
                color={SOLID_COLORS.purple}
              />
              <p className="text-xs text-ink-muted mt-2 mb-0">
                13F shares held (split-adjusted) ÷ shares outstanding. Float-adjacent — not true
                free float.
              </p>
            </>
          ) : (
            <EmptyState variant="inline" message="No ownership history" />
          )}
        </Card>
      </div>

      {/* Bubble Chart */}
      <Card>
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <SectionTitle>Holders over time</SectionTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="inline-flex items-center gap-1">
              {(['value', 'units'] as InstBubbleMetric[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setBubbleMetric(m)}
                  className={segItem(bubbleMetric === m)}
                >
                  {m === 'value' ? 'Value' : 'Shares'}
                </button>
              ))}
            </div>
            {bubbleMetric === 'units' && (
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
              Holders {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
            </span>
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page <= 0 || tsQuery.isFetching}
              className="px-3 py-1.5 bg-green text-white font-semibold rounded text-sm hover:bg-green-dark disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed"
            >
              ← Prev
            </button>
            <span className="text-xs text-ink-muted">
              {page + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1 || tsQuery.isFetching}
              className="px-3 py-1.5 bg-green text-white font-semibold rounded text-sm hover:bg-green-dark disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed"
            >
              Next →
            </button>
          </div>
        </div>
        {bubble.periods.length === 0 && !tsQuery.isLoading ? (
          <EmptyState variant="inline" message="No institutional holdings data available" />
        ) : (
          <BubbleChart
            processedData={bubble.processedData}
            periods={bubble.periods}
            nameMap={bubble.nameMap}
            title={`${profile.ticker} — Institutional Holdings`}
            yAxisLabel={
              bubbleMetric === 'value'
                ? 'Position value ($)'
                : splitAdj
                  ? 'Shares (split-adjusted)'
                  : 'Shares (as-filed)'
            }
            isLoading={tsQuery.isLoading || tsQuery.isFetching}
            isSharesMode={bubbleMetric === 'units'}
            entityLinkPrefix="/institutional/"
            entityLinkMap={bubble.entityLinkMap}
          />
        )}
      </Card>

      {/* Top Holders Table */}
      <Card>
        <SectionTitle>Top Holders</SectionTitle>
        {topQuery.isLoading ? (
          <CenterSpinner />
        ) : topHolders.length > 0 ? (
          <Table>
            <TableHeader columns={['Investor', 'Type', 'Value', 'Units']} />
            <tbody>
              {topHolders.map((h, i) => (
                <TableRow key={`${h.investorname}-${i}`}>
                  <TableCell>
                    <TableLink href={`/institutional/${encodeURIComponent(h.investorname)}`}>
                      {h.investorname}
                    </TableLink>
                  </TableCell>
                  <TableCell muted align="center">{h.securitytype || '-'}</TableCell>
                  <TableCell align="right">{formatCurrency(h.value)}</TableCell>
                  <TableCell align="right">{formatNumberCompact(h.units)}</TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState variant="inline" message="No top holders available" />
        )}
      </Card>
    </div>
  );
}

// ============================================================================
// Short Interest Tab
// ============================================================================

interface ShortRow {
  settlementdate: string;
  current_short: number | null;
  adj_short: number | null;
  short_pct_shares: number | null;
  days_to_cover: number | null;
  change_pct: number | null;
  market: string | null;
}

function ShortInterestTab({ pt }: { pt: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['short-interest', pt],
    queryFn: async () =>
      (await api.get<{ rows: ShortRow[] }>(`/short-interest?perma_ticker=${pt}`)).data,
    enabled: !!pt,
    staleTime: 1000 * 60 * 10,
  });

  const rows = useMemo(
    () => [...(data?.rows || [])].sort((a, b) => a.settlementdate.localeCompare(b.settlementdate)),
    [data?.rows]
  );

  // Plot the split-adjusted short count so the series is comparable across splits
  // (as-filed counts jump at a split). Falls back to as-filed if adj is missing.
  const shortShares = useMemo(
    () => rows.map((r) => ({ date: r.settlementdate, value: r.adj_short ?? r.current_short ?? null })),
    [rows]
  );
  const shortPct = useMemo(
    () => rows.map((r) => ({ date: r.settlementdate, value: r.short_pct_shares ?? null })),
    [rows]
  );
  const daysToCover = useMemo(
    () => rows.map((r) => ({ date: r.settlementdate, value: r.days_to_cover ?? null })),
    [rows]
  );

  if (isLoading) {
    return (
      <Card>
        <CenterSpinner label="Loading short interest…" />
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState
          iconName="chart-line"
          title="No short interest data"
          description="No short-interest records are available for this security."
        />
      </Card>
    );
  }

  const latest = rows[rows.length - 1];
  const asof = formatDate(latest.settlementdate);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-4 max-md:grid-cols-2 gap-3">
        <KpiCell
          label="Short shares"
          value={`${formatNumberCompact(latest.current_short)}${latest.market ? ` · ${latest.market}` : ''}`}
        />
        <KpiCell
          label="% of shares out"
          value={latest.short_pct_shares != null ? formatPercentRaw(latest.short_pct_shares) : '-'}
        />
        <KpiCell
          label="Days to cover"
          value={latest.days_to_cover != null ? formatRatio(latest.days_to_cover, 1) : '-'}
        />
        <KpiCell
          label="Change vs prior"
          value={
            latest.change_pct != null
              ? `${latest.change_pct >= 0 ? '+' : ''}${formatRatio(latest.change_pct, 1)}%`
              : '-'
          }
        />
      </div>
      <p className="text-xs text-ink-muted -mt-3">As of {asof}. Split-adjusted ÷ sharesbas.</p>
      <Card>
        <ValuationLineChart
          data={shortShares}
          title="Short shares (split-adjusted)"
          format="currency"
          color={SOLID_COLORS.red}
        />
      </Card>
      <Card>
        <ValuationLineChart
          data={shortPct}
          title="Short % of Shares Outstanding"
          format="percent"
          color={SOLID_COLORS.amber}
        />
      </Card>
      <Card>
        <ValuationLineChart
          data={daysToCover}
          title="Days to Cover"
          format="ratio"
          color={SOLID_COLORS.blue}
        />
      </Card>
    </div>
  );
}

// ============================================================================
// Events Tab
// ============================================================================

interface EventRow {
  date: string;
  labels: string;
  eventcodes: string;
}
interface ActionRow {
  date: string;
  action: string;
  value: number | null;
  contraticker?: string;
  contraname?: string;
  name?: string;
}
interface Sp500Row {
  date: string;
  action: string;
  name?: string;
}

interface EventsResponse {
  events: EventRow[];
  actions: ActionRow[];
  sp500: Sp500Row[];
}

function EventsTab({ pt }: { pt: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['events', pt],
    queryFn: async () =>
      (await api.get<EventsResponse>(`/company/${pt}/events`)).data,
    enabled: !!pt,
    staleTime: 1000 * 60 * 10,
  });

  if (isLoading) {
    return (
      <Card>
        <CenterSpinner label="Loading events…" />
      </Card>
    );
  }

  const events = data?.events || [];
  const actions = data?.actions || [];
  const sp500 = data?.sp500 || [];

  return (
    <div className="space-y-6">
      <Card>
        <SectionTitle>Filing Events</SectionTitle>
        {events.length > 0 ? (
          <Table>
            <TableHeader columns={['Date', 'Codes', 'Labels']} />
            <tbody>
              {events.slice(0, 200).map((e, i) => (
                <TableRow key={`${e.date}-${i}`}>
                  <TableCell>{formatDate(e.date)}</TableCell>
                  <TableCell muted className="font-mono">{e.eventcodes}</TableCell>
                  <TableCell>{e.labels}</TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState variant="inline" message="No filing events available" />
        )}
      </Card>

      <Card>
        <SectionTitle>Corporate Actions</SectionTitle>
        {actions.length > 0 ? (
          <Table>
            <TableHeader columns={['Date', 'Action', 'Value', 'Contra']} />
            <tbody>
              {actions.slice(0, 200).map((a, i) => (
                <TableRow key={`${a.date}-${i}`}>
                  <TableCell>{formatDate(a.date)}</TableCell>
                  <TableCell className="capitalize">{a.action}</TableCell>
                  <TableCell align="right">
                    {a.value != null ? formatPerShare(a.value) : '-'}
                  </TableCell>
                  <TableCell muted>
                    {a.contraticker && a.contraticker !== 'N/A' ? a.contraticker : '-'}
                  </TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState variant="inline" message="No corporate actions available" />
        )}
      </Card>

      <Card>
        <SectionTitle>S&amp;P 500 Membership</SectionTitle>
        {sp500.length > 0 ? (
          <Table>
            <TableHeader columns={['Date', 'Action']} />
            <tbody>
              {sp500.map((s, i) => (
                <TableRow key={`${s.date}-${i}`}>
                  <TableCell>{formatDate(s.date)}</TableCell>
                  <TableCell className="capitalize">{s.action}</TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState variant="inline" message="No S&P 500 membership history" />
        )}
      </Card>
    </div>
  );
}
