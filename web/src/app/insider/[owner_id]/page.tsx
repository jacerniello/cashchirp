'use client';

import { use, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { EmptyState } from '@/components/EmptyState';
import { Spinner } from '@/components/Loading';
import { Table, TableHeader, TableRow, TableCell, TableLink } from '@/components/Table';
import { AcquireDisposeChart } from '@/components/charts/AcquireDisposeChart';
import { PriceChart } from '@/components/PriceChart';
import {
  formatCurrency,
  formatNumberCompact,
  formatDate,
  formatPerShare,
} from '@/lib/formatters';

// ============================================================================
// Types — mirror GET /insider/{owner_id}
// ============================================================================

interface InsiderOwner {
  owner_id: string;
  ownername: string;
  txns: number;
  companies: number;
  first_trade: string | null;
  last_trade: string | null;
  ever_director: boolean;
  ever_officer: boolean;
  ever_tenpct: boolean;
  asof: string | null;
}

interface InsiderCompany {
  permaticker: number | null;
  ticker: string | null;
  issuername: string | null;
  txns: number;
  acquired_value: number | null;
  disposed_value: number | null;
  net_value: number | null;
  acquired_shares: number | null;
  disposed_shares: number | null;
  latest_shares: number | null;
  latest_value: number | null;
  last_trade: string | null;
}

interface InsiderTxn {
  ticker: string | null;
  issuername: string | null;
  permaticker: number | null;
  filingdate: string | null;
  transactiondate: string | null;
  transactioncode: string | null;
  securityadcode: string | null;
  transactionshares: number | null;
  transactionpricepershare: number | null;
  transactionvalue: number | null;
  sharesownedfollowingtransaction: number | null;
  securitytitle: string | null;
}

// Cross-company totals, precomputed in derived.insider_company (mirrors owner_totals()).
interface InsiderTotals {
  companies: number | string | null;
  txns: number | string | null;
  acquired: number | null;
  disposed: number | null;
  net: number | null;
}

interface InsiderResponse {
  owner: InsiderOwner | null;
  totals: InsiderTotals;
  companies: InsiderCompany[];
  transactions: InsiderTxn[];
}

// Sharadar SF2 transaction-code labels (mirrors insiders.TRANSACTION_CODE_LABELS).
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

// Acquired vs disposed: the authoritative signal is the last char of `securityadcode`
// ('A' = acquired, 'D' = disposed) — mirrors the derived rollup's _DIR_SQL. Fall back to
// the sign of `transactionshares` (SF2 stores disposals negative) when it's absent.
function isAcquireTxn(t: {
  securityadcode: string | null;
  transactionshares: number | null;
}): boolean | null {
  const ad = t.securityadcode?.trim().toUpperCase();
  if (ad) {
    const last = ad.charAt(ad.length - 1);
    if (last === 'A') return true;
    if (last === 'D') return false;
  }
  if (t.transactionshares != null && t.transactionshares !== 0) {
    return t.transactionshares > 0;
  }
  return null;
}

// ============================================================================
// Page
// ============================================================================

export default function InsiderPage({
  params,
}: {
  params: Promise<{ owner_id: string }>;
}) {
  const { owner_id } = use(params);

  const { data, isLoading, error } = useQuery({
    queryKey: ['insider', owner_id],
    queryFn: async () =>
      (await api.get<InsiderResponse>(`/insider/${owner_id}`)).data,
    enabled: !!owner_id,
    staleTime: 1000 * 60 * 10,
  });

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16">
        <div className="flex flex-col items-center justify-center gap-3 text-ink-muted">
          <Spinner className="h-8 w-8 text-green" />
          <span className="text-sm">Loading insider…</span>
        </div>
      </div>
    );
  }

  if (error || !data || !data.owner) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16">
        <Card>
          <EmptyState
            iconName="user"
            title="Insider not found"
            description="No insider with this id, or the data could not be loaded."
          />
        </Card>
      </div>
    );
  }

  return (
    <InsiderView
      ownerId={owner_id}
      owner={data.owner}
      totals={data.totals}
      companies={data.companies}
      transactions={data.transactions}
    />
  );
}

