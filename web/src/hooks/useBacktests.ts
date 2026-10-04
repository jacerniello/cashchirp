'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';

// Backtest reports — folders under <research_dir>/backtests/, written by
// `python -m core.backend.backtest.run`. Nothing here retries: a failed read means the API
// is down or the report is gone, and asking three more times cannot change either. A page
// that spins forever is indistinguishable from a broken one.

export type BacktestKind = 'portfolio' | 'cohort';

export interface BacktestWarning {
  level: 'warn' | 'info';
  code: string;
  message: string;
}

export interface BacktestParams {
  screen: string;
  kind: BacktestKind;
  start: string;
  end: string | null;
  rebalance_months: number;
  hold_months: number;
  benchmark: string;
  cost_bps: number;
  min_price: number;
  min_adv: number;
  min_names: number;
}

/** Portfolio and cohort summaries share a few keys; the rest depend on the kind. */
export type BacktestSummary = Record<string, number | string | null | undefined>;

export interface BacktestListItem {
  id: string;
  name: string | null;
  kind: BacktestKind | null;
  created_at: string | null;
  screen: { id: string | null; title: string | null } | null;
  params: BacktestParams | null;
  summary: BacktestSummary;
  warnings: number;
  serious_warnings: number;
  error?: string;
}

export interface Holding {
  permaticker: number;
  ticker: string | null;
  name: string | null;
  sector: string | null;
  marketcap: number | null;
  entry_px: number | null;
  exit_px: number | null;
  exit_date: string | null;
  ret: number | null;
  stopped_trading: boolean;
}

export interface BacktestPeriod {
  start: string;
  end: string;
  partial: boolean;
  cash: boolean;
  n_universe: number;
  n_eligible: number;
  n_passed: number;
  n_held: number;
  n_stopped?: number;
  turnover: number | null;
  ret_gross: number | null;
  ret_net: number | null;
  median_ret?: number | null;
  double_rate?: number | null;
  halve_rate?: number | null;
  bench_ret: number | null;
  universe_ret: number | null;
  holdings: Holding[];
}

export interface SeriesPoint {
  date: string;
  value: number;
}

export interface BacktestReport {
  id: string;
  name: string;
  kind: BacktestKind;
  created_at: string;
  elapsed_seconds?: number;
  params: BacktestParams;
  screen: {
    id: string;
    title: string | null;
    description: string;
    criteria: string[];
    spec: Record<string, unknown>;
  };
  /** `nav` = growth of $1 (portfolio); `forward_return` = each cohort's mean forward return. */
  series_kind: 'nav' | 'forward_return';
  summary: BacktestSummary;
  series: { strategy: SeriesPoint[]; benchmark: SeriesPoint[]; universe: SeriesPoint[] };
  periods: BacktestPeriod[];
  warnings: BacktestWarning[];
  method?: string[];
}

export interface CurrentRun {
  running: boolean;
  phase: string | null;
  pid: number | null;
  started_at: string | null;
  updated_at: string | null;
  log_name: string | null;
  report_id: string | null;
  detail: string | null;
  lines: string[];
}

export interface RunBacktestBody {
  screen: string;
  kind: BacktestKind;
  start: string;
  end?: string | null;
  rebalance_months: number;
  hold_months?: number;
  benchmark?: string;
  cost_bps?: number;
  min_names?: number;
  name?: string | null;
}

export function useBacktests() {
  return useQuery({
    queryKey: ['backtests'],
    queryFn: async (): Promise<{ root: string; reports: BacktestListItem[] }> =>
      (await api.get('/backtests')).data,
    retry: false,
    staleTime: 10_000,
  });
}

export function useBacktest(id: string | null) {
  return useQuery({
    queryKey: ['backtest', id],
    queryFn: async (): Promise<BacktestReport> =>
      (await api.get(`/backtests/${encodeURIComponent(id!)}`)).data,
    enabled: !!id,
    retry: false,
    staleTime: Infinity, // a saved report never changes
  });
}

/** Polls while a run is going (every 1.5s), slowly otherwise. */
export function useCurrentBacktestRun() {
  return useQuery({
    queryKey: ['backtest-run'],
    queryFn: async (): Promise<CurrentRun> => (await api.get('/backtests/runs/current')).data,
    retry: false,
    refetchInterval: (q) => (q.state.data?.running ? 1500 : 15_000),
  });
}

export function useRunBacktest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: RunBacktestBody): Promise<{ pid: number; log_name: string }> =>
      (await api.post('/backtests/run', body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['backtest-run'] }),
  });
}

export function useDeleteBacktest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      (await api.delete(`/backtests/${encodeURIComponent(id)}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['backtests'] }),
  });
}

/** Where a report's CSV / JSON can be downloaded (proxied by Next to the API). */
export function backtestFileUrl(id: string, name: string): string {
  return `/api/v1/backtests/${encodeURIComponent(id)}/files/${name}`;
}

/** Pull an API error's `detail` out of an axios error, falling back to its message. */
export function errorText(e: unknown): string {
  const ax = e as { response?: { data?: { detail?: unknown } }; message?: string };
  const d = ax?.response?.data?.detail;
  if (typeof d === 'string') return d;
  if (d) return JSON.stringify(d);
  return ax?.message ?? 'Request failed';
}
