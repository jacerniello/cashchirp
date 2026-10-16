'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { kickSetupPolling, setupPollingKicked } from '@/hooks/useSetup';

// Schedules and run history — the two halves of "what runs here, and what has run".
//
// Both are served by the setup router, which is mounted only when SETUP_ENABLED is on.
// Neither retries: a 404 here means this deployment has no control surface at all, and
// hammering it three times cannot change that.

export type Cadence = 'interval' | 'daily' | 'weekly' | 'monthly';
export type JobMode = 'update' | 'missing' | 'full';
export type Trigger = 'manual' | 'scheduled' | 'cli';

export interface Schedule {
  id: number;
  key: string;
  mode: JobMode;
  cadence: Cadence;
  interval_minutes: number | null;
  at_time: string | null;
  /** 0 = Monday .. 6 = Sunday. Weekly, and monthly (the first such day of the month). */
  weekday: number | null;
  enabled: boolean;
  note: string | null;
  /** The cadence in words, rendered server-side so the UI and the logs agree. */
  summary: string;
  last_run_at: string | null;
  next_run_at: string | null;
}

/** Something the scheduler can be pointed at: a registry dataset, or a whole build. */
export interface SchedulableJob {
  key: string;
  label: string;
  phase: string;
}

export type SchedulerStatus = 'ok' | 'failing' | 'stalled' | 'stopped';

/** One API worker's scheduler thread, as it last reported to Postgres. */
export interface SchedulerWorker {
  worker_id: string;
  host: string;
  pid: number;
  status: SchedulerStatus;
  reason: string | null;
  thread_alive: boolean;
  seconds_since_heartbeat: number;
  /** True for the worker that served this request. */
  this_worker: boolean;
  reported_at: string;
  started_at: string | null;
  heartbeat_at: string | null;
  last_tick_at: string | null;
  /** True for the worker currently doing the firing; the others stand by. */
  holds_lock: boolean | null;
  consecutive_failures: number;
  last_error: string | null;
  restarts: number;
}

/** GET /setup/scheduler — is scheduling working, across every API worker? */
export interface SchedulerHealth {
  status: SchedulerStatus;
  healthy: boolean;
  /** Why it is unhealthy, in words; null when ok. */
  reason: string | null;
  /** Set when one worker is unhealthy but another is covering; status stays ok. */
  note: string | null;
  /** Stopped on purpose from the Setup page. Stays stopped across API restarts. */
  paused: boolean;
  workers: SchedulerWorker[];
  tick_seconds: number;
  stall_seconds: number;
  /** Other workers apply Stop/Restart within this many seconds. */
  supervise_seconds: number;
  /** 'local' when the database could not be read and only this worker is shown. */
  source: 'database' | 'local';
}

export interface SchedulesResponse {
  scheduler_running: boolean;
  scheduler: SchedulerHealth;
  tick_seconds: number;
  /** Server time, so "next run" can be shown relative to the machine that will fire it. */
  now: string;
  schedules: Schedule[];
  jobs: SchedulableJob[];
  cadences: Cadence[];
  modes: JobMode[];
  min_interval_minutes: number;
}

export interface JobRun {
  id: number;
  key: string;
  label: string | null;
  kind: 'dataset' | 'build' | 'reset';
  trigger: Trigger;
  schedule_id: number | null;
  mode: JobMode | null;
  status: 'running' | 'ok' | 'failed' | 'stopped' | 'unknown';
  pid: number | null;
  /** Log FILE NAME, resolved by the server against its own listing. */
  log: string | null;
  rows: number | null;
  detail: string | null;
  started_at: string | null;
  finished_at: string | null;
  seconds: number | null;
}

export interface RunsResponse {
  runs: JobRun[];
  /** How many stuck `running` rows this read closed out — jobs are detached, so the
   *  ledger is reconciled on read rather than by anything watching the child. */
  reconciled: number;
  triggers: Trigger[];
}

