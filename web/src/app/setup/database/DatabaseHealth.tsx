'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/Badge';
import api from '@/lib/api';

// "The app is hanging and I don't know why" — this page is the answer. It used to be a
// CLI you had to remember existed and reach a terminal to run, which is the wrong shape
// for a problem you first meet through a browser that will not load.

interface Conn {
  pid: number;
  state: string;
  usename: string;
  application_name: string;
  client: string;
  wait_event_type: string;
  wait_event: string;
  blocked_by: number[];
  query: string;
  query_seconds: number | null;
  state_seconds: number | null;
  is_self: boolean;
}

interface Diagnosis {
  total: number;
  active: number;
  idle_in_transaction: { pid: number; seconds: number | null }[];
  blocked: { pid: number; blocked_by: number[] }[];
  blockers: number[];
  /** True only when something is ACTUALLY waiting on a lock. */
  jammed: boolean;
}

interface Health {
  database: string;
  host: string;
  connections: Conn[];
  diagnosis: Diagnosis;
  processes: { pid: number; command: string }[];
}

const STATE_VARIANT: Record<string, 'green' | 'yellow' | 'gray' | 'orange'> = {
  active: 'green',
  idle: 'gray',
  'idle in transaction': 'orange',
  unknown: 'gray',
};

function secs(n: number | null): string {
  if (n == null) return '—';
  if (n < 60) return `${n.toFixed(0)}s`;
  if (n < 3600) return `${Math.floor(n / 60)}m`;
  return `${(n / 3600).toFixed(1)}h`;
}

