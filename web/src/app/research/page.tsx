'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ResearchAreaNav } from './ResearchAreaNav';
import { TableStates } from '@/components/TableStates';
import {
  ClaudeInstruction,
  DocIndicators,
  ErrorPanel,
  fmtSignedPct,
  fmtWhen,
  GroupChips,
  inputCls,
  PageHeader,
  RatingPill,
} from '@/components/research/ResearchBits';
import {
  ratingScore,
  toNum,
  useResearchGuide,
  useResearchIndex,
  useSnapshots,
  type ResearchStock,
} from '@/hooks/useResearch';
import { PriceThenNow, priceMove, RatingChange, StaleBadge, staleReason } from '@/components/research/Reports';
import { tableStyles } from '@/lib/styles';

// The latest analysis of every stock across all reports — one row per stock, each showing
// which report it came from, when, the rating it got and how that compares with the
// analysis before it. Stocks with notes but no analysis are listed unrated.

type SortKey = 'rating' | 'ticker' | 'name' | 'confidence' | 'upside' | 'asof' | 'move';

const CONF_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };

function sortValue(s: ResearchStock, k: SortKey): string | number | null {
  switch (k) {
    case 'rating': return ratingScore(s.rating);
    case 'ticker': return (s.ticker ?? '').toUpperCase() || null;
    case 'name': return (s.name ?? '').toLowerCase() || null;
    case 'confidence': return CONF_RANK[String(s.rating?.confidence ?? '').toLowerCase()] ?? null;
    case 'upside': return toNum(s.rating?.upside_base_pct);
    case 'asof': return s.asof ?? s.report?.created_at ?? null;
    case 'move': return priceMove(s.price_at_analysis, s.price_now);
  }
}