export function useSchedules() {
  return useQuery({
    queryKey: ['setup-schedules'],
    queryFn: async (): Promise<SchedulesResponse> =>
      (await api.get('/setup/schedules')).data,
    // Slow poll: next_run_at ticks down and a schedule may fire while the page is open.
    refetchInterval: 30000,
    retry: false,
  });
}

/**
 * Scheduler health. `enabled` gates the poll: a deployment without the setup surface
 * has no scheduler, and polling its 404 every 30s would be noise.
 */
export function useSchedulerHealth(enabled = true, pollMs = 30000) {
  return useQuery({
    queryKey: ['setup-scheduler'],
    queryFn: async (): Promise<SchedulerHealth> => (await api.get('/setup/scheduler')).data,
    enabled,
    refetchInterval: pollMs,
    retry: false,
  });
}

/**
 * Stop or restart the scheduler in every API worker. The worker that serves the request
 * applies it at once; the others pick it up within `supervise_seconds`, so the health
 * is fetched again after that.
 */
function useSchedulerControl(action: 'restart' | 'stop') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<SchedulerHealth> =>
      (await api.post(`/setup/scheduler/${action}`, {})).data,
    onSuccess: (data) => {
      qc.setQueryData(['setup-scheduler'], data);
      const refresh = () => {
        qc.invalidateQueries({ queryKey: ['setup-scheduler'] });
        qc.invalidateQueries({ queryKey: ['setup-schedules'] });
      };
      refresh();
      setTimeout(refresh, (data.supervise_seconds + 1) * 1000);
    },
  });
}

export const useRestartScheduler = () => useSchedulerControl('restart');
export const useStopScheduler = () => useSchedulerControl('stop');

export interface NewSchedule {
  key: string;
  cadence: Cadence;
  mode?: JobMode;
  interval_minutes?: number | null;
  at_time?: string | null;
  weekday?: number | null;
  note?: string | null;
}

export function useScheduleMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['setup-schedules'] });
    qc.invalidateQueries({ queryKey: ['setup-runs'] });
  };
  return {
    create: useMutation({
      mutationFn: async (v: NewSchedule) => (await api.post('/setup/schedules', v)).data,
      onSuccess: invalidate,
    }),
    patch: useMutation({
      mutationFn: async ({ id, ...v }: Partial<Schedule> & { id: number }) =>
        (await api.patch(`/setup/schedules/${id}`, v)).data,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: async (id: number) => (await api.delete(`/setup/schedules/${id}`)).data,
      onSuccess: invalidate,
    }),
    runNow: useMutation({
      mutationFn: async (id: number) =>
        (await api.post(`/setup/schedules/${id}/run`, {})).data,
      onSuccess: () => {
        kickSetupPolling();
        invalidate();
        qc.invalidateQueries({ queryKey: ['setup-status'] });
      },
    }),
  };
}

export function useRuns(opts: { limit?: number; key?: string; trigger?: Trigger | '' } = {}) {
  const { limit = 100, key = '', trigger = '' } = opts;
  return useQuery({
    queryKey: ['setup-runs', limit, key, trigger],
    queryFn: async (): Promise<RunsResponse> => {
      const p = new URLSearchParams({ limit: String(limit) });
      if (key) p.set('key', key);
      if (trigger) p.set('trigger', trigger);
      return (await api.get(`/setup/runs?${p}`)).data;
    },
    // Anything in flight will change; poll while it is.
    refetchInterval: (query) =>
      query.state.data?.runs?.some((r) => r.status === 'running') || setupPollingKicked()
        ? 3000 : 20000,
    retry: false,
  });
}

export function useRunLog(name: string | null, tail = 300) {
  return useQuery({
    queryKey: ['setup-run-log', name, tail],
    queryFn: async (): Promise<{ name: string; lines: string[]; archived: boolean }> =>
      (await api.get(`/setup/runs/log?name=${encodeURIComponent(name!)}&tail=${tail}`)).data,
    enabled: !!name,
    retry: false,
  });
}
