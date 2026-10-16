'use client';

import { Badge } from '@/components/Badge';
import {
  useRestartScheduler,
  useSchedulerHealth,
  useStopScheduler,
  type SchedulerWorker,
} from '@/hooks/useJobs';

// The scheduler's state on the Schedules page: overall status, Stop / Restart, and one
// line per API worker.
//
// Each API worker process runs its own scheduler thread. The advisory lock lets one of
// them fire at a time and the others stand by, so the per-worker list shows which one
// holds the lock and whether the others are ready to take over.

function ago(seconds: number): string {
  if (seconds < 90) return `${Math.round(seconds)}s ago`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

function WorkerRow({ w }: { w: SchedulerWorker }) {
  const variant = w.status === 'ok' ? 'green' : 'red';
  return (
    <li className="flex items-center gap-3 flex-wrap text-xs">
      <Badge variant={variant}>{w.status}</Badge>
      <span className="font-mono text-ink">pid {w.pid}</span>
      <span className="text-ink-faint">
        {w.thread_alive ? `heartbeat ${ago(w.seconds_since_heartbeat)}` : 'no thread'}
        {w.thread_alive && w.holds_lock === true && ' · firing'}
        {w.thread_alive && w.holds_lock === false && ' · standing by'}
        {w.restarts > 0 && ` · restarted ${w.restarts}×`}
        {w.this_worker && ' · answered this request'}
      </span>
      {w.reason && w.status !== 'ok' && <span className="text-red">{w.reason}</span>}
    </li>
  );
}

export function SchedulerPanel() {
  // Poll faster here than the app-wide alert does, so the heartbeat reads as live.
  const { data: health } = useSchedulerHealth(true, 5000);
  const restart = useRestartScheduler();
  const stop = useStopScheduler();
  const busy = restart.isPending || stop.isPending;

  const label = !health ? 'Scheduler: unknown'
    : health.paused ? 'Scheduler stopped'
    : health.healthy ? 'Scheduler running'
    : `Scheduler ${health.status}`;

  return (
    <div className="rounded-xl border border-rule bg-white p-5 space-y-3">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="text-sm text-ink-light">
          Schedules run inside the API process, so they fire only while it is running.
          It checks every {health?.tick_seconds ?? 30}s.
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={!health ? 'gray' : health.healthy ? 'green' : 'red'}>{label}</Badge>
          {health && !health.paused && (
            <button
              type="button"
              onClick={() => stop.mutate()}
              disabled={busy}
              className="rounded-md border border-rule px-2.5 py-1 text-xs font-medium text-ink-light hover:border-red hover:text-red disabled:opacity-50"
            >
              {stop.isPending ? 'Stopping…' : 'Stop'}
            </button>
          )}
          <button
            type="button"
            onClick={() => restart.mutate()}
            disabled={busy || !health}
            className="rounded-md border border-rule px-2.5 py-1 text-xs font-medium text-ink-light hover:border-green hover:text-ink disabled:opacity-50"
          >
            {restart.isPending ? 'Restarting…' : health?.paused ? 'Start' : 'Restart'}
          </button>
        </div>
      </div>

      {health && (health.reason || health.note) && (
        <div className={`text-xs ${health.healthy ? 'text-ink-light' : 'text-red'}`}>
          {health.reason ?? health.note}
        </div>
      )}
      {(restart.isError || stop.isError) && (
        <div className="text-xs text-red">The request failed. Check the API log.</div>
      )}

      {health && health.workers.length > 0 && (
        <ul className="space-y-1.5 border-t border-rule pt-3">
          {health.workers.map((w) => <WorkerRow key={w.worker_id} w={w} />)}
        </ul>
      )}
      {health?.source === 'local' && (
        <div className="text-xs text-ink-faint">
          The database could not be read, so only the worker that answered is shown.
        </div>
      )}
    </div>
  );
}