export default function RankingsPage() {
  const router = useRouter();
  const { data, isLoading, isError } = useResearchIndex();
  const guide = useResearchGuide();
  const snaps = useSnapshots();
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'rating', desc: true });
  const [group, setGroup] = useState('');
  const [ddOnly, setDdOnly] = useState(false);
  const [staleOnly, setStaleOnly] = useState(false);
  const [q, setQ] = useState('');

  const stocks = useMemo(() => data?.stocks ?? [], [data]);
  const groupOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of stocks) for (const g of s.groups ?? []) m.set(g.id, g.name);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [stocks]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = stocks.filter((s) =>
      (!group || (s.groups ?? []).some((g) => g.id === group)) &&
      (!ddOnly || s.has_dd) &&
      (!staleOnly || !!(s.has_dd && staleReason(s.asof, s.price_at_analysis, s.price_now))) &&
      (!needle || `${s.ticker ?? ''} ${s.name ?? ''}`.toLowerCase().includes(needle)),
    );
    // Missing values always sort last, whichever the direction.
    return [...filtered].sort((a, b) => {
      const va = sortValue(a, sort.key);
      const vb = sortValue(b, sort.key);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      const c = va < vb ? -1 : va > vb ? 1 : 0;
      return sort.desc ? -c : c;
    });
  }, [stocks, group, ddOnly, staleOnly, q, sort]);

  const latestSnap = snaps.data?.[0]?.id;
  const root = guide.data?.root ?? data?.root;

  function header(key: SortKey, label: string, num = false) {
    const active = sort.key === key;
    return (
      <th className={num ? tableStyles.thNum : tableStyles.th}>
        <button
          type="button"
          onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== 'ticker' && key !== 'name' }))}
          className={`bg-transparent border-0 p-0 cursor-pointer uppercase tracking-[0.04em] text-[11px] font-semibold ${active ? 'text-ink' : 'text-ink-muted'} hover:text-ink`}
        >
          {label}{active ? (sort.desc ? ' ↓' : ' ↑') : ''}
        </button>
      </th>
    );
  }

  return (
    <div className="bg-white min-h-[calc(100vh-4rem)] font-sans">
      <ResearchAreaNav />
      <PageHeader title="Rankings">
        The latest analysis of every stock, across all your reports, ranked by its DD rating (1–6) —
        with the report it came from, the rating before it, and how far the price has moved since.
        Flagged <em>stale</em> when it is over 90 days old or the price has moved more than 20%.
      </PageHeader>

      <div className="max-w-[1200px] mx-auto px-6 max-md:px-4 py-8 space-y-6">
        {isError ? (
          <ErrorPanel title="Could not load your research.">
            <p className="m-0">
              The research API did not answer. Check that the backend is running and that its
              research folder (<code className="font-mono">RESEARCH_DIR</code>) is readable.
            </p>
          </ErrorPanel>
        ) : (
          <div className="rounded-xl border border-rule bg-white overflow-hidden">
            {data?.prices_error && (
              <p className="px-5 pt-3 m-0 text-xs text-ink-muted">Today&apos;s prices are unavailable ({data.prices_error}).</p>
            )}
            <div className="px-5 py-3 border-b border-rule flex items-center justify-between gap-3 flex-wrap">
              <h2 className="text-sm font-semibold text-ink uppercase tracking-wide m-0">
                Rankings {data && `(${rows.length}${rows.length !== stocks.length ? ` of ${stocks.length}` : ''})`}
              </h2>
              <div className="flex items-center gap-2 flex-wrap">
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter ticker / name"
                       className={`${inputCls} w-44`} />
                <select value={group} onChange={(e) => setGroup(e.target.value)} className={inputCls}>
                  <option value="">All groups</option>
                  {groupOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </select>
                <label className="text-sm text-ink-light flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={ddOnly} onChange={(e) => setDdOnly(e.target.checked)} />
                  Has DD
                </label>
                <label className="text-sm text-ink-light flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={staleOnly} onChange={(e) => setStaleOnly(e.target.checked)} />
                  Stale only
                </label>
              </div>
            </div>
            <div className={tableStyles.container}>
              <table className={tableStyles.table}>
                <thead>
                  <tr>
                    {header('rating', 'Rating')}
                    <th className={tableStyles.th}>Change</th>
                    {header('ticker', 'Ticker')}
                    {header('name', 'Name')}
                    {header('confidence', 'Confidence')}
                    {header('upside', 'Base upside', true)}
                    {header('move', 'Price then → now', true)}
                    <th className={tableStyles.th}>Report</th>
                    {header('asof', 'As of', true)}
                    <th className={tableStyles.th}>Docs</th>
                    <th className={tableStyles.th}>Groups</th>
                  </tr>
                </thead>
                <tbody>
                  <TableStates
                    loading={isLoading}
                    empty={!!data && rows.length === 0 && stocks.length > 0}
                    colSpan={11}
                    rows={6}
                    emptyText="No stocks match these filters."
                  />
                  {rows.map((s) => {
                    const up = toNum(s.rating?.upside_base_pct);
                    return (
                      <tr
                        key={s.permaticker}
                        onClick={() => router.push(`/research/stocks/${s.permaticker}`)}
                        className={`${tableStyles.row} cursor-pointer`}
                        title={s.rating?.one_liner ?? undefined}
                      >
                        <td className={tableStyles.td}><RatingPill rating={s.rating} /></td>
                        <td className={tableStyles.td}>
                          {s.has_dd ? <RatingChange now={s.rating} prev={s.previous?.rating} /> : null}
                        </td>
                        <td className={`${tableStyles.td} font-mono font-semibold`}>
                          <Link href={`/research/stocks/${s.permaticker}`} onClick={(e) => e.stopPropagation()}
                                className="text-ink no-underline hover:text-green">
                            {s.ticker || `#${s.permaticker}`}
                          </Link>
                        </td>
                        <td className={`${tableStyles.td} max-w-[220px] truncate`}>{s.name || '—'}</td>
                        <td className={`${tableStyles.td} text-ink-light`}>{s.rating?.confidence || '—'}</td>
                        <td className={`${tableStyles.tdNum} ${up == null ? '' : up >= 0 ? 'text-pos' : 'text-neg'}`}>
                          {fmtSignedPct(up)}
                        </td>
                        <td className={tableStyles.tdNum}>
                          {s.has_dd ? <PriceThenNow then={s.price_at_analysis} now={s.price_now} nowDate={s.price_date} /> : '—'}
                        </td>
                        <td className={`${tableStyles.td} max-w-[200px] truncate text-xs`}>
                          {s.report ? (
                            <Link href={`/research/reports/${encodeURIComponent(s.report.id)}/stocks/${s.permaticker}`}
                                  onClick={(e) => e.stopPropagation()} className="text-ink-light no-underline hover:text-green"
                                  title={s.report.name ?? s.report.id}>
                              {s.report.name || s.report.id}
                            </Link>
                          ) : <span className="text-ink-muted">—</span>}
                        </td>
                        <td className={`${tableStyles.tdNum} text-xs`}>
                          <span className="inline-flex items-center gap-1.5 justify-end">
                            {s.has_dd && <StaleBadge reason={staleReason(s.asof, s.price_at_analysis, s.price_now)} />}
                            {fmtWhen(s.asof || s.report?.created_at)}
                          </span>
                        </td>
                        <td className={tableStyles.td}>
                          <DocIndicators notes={s.has_notes} dd={s.has_dd} redteam={s.has_redteam} ddError={s.dd_error} />
                        </td>
                        <td className={tableStyles.td}><GroupChips groups={s.groups} max={3} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {data && stocks.length === 0 && (
              <div className="px-6 py-10 text-sm text-ink-light space-y-2 max-w-2xl">
                <p className="font-semibold text-ink m-0">Nothing researched yet.</p>
                <p className="m-0">Research gets here three ways:</p>
                <ul className="list-disc pl-5 m-0 space-y-1">
                  <li>
                    <strong>Notes</strong> — open any stock&apos;s{' '}
                    <span className="font-medium">Research</span> tab on its company page and start writing.
                  </li>
                  <li>
                    <strong>Snapshots</strong> — on the <Link href="/screener" className="text-green">screener</Link>,
                    freeze the current results with <em>Snapshot results</em>, trim it, and group what is left.
                  </li>
                  <li>
                    <strong>Reports</strong> — start a <Link href="/research/reports" className="text-green">report</Link> on
                    a snapshot or group and ask Claude (below) to complete it. Each stock&apos;s latest analysis appears here.
                  </li>
                </ul>
              </div>
            )}
          </div>
        )}

        <ClaudeInstruction
          title="Point Claude at this"
          root={root}
          blurb={
            <>
              Open Claude Code in the research folder — it reads the folder&apos;s CLAUDE.md for the DD
              standard and file layout, and writes reports this page picks up.
              {guide.isError && ' (Could not fetch the folder path from the API.)'}
            </>
          }
          instruction={
            latestSnap
              ? `Start a report on snapshot ${latestSnap}, write a DD for every kept member into it, then red-team the ones rated 5–6.`
              : 'Start a report on snapshot <snapshot-id>, write a DD for every kept member into it, then red-team the ones rated 5–6.'
          }
        />
        {data && (
          <p className="text-xs text-ink-muted text-center m-0">
            {data.reports ?? 0} report{data.reports === 1 ? '' : 's'} · {data.groups} group{data.groups === 1 ? '' : 's'} · {data.snapshots} snapshot{data.snapshots === 1 ? '' : 's'} ·{' '}
            {data.notes} note{data.notes === 1 ? '' : 's'}
          </p>
        )}
      </div>
    </div>
  );
}