// ============================================================================
// View — receives non-null owner so hooks run unconditionally
// ============================================================================

function InsiderView({
  ownerId,
  owner,
  totals: rawTotals,
  companies,
  transactions,
}: {
  ownerId: string;
  owner: InsiderOwner;
  totals: InsiderTotals;
  companies: InsiderCompany[];
  transactions: InsiderTxn[];
}) {
  // Per-company holdings chart: a dropdown selects one of the insider's companies and
  // we fetch that company's split-adjusted total common-stock holdings curve.
  const companiesWithPt = useMemo(
    () => companies.filter((c) => c.permaticker != null),
    [companies]
  );
  const [selectedPt, setSelectedPt] = useState<string>(
    () => (companiesWithPt[0]?.permaticker != null ? String(companiesWithPt[0].permaticker) : '')
  );
  const selectedCompany = companiesWithPt.find((c) => String(c.permaticker) === selectedPt);

  const { data: holdingsData, isLoading: holdingsLoading } = useQuery({
    queryKey: ['insider-company-holdings', ownerId, selectedPt],
    queryFn: async () =>
      (await api.get<{ series: { pool: string; points: { date: string; shares: number }[] }[] }>(
        `/insider/${ownerId}/holdings?permaticker=${selectedPt}`
      )).data,
    enabled: !!ownerId && !!selectedPt,
    staleTime: 1000 * 60 * 10,
  });

  // Direct / Indirect / Total lines so it's clear which shares are held indirectly.
  const POOL_COLORS: Record<string, string> = {
    Total: '#111111',
    Direct: '#2563eb',
    Indirect: '#f59e0b',
  };
  // Holdings overlays for the price chart: shares on the secondary axis so the position
  // can be read against the stock price.
  const holdingsOverlay = useMemo(
    () =>
      (holdingsData?.series || [])
        .filter((s) => s.points.length > 0)
        .map((s) => ({
          label: `${s.pool} shares`,
          color: POOL_COLORS[s.pool] || '#64748b',
          data: s.points.map((p) => ({ date: p.date, value: p.shares })),
          useSecondaryAxis: true,
          format: 'number' as const,
          dashed: s.pool === 'Indirect',
        })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [holdingsData?.series]
  );

  // Map raw transactions into the {transaction_date, shares, acquired_disposed}
  // shape AcquireDisposeChart consumes.
  const adTransactions = useMemo(
    () =>
      transactions
        .filter((t) => t.transactiondate)
        .map((t) => ({
          transaction_date: t.transactiondate as string,
          shares: Math.abs(t.transactionshares ?? 0),
          acquired_disposed: isAcquireTxn(t) === false ? 'D' : 'A',
        })),
    [transactions]
  );

  // Cross-company totals — prefer the precomputed rollup (owner_totals); fall back to
  // summing the per-company breakdown if it's absent.
  const totals = useMemo(() => {
    const acquired =
      rawTotals.acquired ?? companies.reduce((a, c) => a + (c.acquired_value ?? 0), 0);
    const disposed =
      rawTotals.disposed ?? companies.reduce((a, c) => a + (c.disposed_value ?? 0), 0);
    // sum(txns) can arrive as a string from the serializer; coerce to a number.
    return {
      acquired,
      disposed,
      net: rawTotals.net ?? acquired - disposed,
      companies: Number(rawTotals.companies ?? companies.length),
      txns: Number(rawTotals.txns ?? owner.txns),
    };
  }, [rawTotals, companies, owner.txns]);

  const span =
    owner.first_trade && owner.last_trade
      ? `${owner.first_trade.slice(0, 4)} – ${owner.last_trade.slice(0, 4)}`
      : owner.last_trade
      ? owner.last_trade.slice(0, 4)
      : '';

  const name = titleCase(owner.ownername);

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
        <h1 className="text-3xl font-bold tracking-tight text-ink">{name}</h1>
        <p className="text-sm text-ink-light mt-1">
          Insider
          {span && <> · {span}</>} · {owner.companies.toLocaleString()} compan
          {owner.companies === 1 ? 'y' : 'ies'} · {owner.txns.toLocaleString()}{' '}
          transactions
        </p>
        <div className="flex flex-wrap gap-2 mt-3">
          {owner.ever_officer && <Badge variant="gray">Officer</Badge>}
          {owner.ever_director && <Badge variant="gray">Director</Badge>}
          {owner.ever_tenpct && <Badge variant="gray">10% Owner</Badge>}
        </div>
      </div>

      {/* Activity stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Net activity"
          value={formatCurrency(totals.net)}
          hint={totals.net >= 0 ? 'net buying' : 'net selling'}
          color={totals.net >= 0 ? 'text-green' : 'text-[#dc2626]'}
        />
        <StatCard
          label="Acquired"
          value={formatCurrency(totals.acquired)}
          hint="valued at market"
          color="text-green"
        />
        <StatCard
          label="Disposed"
          value={formatCurrency(totals.disposed)}
          hint="valued at market"
          color="text-[#dc2626]"
        />
        <StatCard
          label="Companies"
          value={totals.companies.toLocaleString()}
          hint={`${totals.txns.toLocaleString()} transactions`}
        />
      </div>

      {/* Acquire vs Dispose */}
      {adTransactions.length > 0 && (
        <Card>
          <h2 className="text-lg font-bold text-ink mb-3">
            Acquire vs Dispose over time
          </h2>
          <div className="h-[320px]">
            <AcquireDisposeChart transactions={adTransactions} />
          </div>
        </Card>
      )}

      {/* Holdings over time, per company (dropdown) */}
      {companiesWithPt.length > 0 && (
        <Card>
          <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
            <h2 className="text-lg font-bold text-ink">Holdings over time</h2>
            <select
              value={selectedPt}
              onChange={(e) => setSelectedPt(e.target.value)}
              className="px-3 py-1.5 text-sm border border-rule rounded-lg bg-white text-ink focus:border-green focus:outline-none max-w-full"
            >
              {companiesWithPt.map((c) => {
                const sh = c.latest_shares != null ? formatNumberCompact(c.latest_shares) : '—';
                const val = c.latest_value != null ? formatCurrency(c.latest_value) : '—';
                return (
                  <option key={String(c.permaticker)} value={String(c.permaticker)}>
                    {(c.ticker || c.issuername || c.permaticker) + ` · ${sh} sh · ${val}`}
                  </option>
                );
              })}
            </select>
          </div>
          <p className="text-xs text-ink-muted mb-3">
            Split-adjusted common-stock shares owned (right axis) over the stock price (left), in{' '}
            {selectedCompany?.issuername || selectedCompany?.ticker || 'the selected company'} —{' '}
            <span className="font-medium" style={{ color: '#2563eb' }}>direct</span> vs{' '}
            <span className="font-medium" style={{ color: '#f59e0b' }}>indirect</span> (trust/fund) ownership.
          </p>
          {holdingsLoading ? (
            <div className="h-[380px] flex items-center justify-center text-ink-faint text-sm">Loading…</div>
          ) : holdingsOverlay.length > 0 ? (
            <PriceChart
              key={selectedPt}
              ticker={selectedPt}
              title=""
              height={400}
              showVolume={false}
              overlayLines={holdingsOverlay}
              showRangeSelector={false}
              showPerformanceReturns={false}
            />
          ) : (
            <EmptyState variant="inline" message="No reported common-stock holdings for this company" />
          )}
        </Card>
      )}

      {/* Companies traded */}
      <Card>
        <h2 className="text-lg font-bold text-ink mb-3">
          Companies traded
          <span className="ml-2 text-sm font-normal text-ink-muted">
            ({companies.length})
          </span>
        </h2>
        {companies.length === 0 ? (
          <EmptyState variant="inline" message="No companies on record" />
        ) : (
          <Table>
            <TableHeader
              columns={[
                'Company',
                'Name',
                'Txns',
                'Net $',
                'Acquired $',
                'Disposed $',
                'Latest Shares',
                'Last Trade',
              ]}
            />
            <tbody>
              {companies.map((c, i) => (
                <TableRow key={`${c.permaticker ?? c.ticker}-${i}`}>
                  <TableCell>
                    {c.permaticker != null ? (
                      <TableLink href={`/company/${c.permaticker}`}>
                        {c.ticker || c.permaticker}
                      </TableLink>
                    ) : (
                      <span className="font-semibold text-ink">
                        {c.ticker || '-'}
                      </span>
                    )}
                  </TableCell>
                  <TableCell muted>{c.issuername || '-'}</TableCell>
                  <TableCell align="right">{c.txns}</TableCell>
                  <TableCell
                    align="right"
                    className={
                      (c.net_value ?? 0) >= 0 ? 'text-green' : 'text-[#dc2626]'
                    }
                  >
                    {formatCurrency(c.net_value)}
                  </TableCell>
                  <TableCell align="right">
                    {formatCurrency(c.acquired_value)}
                  </TableCell>
                  <TableCell align="right">
                    {formatCurrency(c.disposed_value)}
                  </TableCell>
                  <TableCell align="right">
                    {formatNumberCompact(c.latest_shares)}
                  </TableCell>
                  <TableCell align="right">
                    {c.last_trade ? formatDate(c.last_trade) : '-'}
                  </TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {/* Recent transactions */}
      <Card>
        <h2 className="text-lg font-bold text-ink mb-3">
          Recent transactions
          <span className="ml-2 text-sm font-normal text-ink-muted">
            ({transactions.length})
          </span>
        </h2>
        {transactions.length === 0 ? (
          <EmptyState variant="inline" message="No transactions on record" />
        ) : (
          <Table>
            <TableHeader
              columns={[
                'Date',
                'Company',
                'Type',
                'Shares',
                'Price',
                'Value',
                'Owned After',
              ]}
            />
            <tbody>
              {transactions.slice(0, 250).map((t, i) => {
                const shares = t.transactionshares;
                const isAcquire = isAcquireTxn(t) !== false;
                return (
                  <TableRow key={`${t.transactiondate}-${i}`}>
                    <TableCell muted>
                      {t.transactiondate ? formatDate(t.transactiondate) : '-'}
                    </TableCell>
                    <TableCell>
                      {t.permaticker != null ? (
                        <TableLink href={`/company/${t.permaticker}`}>
                          {t.ticker || t.permaticker}
                        </TableLink>
                      ) : (
                        <span className="font-semibold text-ink">
                          {t.ticker || '-'}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {t.transactioncode
                        ? TXN_CODE_LABELS[t.transactioncode] || t.transactioncode
                        : '-'}
                    </TableCell>
                    <TableCell
                      align="right"
                      className={isAcquire ? 'text-green' : 'text-[#dc2626]'}
                    >
                      {shares == null
                        ? '-'
                        : `${isAcquire ? '+' : ''}${formatNumberCompact(shares)}`}
                    </TableCell>
                    <TableCell align="right">
                      {t.transactionpricepershare != null
                        ? formatPerShare(t.transactionpricepershare)
                        : '-'}
                    </TableCell>
                    <TableCell align="right">
                      {formatCurrency(t.transactionvalue)}
                    </TableCell>
                    <TableCell align="right">
                      {formatNumberCompact(t.sharesownedfollowingtransaction)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function StatCard({
  label,
  value,
  hint,
  color = 'text-ink',
}: {
  label: string;
  value: string;
  hint?: string;
  color?: string;
}) {
  return (
    <Card>
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-ink-light">
          {label}
        </p>
        <p className={`text-xl font-bold mt-1 ${color}`}>{value}</p>
        {hint && <p className="text-xs text-ink-muted mt-0.5">{hint}</p>}
      </div>
    </Card>
  );
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}
