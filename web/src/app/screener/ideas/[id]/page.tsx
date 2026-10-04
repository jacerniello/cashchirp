'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { Badge } from '@/components/Badge';
import { ScreenerAreaNav } from '@/components/nav/AreaSubNav';
import { ErrorPanel, fmtWhen, SectionCard } from '@/components/research/ResearchBits';
import type { BacktestListItem } from '@/hooks/useBacktests';
import { ReportStatusBadge } from '@/components/research/Reports';
import { errDetail, isNotFound, useReports, type ReportSummary, type SnapshotSummary } from '@/hooks/useResearch';
import { useScreen, useScreens } from '@/hooks/useSavedScreens';
import { useScreenHistory } from '@/hooks/useScreenHistory';
import { headline, pct, signClass } from '../../../backtests/format';
import { ScreenActions } from '../../components/ScreenActions';
import { ScreenSpec } from '../../components/ScreenSpec';

// One saved screen (config/screens/<id>.yaml). A screen is SETTINGS — this page shows its
// definition, never its results. Results exist only as things derived from it: snapshots
// (what it found on a given day), reports (analysis runs on a snapshot) and backtests (what it would have found in the past).
//
// Layout: the definition, then one DerivedSection per kind of derived item. To add a kind,
// add a section to the list at the bottom of the page.

/** One list of things made from this screen, with its own loading / error / empty state —
 *  each comes from a different endpoint and can fail on its own. */
