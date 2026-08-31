'use client';

import { useQuery } from '@tanstack/react-query';
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
  expected_mb: number;
  expected_size: string;
  tables: DatasetTable[];
  rows: number;
  size: string;
  state: 'loaded' | 'missing' | 'unknown';
}

export interface PhaseStatus {
  id: string;
  description: string;
  count: number;
  loaded: number;
  missing: number;
  expected_size: string;
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

export interface SetupStatus {
  database: { name: string; host: string; connected: boolean; tables: number };
  summary: {
    datasets: number;
    loaded: number;
    missing: number;
    expected_size: string;
    loaded_size: string;
    complete: boolean;
    empty: boolean;
  };
  credentials: { env: string; unlocks: string[]; set: boolean }[];
  phases: PhaseStatus[];
  datasets: DatasetStatus[];
  build: BuildState | null;
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
    refetchInterval: (query) =>
      query.state.data?.build?.steps?.some((s) => s.status === 'running') ? 2000 : 30000,
    retry: false,
    staleTime: 0,
  });
}
