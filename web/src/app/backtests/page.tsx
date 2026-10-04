'use client';

import Link from 'next/link';
import { Badge } from '@/components/Badge';
import { TableStates } from '@/components/TableStates';
import {
  errorText,
  useBacktests,
  useDeleteBacktest,
  type BacktestListItem,
} from '@/hooks/useBacktests';
import { RunBacktestForm } from './RunBacktestForm';
import { pct, signClass, when } from './format';

// Saved backtest reports. Each is a folder under <research_dir>/backtests/ — plain files,
// gitignored — written by `python -m core.backend.backtest.run` (or the form below, which
// runs that same command).

function headline(r: BacktestListItem) {
  const s = r.summary ?? {};
  if (r.kind === 'cohort') {
    return {
      main: s.mean_return as number | null,
      bench: s.bench_mean_return as number | null,
      label: `mean ${r.params?.hold_months ?? '?'}m fwd`,
      dd: null,
    };
  }
  return {
    main: s.cagr as number | null,
    bench: s.bench_cagr as number | null,
    label: 'CAGR',
    dd: s.max_drawdown as number | null,
  };
}

export default function BacktestsPage() {
  const { data, isLoading, isError, error } = useBacktests();
  const del = useDeleteBacktest();
  const reports = data?.reports ?? [];

  const remove = (r: BacktestListItem) => {
    if (window.confirm(`Delete the report “${r.name ?? r.id}”? This removes its folder from disk.`)) {
      del.mutate(r.id);
    }
  };

  return (
    <div className="bg-white min-h-[calc(100vh-4rem)] font-sans">
      <div className="py-12 px-8 pb-8 text-center border-b border-rule">
        <h1 className="font-sans text-[2rem] font-bold tracking-tight text-ink mb-2">Backtests</h1>
        <p className="text-base text-ink-light max-w-2xl mx-auto">
          What a saved screen would have picked with only the data public at the time, and
          what those names did next — against SPY and against the screen&apos;s own universe.
        </p>
      </div>

      <div className="max-w-[1200px] mx-auto px-6 py-10 space-y-8">
        <RunBacktestForm />

        <div className="rounded-xl border border-rule bg-white overflow-hidden">
          <div className="px-6 py-4 border-b border-rule flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-ink">Saved reports</h2>
            {data?.root && <span className="text-xs font-mono text-ink-faint truncate">{data.root}</span>}
          </div>
          {del.isError && (
            <p className="px-6 py-3 text-sm text-neg border-b border-rule">
              Delete failed: {errorText(del.error)}
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-ink-faint">
                  <th className="px-6 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Screen</th>
                  <th className="px-3 py-2 font-medium">Kind</th>
                  <th className="px-3 py-2 font-medium">Period</th>
                  <th className="px-3 py-2 font-medium text-right">Strategy</th>
                  <th className="px-3 py-2 font-medium text-right">Benchmark</th>
                  <th className="px-3 py-2 font-medium text-right">Max DD</th>
                  <th className="px-3 py-2 font-medium">Created</th>
                  <th className="px-6 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                <TableStates
                  colSpan={9}
                  rows={4}
                  loading={isLoading}
                  error={isError ? error : null}
                  errorText={`Could not load reports: ${errorText(error)}`}
                  empty={!isLoading && !isError && reports.length === 0}
                  emptyText="No saved backtests yet. Run one above, or from a terminal: python -m core.backend.backtest.run --screen <id>"
                />
                {reports.map((r) => {
                  const h = headline(r);
                  return (
                    <tr key={r.id} className="border-t border-rule align-middle">
                      <td className="px-6 py-3">
                        {r.error ? (
                          <div>
                            <div className="font-medium text-ink">{r.id}</div>
                            <div className="text-xs text-neg">{r.error}</div>
                          </div>
                        ) : (
                          <Link href={`/backtests/${r.id}`} className="font-medium text-ink no-underline hover:text-green">
                            {r.name ?? r.id}
                          </Link>
                        )}
                        {r.serious_warnings > 0 && (
                          <div className="mt-1">
                            <Badge variant="red">{r.serious_warnings} sanity warning{r.serious_warnings > 1 ? 's' : ''}</Badge>
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3 text-ink-light">{r.screen?.title ?? r.screen?.id ?? '—'}</td>
                      <td className="px-3 py-3">
                        {r.kind && <Badge variant={r.kind === 'portfolio' ? 'blue' : 'purple'}>{r.kind}</Badge>}
                      </td>
                      <td className="px-3 py-3 text-ink-light text-xs whitespace-nowrap">
                        {r.summary?.start ?? r.params?.start ?? '—'} → {r.summary?.end ?? r.params?.end ?? '—'}
                        {r.params && <div className="text-ink-faint">every {r.params.rebalance_months}m</div>}
                      </td>
                      <td className={`px-3 py-3 text-right tabular-nums font-semibold ${signClass(h.main)}`}>
                        {pct(h.main)}
                        <div className="text-[0.7rem] font-normal text-ink-faint">{h.label}</div>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-ink-light">
                        {pct(h.bench)}
                        <div className="text-[0.7rem] text-ink-faint">{r.params?.benchmark ?? ''}</div>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-ink-light">{pct(h.dd)}</td>
                      <td className="px-3 py-3 text-xs text-ink-light whitespace-nowrap">{when(r.created_at)}</td>
                      <td className="px-6 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => remove(r)}
                          disabled={del.isPending}
                          className="rounded-md border border-rule bg-white px-2.5 py-1 text-xs text-ink-light
                                     cursor-pointer hover:border-neg hover:text-neg disabled:opacity-40"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