export function DatabaseHealth() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['setup-database'] });

  const { data, isLoading, isError } = useQuery({
    queryKey: ['setup-database'],
    queryFn: async (): Promise<Health> => (await api.get('/setup/database')).data,
    // A jam is a live situation; keep it current without hammering pg_stat_activity.
    refetchInterval: 4000,
    retry: false,
  });

  const kill = useMutation({
    mutationFn: async (v: { pid: number; what: 'backend' | 'process' }) =>
      (await api.post('/setup/database/kill', v)).data,
    onSuccess: invalidate,
  });
  const unjam = useMutation({
    mutationFn: async () => (await api.post('/setup/database/unjam', {})).data,
    onSuccess: invalidate,
  });

  if (isError) {
    return (
      <div className="max-w-[1100px] mx-auto px-6 py-10">
        <div className="rounded-xl border border-rule bg-white p-6 text-sm text-ink-light">
          Could not reach the setup API — which, if the database itself is jammed, may be
          the symptom rather than the problem. Check that the backend is running.
        </div>
      </div>
    );
  }

  const d = data?.diagnosis;
  const blockedPids = new Set((d?.blocked ?? []).map((b) => b.pid));
  const blockerPids = new Set(d?.blockers ?? []);

  return (
    <div className="max-w-[1100px] mx-auto px-6 py-10 space-y-6">
      {/* ------------------------------------------------------- the verdict */}
      {d?.jammed ? (
        <div className="rounded-xl border border-red bg-red-soft p-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="text-sm font-semibold text-red">
                Lock jam — {d.blocked.length} connection
                {d.blocked.length === 1 ? '' : 's'} waiting on{' '}
                {d.blockers.length} blocker{d.blockers.length === 1 ? '' : 's'}
              </div>
              <p className="mt-1.5 text-sm text-ink-light">
                Terminate the <strong>blocker</strong> (pid{d.blockers.length === 1 ? '' : 's'}{' '}
                {d.blockers.join(', ') || '—'}), not the connections waiting on it —
                killing a blocked connection frees nothing.
              </p>
            </div>
            <button
              type="button"
              onClick={() => unjam.mutate()}
              disabled={unjam.isPending}
              className="rounded-lg bg-red px-4 py-2 text-sm font-medium text-white border-0
                         cursor-pointer hover:opacity-90 disabled:opacity-60"
            >
              {unjam.isPending ? 'Clearing…' : 'Unjam everything'}
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-rule bg-white p-5 flex items-center
                        justify-between gap-4 flex-wrap">
          <div className="text-sm text-ink-light">
            No lock jam. {d?.active ?? 0} active of {d?.total ?? 0} connections to{' '}
            <span className="font-medium text-ink">{data?.database}</span> on {data?.host}.
          </div>
          <Badge variant="green">Healthy</Badge>
        </div>
      )}

      {/* Idle-in-transaction is worth surfacing but is NOT a jam: an ingest parks one to
          hold the derived-rebuild guard for its whole run. Saying otherwise would invite
          someone to kill the thing protecting the ingest they are waiting for. */}
      {!!d?.idle_in_transaction?.length && (
        <div className="rounded-xl border border-rule bg-white p-4 text-sm text-ink-light">
          <span className="font-medium text-ink">
            {d.idle_in_transaction.length} idle transaction
            {d.idle_in_transaction.length === 1 ? '' : 's'}
          </span>{' '}
          ({d.idle_in_transaction.map((x) => `pid ${x.pid}, ${secs(x.seconds)}`).join(' · ')}).
          Not a jam on its own — a running ingest holds one deliberately to stop the app
          rebuilding derived tables underneath it.
        </div>
      )}

      {/* ------------------------------------------------------- connections */}
      <div className="rounded-xl border border-rule bg-white overflow-hidden">
        <div className="px-6 py-4 border-b border-rule">
          <h2 className="text-sm font-semibold text-ink uppercase tracking-wide">
            Connections {data && `(${data.connections.length})`}
          </h2>
        </div>
        {isLoading && <p className="px-6 py-8 text-sm text-ink-muted">Loading…</p>}
        {data && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-ink-faint">
                  <th className="px-6 py-2 font-medium">PID</th>
                  <th className="px-3 py-2 font-medium">State</th>
                  <th className="px-3 py-2 font-medium">Waiting on</th>
                  <th className="px-3 py-2 font-medium">For</th>
                  <th className="px-3 py-2 font-medium">Query</th>
                  <th className="px-6 py-2 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.connections.map((c) => {
                  const isBlocked = blockedPids.has(c.pid);
                  const isBlocker = blockerPids.has(c.pid);
                  return (
                    <tr
                      key={c.pid}
                      className={`border-t border-rule align-top ${isBlocker ? 'bg-red-soft' : ''}`}
                    >
                      <td className="px-6 py-3 tabular-nums text-ink">
                        {c.pid}
                        {c.is_self && <div className="text-xs text-ink-muted">this page</div>}
                        {isBlocker && (
                          <div className="text-xs font-semibold text-red">blocker</div>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <Badge variant={STATE_VARIANT[c.state] ?? 'gray'}>{c.state}</Badge>
                      </td>
                      <td className="px-3 py-3 text-xs">
                        {isBlocked ? (
                          <span className="text-red font-medium">
                            blocked by {c.blocked_by.join(', ')}
                          </span>
                        ) : c.wait_event_type ? (
                          <span className="text-ink-muted">
                            {c.wait_event_type}: {c.wait_event}
                          </span>
                        ) : (
                          <span className="text-ink-muted">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-xs text-ink-light">
                        {secs(c.state === 'active' ? c.query_seconds : c.state_seconds)}
                      </td>
                      <td className="px-3 py-3">
                        <code className="text-[0.7rem] text-ink-light break-all line-clamp-2">
                          {c.query || '—'}
                        </code>
                      </td>
                      <td className="px-6 py-3 text-right">
                        {c.is_self ? (
                          <span className="text-xs text-ink-muted">—</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => kill.mutate({ pid: c.pid, what: 'backend' })}
                            disabled={kill.isPending}
                            className={`rounded-md border px-2.5 py-1 text-xs cursor-pointer
                              ${isBlocker
                                ? 'border-red bg-white text-red font-medium hover:opacity-80'
                                : 'border-rule bg-white text-ink-muted hover:border-red hover:text-red'}`}
                          >
                            Terminate
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

      {/* ------------------------------------------------------- processes */}
      <div className="rounded-xl border border-rule bg-white overflow-hidden">
        <div className="px-6 py-4 border-b border-rule">
          <h2 className="text-sm font-semibold text-ink uppercase tracking-wide">
            This project&apos;s processes {data && `(${data.processes.length})`}
          </h2>
        </div>
        {data?.processes.length === 0 && (
          <p className="px-6 py-6 text-sm text-ink-muted">
            No ingest or API processes running besides this one.
          </p>
        )}
        {data && data.processes.length > 0 && (
          <table className="w-full text-sm border-collapse">
            <tbody>
              {data.processes.map((p) => (
                <tr key={p.pid} className="border-t border-rule">
                  <td className="px-6 py-3 tabular-nums text-ink w-24">{p.pid}</td>
                  <td className="px-3 py-3">
                    <code className="text-[0.7rem] text-ink-light break-all">{p.command}</code>
                  </td>
                  <td className="px-6 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => kill.mutate({ pid: p.pid, what: 'process' })}
                      disabled={kill.isPending}
                      className="rounded-md border border-rule bg-white px-2.5 py-1 text-xs
                                 text-ink-muted cursor-pointer hover:border-red hover:text-red"
                    >
                      Stop
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {kill.isError && (
        <p className="text-sm text-red bg-red-soft rounded-lg px-3 py-2">
          {(kill.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail
            ?? 'Could not terminate that one.'}
        </p>
      )}
    </div>
  );
}
