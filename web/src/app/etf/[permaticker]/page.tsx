'use client';

import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card } from '@/components/Card';
import { InfoCard, InfoGrid } from '@/components/InfoCard';
import { Badge } from '@/components/Badge';
import { EmptyState } from '@/components/EmptyState';
import { Spinner } from '@/components/Loading';
import { Table, TableHeader, TableRow, TableCell } from '@/components/Table';
import { PriceChart } from '@/components/PriceChart';
import {
  formatCurrency,
  formatPerShare,
  formatNumberCompact,
  formatDate,
} from '@/lib/formatters';

interface EtfProfile {
  permaticker: string;
  ticker: string | null;
  name: string | null;
  exchange: string | null;
  category: string | null;
  isdelisted: string | null;
  location: string | null;
  currency: string | null;
  companysite: string | null;
  secfilings: string | null;
  firstpricedate: string | null;
  lastpricedate: string | null;
}

interface EtfMetrics {
  last_close: number | null;
  last_date: string | null;
  inception_date: string | null;
  high_52w: number | null;
  low_52w: number | null;
  avg_volume_90d: number | null;
  return_1m: number | null;
  return_3m: number | null;
  return_6m: number | null;
  return_1y: number | null;
  return_5y: number | null;
  return_inception: number | null;
}

interface EtfResponse {
  profile: EtfProfile;
  metrics: EtfMetrics;
}

interface FundClass {
  class_id: string | null;
  symbol: string | null;
  permaticker: string | null;
  name: string | null;
  is_etf: boolean;
  in_universe: boolean;
  is_current: boolean;
}
interface FundSeries {
  series_id: string;
  name: string | null;
  classes: FundClass[];
}
interface FundFamily {
  cik: number | null;
  cik_padded?: string;
  edgar_url?: string;
  series: FundSeries[];
}

interface Holder {
  investorname: string;
  securitytype: string | null;
  value: number | null;
  units: number | null;
}

function pct(d: number | null | undefined): string {
  if (d == null) return '-';
  const v = d * 100;
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
}

function pctColor(d: number | null | undefined): string {
  if (d == null) return 'text-ink';
  return d >= 0 ? 'text-green-600' : 'text-red-600';
}

function Metric({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="bg-surface-warm border border-rule-light rounded-lg p-4">
      <div className="text-xs text-ink-muted uppercase font-semibold tracking-wide mb-1">{label}</div>
      <div className={`text-lg font-bold tabular-nums ${valueClass || 'text-ink'}`}>{value}</div>
    </div>
  );
}

