'use client';

import Link from 'next/link';
import { Badge } from '@/components/Badge';
import { ScreenerAreaNav } from '@/components/nav/AreaSubNav';
import { ErrorPanel, fmtWhen, PageHeader } from '@/components/research/ResearchBits';
import { errDetail } from '@/hooks/useResearch';
import { useScreens } from '@/hooks/useSavedScreens';
import { useScreenHistory } from '@/hooks/useScreenHistory';
import { ScreenActions } from '../components/ScreenActions';

// Saved screens: every filter you kept (config/screens/<id>.yaml) as a DEFINITION — no
// results. Each shows its live match count, what has been derived from it (snapshots,
// backtests) and the actions to derive more. A screen is a hypothesis about what makes a good investment, so there is rarely
// only one worth holding — you keep several and compare what they surface.
//
// The URL stays /screener/ideas (this page used to be called Ideas) so old links work.

export default function SavedScreensPage() {
  const { data, isLoading, isError, error } = useScreens();
  const history = useScreenHistory();
  const screens = data?.screens ?? [];

  // Counts depend on two other endpoints; say "?" rather than "0" when one is down.
  const snapsKnown = !!history.snapshots.data;
  const btsKnown = !!history.backtests.data;

  return (
    <div className="bg-white min-h-[calc(100vh-4rem)] font-sans">
      <ScreenerAreaNav />
      <PageHeader title="Saved screens">
        Every filter you saved — its settings, and how many stocks it matches today. Take a
        snapshot to keep what it finds, or backtest it to see what it would have found before.
        {data?.asof && <span className="block text-xs text-ink-muted mt-2">Numbers as of {data.asof}</span>}
      </PageHeader>

      <div className="max-w-[1100px] mx-auto px-6 max-md:px-4 py-8 space-y-4">
        {isLoading && <p className="text-sm text-ink-muted">Loading saved screens…</p>}

        {isError && (
          <ErrorPanel title="Could not load saved screens.">
            <p className="m-0">{errDetail(error, 'The API did not answer. Start the backend with ./dev.sh.')}</p>
          </ErrorPanel>
        )}

        {(history.snapshots.isError || history.backtests.isError) && (
          <p className="text-xs text-ink-muted m-0">
            {history.snapshots.isError && 'Snapshot history is unavailable. '}
            {history.backtests.isError && 'Backtest history is unavailable. '}
            Counts marked “?” could not be read.
          </p>
        )}

        {data && screens.length === 0 && (
          <div className="rounded-xl border border-rule bg-white p-5">
            <div className="text-base font-semibold text-ink mb-1">No screens yet</div>
            <p className="text-sm text-ink-light m-0">
              A screen is a filter you saved. Build one on the{' '}
              <Link href="/screener" className="text-green no-underline">filter</Link> tab and save it —
              it lands in <code className="font-mono">config/screens/</code>, where the CLI and the
              backtester read the same file.
            </p>
          </div>
        )}

        {screens.map((s) => {
          const snaps = history.snapshotsFor(s.id);
          const bts = history.backtestsFor(s.id);
          const last = snaps[0];
          return (
            <div key={s.id} className="rounded-xl border border-rule bg-white shadow-sm p-5 space-y-3">
              <div className="flex items-baseline justify-between gap-4 flex-wrap">
                <Link href={`/screener/ideas/${encodeURIComponent(s.id)}`}
                      className="text-base font-semibold text-ink no-underline hover:text-green flex items-center gap-2">
                  {s.title}
                  {s.id === data?.active && <Badge variant="green">active</Badge>}
                </Link>
                {/* A broken spec must say so rather than silently reading as "0 names". */}
                {s.error ? (
                  <span className="text-sm text-neg">unreadable</span>
                ) : (
                  <span className="text-sm text-ink-light tabular-nums whitespace-nowrap">
                    <strong className="text-ink">{s.count?.toLocaleString() ?? '—'}</strong> stock{s.count === 1 ? '' : 's'} now
                  </span>
                )}
              </div>

              {s.description && <p className="text-sm text-ink-light leading-relaxed m-0">{s.description}</p>}
              {s.error && <p className="text-sm text-neg m-0">{s.error}</p>}

              {!!s.criteria?.length && (
                <ul className="flex flex-wrap gap-1.5 list-none m-0 p-0">
                  {s.criteria.slice(0, 4).map((c) => (
                    <li key={c} className="text-xs text-ink-faint bg-surface rounded px-2 py-1">{c}</li>
                  ))}
                  {s.criteria.length > 4 && (
                    <li className="text-xs text-ink-muted px-1 py-1">+{s.criteria.length - 4} more</li>
                  )}
                </ul>
              )}

              <p className="text-xs text-ink-muted m-0 flex gap-x-3 gap-y-1 flex-wrap">
                <span className="font-mono">{s.id}.yaml</span>
                <span>
                  {!snapsKnown ? '? snapshots' : snaps.length === 0 ? 'no snapshots' : (
                    <>
                      {snaps.length} snapshot{snaps.length === 1 ? '' : 's'}, last{' '}
                      <Link href={`/screener/snapshots/${encodeURIComponent(last.id)}`} className="text-green">
                        {fmtWhen(last.created_at)}
                      </Link>
                    </>
                  )}
                </span>
                <span>
                  {!btsKnown ? '? backtests' : bts.length === 0 ? 'no backtests' :
                    `${bts.length} backtest${bts.length === 1 ? '' : 's'}`}
                </span>
              </p>

              {!s.error && <ScreenActions screenId={s.id} showOpen />}
            </div>
          );
        })}

        {screens.length > 0 && (
          <p className="text-xs text-ink-faint pt-2">
            Screens live in <code className="font-mono">config/screens/</code>. The{' '}
            <strong>active</strong> one is what the CLI uses by default —
            set it with <code className="font-mono">ACTIVE_SCREEN</code> in{' '}
            <code className="font-mono">core/.env</code>.
          </p>
        )}
      </div>
    </div>
  );
}
