'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';

// Setup status — what the database actually contains versus what the data-source registry
// (core/backend/sources.py) says it should. Served by GET /setup/status.
//
// This is the one hook that has to work when every other one is failing: an empty database
// makes every data page return 500, and without this the app looks broken rather than
// unbuilt. So it never `retry`s (a missing database will not fix itself on attempt three)
// and the page renders an explicit state instead of a spinner.

export interface DatasetTable {
  name: string;
  rows: number;
  bytes: number;
  size: string;
}

/** One dataset's OWN job — its own process, state file and log, so a single table can be
 *  pulled, watched and stopped without touching anything else. */
export interface DatasetJob {
  running: boolean;
  pid: number | null;
  phase: string | null;
  status: string | null;
  detail: string;
  frac: number | null;
  rows: number | null;
  seconds: number | null;
  updated_at: string | null;
  has_log: boolean;
}

export interface LastRun {
  status: string;
  rows: number | null;
  at: string | null;
  /** `load_log` (authoritative, covers CLI + nightly runs) or `job` (this UI only). */
  source: 'load_log' | 'job';
}

export interface DatasetStatus {
  key: string;
  label: string;
  phase: string;
  source: {
    id: string;
    provider: string;
    short: string;
    licence: string;
    url: string;
  };
  endpoint: string;
  mode: string | null;
  note: string;
  tables: DatasetTable[];
  rows: number;
  size: string;
  state: 'loaded' | 'missing' | 'unknown';
  job: DatasetJob;
  last_run: LastRun | null;
}

export interface PhaseStatus {
  id: string;
  description: string;
  count: number;
  loaded: number;
  missing: number;
}

/** One step of an in-flight `bootstrap` run, read off the state file it writes. */
export interface BuildStep {
  key: string;
  label: string;
  phase: string;
  status: 'pending' | 'running' | 'ok' | 'FAIL' | 'skipped';
  seconds: number;
  rows: number | null;
  note: string;
  detail: string;
  /** 0..1 completion the loader actually REPORTED. Meaningless unless frac_known. */
  frac: number;
  /** False => this step gave no denominator, so it has no honest percentage. */
  frac_known: boolean;
}

export interface BuildState {
  database: string;
  host: string;
  phase: string;
  pid: number;
  started_at: string;
  updated_at: string;
  elapsed_seconds: number;
  steps: BuildStep[];
}

/** Live control state of a build, distinct from the step list: `phase` alone can't tell
 *  you whether a build is running, because a killed process leaves its last phase behind
 *  forever. `running` is phase + a liveness check on the PID. */
export interface BuildControl {
  running: boolean;
  pid: number | null;
  phase: string | null;
  started_at: string | null;
  updated_at: string | null;
  elapsed_seconds: number | null;
  can_resume: boolean;
  progress_pct: number;
  steps_done: number;
  steps_total: number;
  stopping: boolean;
  log: string;
}

/** The two kinds of work, which differ in cost and risk: ingest downloads from providers
 *  (hours, network-bound), derive recomputes locally (minutes). */
export interface WorkSplit {
  datasets: number;
  loaded: number;
}

export interface SetupStatus {
  database: { name: string; host: string; connected: boolean; tables: number };
  summary: {
    datasets: number;
    loaded: number;
    missing: number;
      loaded_size: string;
    complete: boolean;
    empty: boolean;
  };
  credentials: { env: string; unlocks: string[]; set: boolean }[];
  phases: PhaseStatus[];
  datasets: DatasetStatus[];
  build: BuildState | null;
  build_status: BuildControl;
  work: { ingest: WorkSplit; derive: WorkSplit };
}

/** One past run of a job. Logs are one file per run, dated, with older ones gzipped. */
export interface LogRun {
  name: string;
  archived: boolean;
  bytes: number;
  at: string;
}

export interface LogResponse {
  lines: string[];
  path: string;
  exists: boolean;
  /** Which run these lines came from; null when nothing has run yet. */
  run: string | null;
  runs: LogRun[];
}

/** Tail of a build log. Polls quickly while a build runs, stops when it doesn't — the
 *  point is to follow a long ingest without a terminal. Pass `run` to read an older one;
 *  polling is disabled then, since a finished run cannot change. */