export default function EtfPage({ params }: { params: Promise<{ permaticker: string }> }) {
  const { permaticker: pt } = use(params);

  const { data, isLoading, error } = useQuery({
    queryKey: ['etf', pt],
    queryFn: async () => (await api.get<EtfResponse>(`/etf/${pt}`)).data,
    enabled: !!pt,
    staleTime: 1000 * 60 * 10,
  });

  const { data: holdersData } = useQuery({
    queryKey: ['etf-holders', pt],
    queryFn: async () =>
      (await api.get<{ holders: Holder[] }>(`/institutional/top-holders?perma_ticker=${pt}`)).data,
    enabled: !!pt,
    staleTime: 1000 * 60 * 10,
  });

  const { data: familyData } = useQuery({
    queryKey: ['etf-family', pt],
    queryFn: async () => (await api.get<FundFamily>(`/etf/${pt}/family`)).data,
    enabled: !!pt,
    staleTime: 1000 * 60 * 30,
  });

  if (isLoading) {
    return (
      <div className="max-w-[1200px] mx-auto py-12 px-6">
        <Card><div className="py-12 flex justify-center"><Spinner className="h-6 w-6 text-green" /></div></Card>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-[1200px] mx-auto py-12 px-6">
        <Card>
          <EmptyState iconName="chart-line" title="Fund not found" description="No data is available for this fund." />
        </Card>
      </div>
    );
  }

  const { profile, metrics } = data;
  const holders = holdersData?.holders || [];
  const range52w =
    metrics.low_52w != null && metrics.high_52w != null
      ? `${formatPerShare(metrics.low_52w)} – ${formatPerShare(metrics.high_52w)}`
      : '-';

  return (
    <div className="bg-surface min-h-screen">
      {/* Header */}
      <div className="bg-white border-b border-rule">
        <div className="max-w-[1200px] mx-auto px-8 max-md:px-4 py-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-baseline gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-ink tracking-tight m-0">{profile.ticker}</h1>
              <span className="text-ink-light text-base">{profile.name}</span>
              {profile.isdelisted === 'Y' && <Badge variant="red">Delisted</Badge>}
            </div>
            {metrics.last_close != null && (
              <span className="text-lg font-bold text-ink">{formatPerShare(metrics.last_close)}</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <Badge variant="blue">ETF</Badge>
            {profile.exchange && <Badge variant="gray">{profile.exchange}</Badge>}
            {profile.location && <Badge variant="gray">{profile.location}</Badge>}
          </div>
        </div>
      </div>

      <div className="max-w-[1200px] mx-auto py-8 px-6 max-md:px-4 space-y-6">
        {/* Key metrics */}
        <Card>
          <h3 className="text-lg font-bold text-ink mb-4">Key Metrics</h3>
          <div className="grid grid-cols-4 max-lg:grid-cols-3 max-sm:grid-cols-2 gap-3">
            <Metric label="Last Close" value={formatPerShare(metrics.last_close)} />
            <Metric label="52W Range" value={range52w} />
            <Metric label="Avg Vol (90d)" value={formatNumberCompact(metrics.avg_volume_90d)} />
            <Metric label="Inception" value={formatDate(metrics.inception_date || profile.firstpricedate)} />
            <Metric label="1M Return" value={pct(metrics.return_1m)} valueClass={pctColor(metrics.return_1m)} />
            <Metric label="6M Return" value={pct(metrics.return_6m)} valueClass={pctColor(metrics.return_6m)} />
            <Metric label="1Y Return" value={pct(metrics.return_1y)} valueClass={pctColor(metrics.return_1y)} />
            <Metric label="5Y Return" value={pct(metrics.return_5y)} valueClass={pctColor(metrics.return_5y)} />
            <Metric
              label="Since Inception"
              value={pct(metrics.return_inception)}
              valueClass={pctColor(metrics.return_inception)}
            />
          </div>
        </Card>

        {/* Price chart (pulls from sfp via /prices) */}
        <PriceChart
          ticker={pt}
          displayName={`${profile.ticker} — ${profile.name}`}
          title={`${profile.ticker} Price`}
          height={360}
          showVolume
          showCorporateActions
        />

        {/* Top 13F institutional holders of the fund */}
        <Card>
          <h3 className="text-lg font-bold text-ink mb-1">Top Institutional Holders (13F)</h3>
          <p className="text-xs text-ink-muted mb-4">Largest reported 13F positions in this fund, by value.</p>
          {holders.length === 0 ? (
            <EmptyState iconName="chart-line" title="No 13F holders" description="No institutional holdings reported for this fund." />
          ) : (
            <Table>
              <TableHeader columns={['Institution', 'Type', 'Value', 'Shares']} />
              <tbody>
                {holders.slice(0, 15).map((h, i) => (
                  <TableRow key={`${h.investorname}-${i}`}>
                    <TableCell>{h.investorname}</TableCell>
                    <TableCell>{h.securitytype || '-'}</TableCell>
                    <TableCell align="right">{formatCurrency(h.value)}</TableCell>
                    <TableCell align="right">{formatNumberCompact(h.units)}</TableCell>
                  </TableRow>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        {/* Fund family — parent SEC filer (CIK) and its series / share classes. */}
        {familyData && familyData.cik && familyData.series.length > 0 && (
          <Card>
            <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1">
              <h3 className="text-lg font-bold text-ink">Fund family</h3>
              {familyData.edgar_url && (
                <a
                  href={familyData.edgar_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-green hover:underline"
                >
                  SEC CIK {familyData.cik_padded || familyData.cik} ↗
                </a>
              )}
            </div>
            <p className="text-xs text-ink-muted mb-4">
              All series and share classes filed under this fund&apos;s parent CIK. Classes we
              cover are linked; others are mutual-fund share classes (shown for reference).
            </p>
            <div className="space-y-4">
              {familyData.series.map((s) => (
                <div key={s.series_id}>
                  <div className="text-sm font-semibold text-ink mb-1.5">
                    {s.name || s.series_id}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {s.classes.map((c, i) => {
                      const label = c.symbol || c.class_id || '—';
                      const base =
                        'inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-sm border';
                      if (c.in_universe && c.permaticker) {
                        return (
                          <a
                            key={`${c.class_id}-${i}`}
                            href={`/etf/${c.permaticker}`}
                            className={`${base} ${
                              c.is_current
                                ? 'bg-green text-white border-green'
                                : 'bg-white border-rule text-ink hover:border-green hover:text-green'
                            }`}
                          >
                            {label}
                            {c.is_current && <span className="text-[10px] opacity-80">(this)</span>}
                          </a>
                        );
                      }
                      return (
                        <span
                          key={`${c.class_id}-${i}`}
                          className={`${base} bg-surface border-rule-light text-ink-muted`}
                          title="Mutual-fund share class (not covered)"
                        >
                          {label}
                        </span>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Profile links */}
        <Card>
          <h3 className="text-lg font-bold text-ink mb-4">{profile.name}</h3>
          <InfoGrid cols={3}>
            <InfoCard label="Permaticker" value={profile.permaticker} mono />
            <InfoCard label="Category" value={profile.category || undefined} />
            <InfoCard label="Currency" value={profile.currency || undefined} />
            <InfoCard
              label="Issuer site"
              value={profile.companysite || undefined}
              href={profile.companysite || undefined}
            />
            <InfoCard
              label="SEC filings"
              value={profile.secfilings ? 'EDGAR' : undefined}
              href={profile.secfilings || undefined}
            />
            <InfoCard label="Last price" value={formatDate(profile.lastpricedate)} />
          </InfoGrid>
        </Card>
      </div>
    </div>
  );
}
