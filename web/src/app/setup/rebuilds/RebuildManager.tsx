'use client';

import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/Badge';
import api from '@/lib/api';
import { useDatasetJob } from '@/hooks/useSetup';
import { useScheduleMutations, type Schedule } from '@/hooks/useJobs';

interface RebuildResult {
  rows: number;
  old_total: number;
  added: number | null;
  removed: number | null;
  changed: number | null;
  watermark: string | null;
}

interface RebuildTable {
  key: string;
  label: string;
  table: string;
  size_bytes: number | null;
  last_rebuild_at: string | null;
  last_result: RebuildResult | null;
  running: boolean;
  schedules: Schedule[];
}

interface RebuildsResponse {
  tables: RebuildTable[];
  free_bytes: number | null;
  headroom: number;
  not_rebuildable: Record<string, string>;
}

function gb(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n < 1e9) return `${Math.max(1, Math.round(n / 1e6))} MB`;
  return `${(n / 1e9).toFixed(1)} GB`;
}

function when(ts: string | null): string {
  if (!ts) return 'never';
  return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function errDetail(e: unknown, fallback: string): string {
  return (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? fallback;
}

export function RebuildManager() {
  const qc = useQueryClient();
  const { run, stop } = useDatasetJob();
  const { create, remove } = useScheduleMutations();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['setup-rebuilds'],
    queryFn: async (): Promise<RebuildsResponse> => (await api.get('/setup/rebuilds')).data,
    refetchInterval: (q) => (q.state.data?.tables.some((t) => t.running) ? 5000 : 30000),
    retry: false,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['setup-rebuilds'] });

  if (isError) {
    return (
      <div className="max-w-[1100px] mx-auto px-6 py-10">
        <div className="rounded-xl border border-rule bg-white p-6 text-sm text-ink-light">
          Could not load the rebuild list. Check that the backend is running.
        </div>
      </div>
    );
  }

  const free = data?.free_bytes ?? null;
  const headroom = data?.headroom ?? 1.25;
  const anyRunning = data?.tables.some((t) => t.running) ?? false;

  const start = (t: RebuildTable) => {
    const ok = window.confirm(
      `Rebuild ${t.table} (${gb(t.size_bytes)})?\n\nDownloads the full export into a fresh ` +
        `copy, checks it, then swaps it in. The live table keeps serving until the swap.`,
    );
    if (ok) run.mutate({ key: t.key, mode: 'full' }, { onSuccess: refresh });
  };

  const scheduleMonthly = (t: RebuildTable) =>
    create.mutate(
      { key: t.key, cadence: 'monthly', mode: 'full', weekday: 6, at_time: '03:00',
        note: 'monthly full rebuild' },
      { onSuccess: refresh },
    );

  return (
    <div className="max-w-[1100px] mx-auto px-6 py-10 space-y-6">
      <div className="rounded-xl border border-rule bg-white p-5 text-sm text-ink-light space-y-2">
        <p>
          The daily sync only fetches rows newer than each table&apos;s watermark, so it misses
          retroactive edits and never removes rows Sharadar has deleted. A rebuild reloads the
          whole table into a copy, refuses to swap if the copy looks short, counts what
          changed, then replaces the live table in one quick step.
        </p>
        <p>
          Free disk: <span className="font-medium text-ink">{gb(free)}</span>. Each rebuild
          needs about {headroom}× the table&apos;s size free while both copies exist. Run{' '}
          <Link href="/setup/derived" className="text-ink underline">Derived</Link> afterwards,
          and follow progress on{' '}
          <Link href="/setup/runs" className="text-ink underline">Runs</Link>.
        </p>
      </div>

      <div className="rounded-xl border border-rule bg-white overflow-hidden">
        <div className="px-6 py-4 border-b border-rule">
          <h2 className="text-sm font-semibold text-ink uppercase tracking-wide">
            Tables {data && `(${data.tables.length})`}
          </h2>
        </div>
        {isLoading && <p className="px-6 py-8 text-sm text-ink-muted">Loading…</p>}
        {data && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-ink-faint">
                  <th className="px-6 py-2 font-medium">Table</th>
                  <th className="px-3 py-2 font-medium text-right">Size</th>
                  <th className="px-3 py-2 font-medium">Last rebuild</th>
                  <th className="px-3 py-2 font-medium">Schedule</th>
                  <th className="px-6 py-2 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.tables.map((t) => {
                  const r = t.last_result;
                  const short =
                    free != null && t.size_bytes != null && free < t.size_bytes * headroom;
                  const sched = t.schedules[0];
                  return (
                    <tr key={t.key} className="border-t border-rule align-top">
                      <td className="px-6 py-3">
                        <div className="text-ink font-medium">{t.table}</div>
                        <div className="text-xs text-ink-muted">{t.label}</div>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-ink-light">
                        {gb(t.size_bytes)}
                      </td>
                      <td className="px-3 py-3 text-xs">
                        <div className="text-ink">{when(t.last_rebuild_at)}</div>
                        {r && r.added != null && (
                          <div className="text-ink-muted tabular-nums">
                            +{r.added.toLocaleString()} added · −{r.removed?.toLocaleString()}{' '}
                            removed · {r.changed?.toLocaleString()} changed
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3 text-xs">
                        {sched ? (
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-ink-light">{sched.summary}</span>
                            <button
                              type="button"
                              onClick={() => remove.mutate(sched.id, { onSuccess: refresh })}
                              className="text-ink-muted underline cursor-pointer bg-transparent border-0 p-0 hover:text-red"
                            >
                              remove
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => scheduleMonthly(t)}
                            disabled={create.isPending}
                            className="rounded-md border border-rule bg-white px-2.5 py-1 text-xs
                                       text-ink-light cursor-pointer hover:border-green"
                          >
                            Schedule monthly
                          </button>
                        )}
                      </td>
                      <td className="px-6 py-3 text-right">
                        {t.running ? (
                          <div className="flex items-center justify-end gap-2">
                            <Badge variant="green">running</Badge>
                            <button
                              type="button"
                              onClick={() => stop.mutate(t.key, { onSuccess: refresh })}
                              className="rounded-md border border-rule bg-white px-2.5 py-1 text-xs
                                         text-ink-muted cursor-pointer hover:border-red hover:text-red"
                            >
                              Stop
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => start(t)}
                            disabled={run.isPending || short}
                            title={short ? 'Not enough free disk for a second copy' : undefined}
                            className="rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-white
                                       border-0 cursor-pointer hover:opacity-90
                                       disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            {short ? 'Not enough disk' : 'Rebuild'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {data && Object.keys(data.not_rebuildable).length > 0 && (
        <p className="text-xs text-ink-muted">
          Not listed:{' '}
          {Object.entries(data.not_rebuildable).map(([k, why]) => `${k} — ${why}`).join(' ')}
        </p>
      )}
      {anyRunning && (
        <p className="text-xs text-ink-muted">
          Rebuilds run one table each; starting several at once means several copies on disk
          at the same time.
        </p>
      )}
      {(run.isError || create.isError) && (
        <p className="text-sm text-red bg-red-soft rounded-lg px-3 py-2">
          {errDetail(run.error ?? create.error, 'That did not work.')}
        </p>
      )}
    </div>
  );
}
