'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';

// Schedules and run history — the two halves of "what runs here, and what has run".
//
// Both are served by the setup router, which is mounted only when SETUP_ENABLED is on.
// Neither retries: a 404 here means this deployment has no control surface at all, and
// hammering it three times cannot change that.

export type Cadence = 'interval' | 'daily' | 'weekly';
export type JobMode = 'update' | 'missing' | 'full';
export type Trigger = 'manual' | 'scheduled' | 'cli';

export interface Schedule {
  id: number;
  key: string;
  mode: JobMode;
  cadence: Cadence;
  interval_minutes: number | null;
  at_time: string | null;
  /** 0 = Monday .. 6 = Sunday. Weekly only. */
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

export interface SchedulesResponse {
  scheduler_running: boolean;
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
      query.state.data?.runs?.some((r) => r.status === 'running') ? 3000 : 20000,
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