export function useBuildLog(
  enabled: boolean, running: boolean, run?: string | null, tail = 300,
  justStarted = false,
) {
  return useQuery({
    queryKey: ['build-log', tail, run ?? 'latest'],
    queryFn: async (): Promise<LogResponse> =>
      (await api.get(`/setup/build/log?tail=${tail}`
        + (run ? `&run=${encodeURIComponent(run)}` : ''))).data,
    enabled,
    // `justStarted` covers the gap between spawning a job and the status endpoint
    // admitting it is running: without it the first poll never happens.
    refetchInterval: (running || justStarted) && !run ? 1500 : false,
    retry: false,
  });
}

/** Run / stop ONE dataset as its own process. */
export function useDatasetJob() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['setup-status'] });
  return {
    run: useMutation({
      mutationFn: async (v: { key: string; mode?: 'update' | 'missing' | 'full' }) =>
        (await api.post('/setup/dataset/run', v)).data,
      onSuccess: invalidate,
    }),
    stop: useMutation({
      mutationFn: async (key: string) => (await api.post('/setup/dataset/stop', { key })).data,
      onSuccess: invalidate,
    }),
  };
}

export function useDatasetLog(
  key: string | null, running: boolean, run?: string | null, tail = 200,
  justStarted = false,
) {
  return useQuery({
    queryKey: ['dataset-log', key, tail, run ?? 'latest'],
    queryFn: async (): Promise<LogResponse & { key: string }> =>
      (await api.get(`/setup/dataset/log?key=${encodeURIComponent(key!)}&tail=${tail}`
        + (run ? `&run=${encodeURIComponent(run)}` : ''))).data,
    enabled: !!key,
    // `justStarted` covers the gap between spawning a job and the status endpoint
    // admitting it is running: without it the first poll never happens.
    refetchInterval: (running || justStarted) && !run ? 1500 : false,
    retry: false,
  });
}

export function useStartBuild() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      kind?: 'all' | 'ingest' | 'derive';
      /** update = pull what changed · missing = only never-loaded · full = re-download */
      mode?: 'update' | 'missing' | 'full';
    }) =>
      (await api.post('/setup/build', body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['setup-status'] }),
  });
}

export function useStopBuild() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => (await api.post('/setup/build/stop', {})).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['setup-status'] }),
  });
}

export interface ResetStarted {
  started: boolean;
  key: string;
  pid: number;
  log: string;
  note: string;
}

/** Start a reset. It runs as a DETACHED job, like an ingest — it stops any running builds
 *  first, which can take until the current step reaches a boundary, so this returns as
 *  soon as the job is spawned and the caller follows its log.
 *
 *  `confirm` must equal the database name; the API rejects anything else, so a mistyped
 *  or mis-aimed request fails instead of wiping the wrong deployment. */
export function useResetDatabase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (confirm: string) =>
      (await api.post<ResetStarted>('/setup/reset', { confirm })).data,
    // Everything on the page describes a database that no longer exists.
    onSuccess: () => qc.invalidateQueries(),
  });
}

export interface ResetLog {
  running: boolean;
  pid: number | null;
  lines: string[];
  exists: boolean;
  run: string | null;
  runs: LogRun[];
}

/** The reset job's state and log, read from the SERVER — so a reset that is still running
 *  (or already finished) is visible after a page refresh, which a local "I started one"
 *  flag cannot survive. Polls only while the job is running. */
export function useResetLog(tail = 200, justStarted = false) {
  return useQuery({
    queryKey: ['reset-log', tail],
    queryFn: async (): Promise<ResetLog> =>
      (await api.get(`/setup/reset/log?tail=${tail}`)).data,
    // Poll while the job runs, and also for the moment right after starting one — the
    // last fetch still says running:false, so without this it would never poll again.
    refetchInterval: (query) =>
      (query.state.data?.running || justStarted ? 1500 : false),
  });
}

async function fetchSetup(): Promise<SetupStatus> {
  const response = await api.get('/setup/status/');
  return response.data;
}

export function useSetup() {
  return useQuery({
    queryKey: ['setup-status'],
    queryFn: fetchSetup,
    // A build writes its state file after every step, so poll while one is running —
    // that is the whole point of the page during a six-hour backfill. Idle, back off.
    refetchInterval: (query) => {
      const d = query.state.data;
      const busy = d?.build_status?.running || d?.datasets?.some((x) => x.job?.running);
      return busy ? 2000 : 30000;
    },
    retry: false,
    staleTime: 0,
  });
}