function DerivedSection<T>({
  title,
  query,
  items,
  empty,
  render,
  rowKey,
}: {
  title: string;
  query: { isLoading: boolean; isError: boolean; error: unknown; data?: unknown };
  items: T[];
  empty: ReactNode;
  render: (item: T) => ReactNode;
  rowKey: (item: T) => string;
}) {
  return (
    <SectionCard title={`${title}${query.data ? ` (${items.length})` : ''}`}>
      {query.isError ? (
        <p className="px-5 py-4 text-sm text-neg m-0">
          Could not load {title.toLowerCase()}: {errDetail(query.error)}
        </p>
      ) : query.isLoading ? (
        <p className="px-5 py-4 text-sm text-ink-muted m-0">Loading…</p>
      ) : items.length === 0 ? (
        <p className="px-5 py-4 text-sm text-ink-muted m-0">{empty}</p>
      ) : (
        <ul className="list-none m-0 p-0 divide-y divide-rule-light">
          {items.map((it) => (
            <li key={rowKey(it)} className="px-5 py-2.5 flex items-center justify-between gap-3">
              {render(it)}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function SnapshotRow({ s }: { s: SnapshotSummary }) {
  return (
    <>
      <Link href={`/screener/snapshots/${encodeURIComponent(s.id)}`}
            className="text-sm text-ink no-underline hover:text-green truncate">
        {s.name}
        {s.error && <span className="ml-2 text-[11px] text-neg">unreadable file</span>}
      </Link>
      <span className="text-xs text-ink-muted tabular-nums whitespace-nowrap">
        {s.count ?? '—'} kept{s.removed_count ? ` · ${s.removed_count} trimmed` : ''}
        {' · '}data {fmtWhen(s.asof)} · taken {fmtWhen(s.created_at, true)}
      </span>
    </>
  );
}

function ReportRow({ r }: { r: ReportSummary }) {
  return (
    <>
      <Link href={`/research/reports/${encodeURIComponent(r.id)}`}
            className="text-sm text-ink no-underline hover:text-green truncate">
        {r.name}
        {r.error && <span className="ml-2 text-[11px] text-neg">unreadable file</span>}
      </Link>
      <span className="text-xs text-ink-muted tabular-nums whitespace-nowrap flex items-center gap-2">
        <ReportStatusBadge status={r.status} />
        {r.analysed_count ?? 0}/{r.member_count ?? 0} analysed · {fmtWhen(r.created_at)}
      </span>
    </>
  );
}

function BacktestRow({ r }: { r: BacktestListItem }) {
  const h = headline(r);
  return (
    <>
      <div className="min-w-0">
        {r.error ? (
          <span className="text-sm text-ink">{r.id} <span className="text-[11px] text-neg">{r.error}</span></span>
        ) : (
          <Link href={`/backtests/${encodeURIComponent(r.id)}`} className="text-sm text-ink no-underline hover:text-green">
            {r.name ?? r.id}
          </Link>
        )}
        <div className="text-xs text-ink-muted">
          {r.kind ?? '—'} · {r.summary?.start ?? r.params?.start ?? '—'} → {r.summary?.end ?? r.params?.end ?? '—'}
          {r.serious_warnings > 0 && (
            <span className="text-neg"> · {r.serious_warnings} sanity warning{r.serious_warnings > 1 ? 's' : ''}</span>
          )}
        </div>
      </div>
      <div className="text-right tabular-nums whitespace-nowrap">
        <span className={`text-sm font-semibold ${signClass(h.main)}`}>{pct(h.main)}</span>
        <span className="text-xs text-ink-muted"> vs {pct(h.bench)} {r.params?.benchmark ?? ''}</span>
        <div className="text-[0.7rem] text-ink-faint">{h.label}</div>
      </div>
    </>
  );
}

export default function SavedScreenPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(params.id ?? '');
  const screenQ = useScreen(id);
  const list = useScreens(); // carries each screen's live match count
  const history = useScreenHistory();
  const reports = useReports();
  const reportsHere = (reports.data ?? []).filter(
    (r) => r.source?.kind === 'snapshot' && r.source.screen_id === id,
  );
  const d = screenQ.data;
  const listed = list.data?.screens.find((s) => s.id === id);

  return (
    <div className="bg-white min-h-[calc(100vh-4rem)] font-sans">
      <ScreenerAreaNav />
      <div className="max-w-[1100px] mx-auto px-6 max-md:px-4 py-8 space-y-6">
        <Link href="/screener/ideas" className="text-xs text-ink-muted hover:text-green no-underline">← All saved screens</Link>

        {screenQ.isLoading && <p className="text-sm text-ink-muted">Loading screen…</p>}
        {screenQ.isError && (
          // A missing screen is not a transient failure — "try again" would be a lie.
          <ErrorPanel title={isNotFound(screenQ.error) ? `No saved screen called “${id}”.` : 'Could not load this screen.'}>
            <p className="m-0">
              {isNotFound(screenQ.error)
                ? 'It may have been renamed or deleted. Screens live in config/screens/.'
                : errDetail(screenQ.error, 'The API did not answer. Check that the backend is running.')}
            </p>
          </ErrorPanel>
        )}

        {/* ---- Definition ---- */}
        {d && (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-6 flex-wrap">
              <div className="space-y-2 min-w-0 flex-1">
                <h1 className="text-[1.75rem] font-bold tracking-tight text-ink m-0 flex items-center gap-3 flex-wrap">
                  {d.title || id}
                  {d.active && <Badge variant="green">active</Badge>}
                </h1>
                <p className="text-sm text-ink-light m-0 whitespace-pre-line">
                  {d.description || <span className="text-ink-muted">No description.</span>}
                </p>
                <p className="text-xs text-ink-muted m-0">
                  <code className="font-mono">config/screens/{d.id}.yaml</code>
                </p>
              </div>
              <div className="rounded-xl border border-rule bg-white px-5 py-3 text-center shrink-0">
                <div className="text-2xl font-bold text-ink tabular-nums">
                  {listed?.count != null ? listed.count.toLocaleString() : '—'}
                </div>
                <div className="text-xs text-ink-muted">
                  {list.isError ? 'match count unavailable' : list.isLoading ? 'counting…' : 'stocks match today'}
                  {list.data?.asof && <div>data as of {list.data.asof}</div>}
                </div>
              </div>
            </div>

            <ScreenActions screenId={d.id} />

            <SectionCard title="Definition">
              <div className="p-5 space-y-5">
                {d.criteria?.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint m-0 mb-2">In words</h3>
                    <ul className="list-none m-0 p-0 space-y-1.5">
                      {d.criteria.map((c) => (
                        <li key={c} className="flex items-start gap-2 text-sm text-ink-light">
                          <span className="mt-0.5 text-green">•</span>
                          <span>{c}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <ScreenSpec spec={d.spec ?? {}} />
                {d.lossy?.length > 0 && (
                  <p className="text-xs text-ink-muted m-0">
                    The filter grid has no widget for: {d.lossy.join('; ')}. These still apply whenever
                    the screen runs; <em>Edit in screener</em> keeps them on re-save.
                  </p>
                )}
              </div>
            </SectionCard>
          </div>
        )}

        {/* ---- Derived from this screen ----
            Shown even if the definition failed to load: these come from other endpoints and
            are still true. One DerivedSection per kind; add a kind by adding a section. */}
        <div className="space-y-6">
          <DerivedSection
            title="Snapshots"
            query={history.snapshots}
            items={history.snapshotsFor(id)}
            rowKey={(s) => s.id}
            render={(s) => <SnapshotRow s={s} />}
            empty={<>None yet. <em>Take snapshot now</em> freezes what this screen finds today, so you can trim it, start a report on it and compare later.</>}
          />
          <DerivedSection
            title="Reports"
            query={reports}
            items={reportsHere}
            rowKey={(r) => r.id}
            render={(r) => <ReportRow r={r} />}
            empty={<>None yet. Open a snapshot of this screen and <em>Start a report</em> to analyse what it caught.</>}
          />
          <DerivedSection
            title="Backtests"
            query={history.backtests}
            items={history.backtestsFor(id)}
            rowKey={(r) => r.id}
            render={(r) => <BacktestRow r={r} />}
            empty={<>None yet. <em>Backtest this screen</em> shows what it would have picked in the past, and what happened next.</>}
          />
        </div>
      </div>
    </div>
  );
}
