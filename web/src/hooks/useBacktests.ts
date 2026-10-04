'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { kickSetupPolling, setupPollingKicked } from '@/hooks/useSetup';

// Backtest reports — folders under <research_dir>/backtests/, written by
// `python -m core.backend.backtest.run`. Nothing here retries: a failed read means the API
// is down or the report is gone, and asking three more times cannot change either. A page
// that spins forever is indistinguishable from a broken one.

export type BacktestKind = 'portfolio' | 'cohort';
/** Screen studies (backtest/study.py): does a screen remove losers and keep winners? */
export type StudyKind = 'gate-audit' | 'signal-study' | 'screen-comparison';
export type ReportKind = BacktestKind | StudyKind;

export const STUDY_KINDS: readonly StudyKind[] = ['gate-audit', 'signal-study', 'screen-comparison'];

export function isStudyKind(k: string | null | undefined): k is StudyKind {
  return !!k && (STUDY_KINDS as readonly string[]).includes(k);
}

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
  kind: ReportKind | null;
  created_at: string | null;
  screen: { id: string | null; title: string | null } | null;
  /** BacktestParams for portfolio/cohort; a study's own params (screen(s), periods). */
  params: (Partial<BacktestParams> & { periods?: string[]; screens?: string[] }) | null;
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

// ----------------------------------------------------------------- study reports

/** Selection metrics for a kept set (study.metrics). Prefixes: `p_` primary labels
 *  (top/bottom 20% of fwd 24m), `a_` secondary (≥ +50% / ≤ −30%), `q12_` 12-month quintiles. */
export type StudyMetrics = Record<string, unknown>;

/** A numeric field of a metrics record, or null — reports come from JSON, so check. */
export function metric(m: Record<string, unknown> | null | undefined, key: string): number | null {
  const v = m?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export interface SetStats {
  n: number;
  names_per_date?: number;
  p_win?: number;
  p_lose?: number;
  a_win?: number;
  a_lose?: number;
  double?: number;
  bust?: number;
  median_24m?: number;
  mean_24m?: number;
}

export interface GateRow {
  period: string;
  gate: string;
  rule: string;
  alone: StudyMetrics;
  loo: StudyMetrics;
  let_back_in: SetStats;
  full_kept: SetStats;
}

export interface SensitivityRow {
  period: string;
  gate: string;
  key: string;
  value: number | null;
  current: boolean;
  alone: StudyMetrics;
  in_screen: StudyMetrics;
}

export interface QuintileRow {
  quintile: number;
  n: number;
  lo?: number | null;
  hi?: number | null;
  upper_breakpoint?: number | null;
  mean_24m?: number;
  median_24m?: number;
  mean_12m?: number;
  p_win?: number;
  p_lose?: number;
  a_win?: number;
  a_lose?: number;
  q12_win?: number;
  q12_lose?: number;
  double?: number;
  bust?: number;
}

export interface SignalRow {
  signal: string;
  family: string;
  description: string;
  direction: number;
  coverage: number | null;
  dates: number;
  n: number;
  quintiles: QuintileRow[];
  null?: Omit<QuintileRow, 'quintile'>;
  spearman_net?: number | null;
  spearman_median?: number | null;
  spread_net?: number | null;
  spread_median?: number | null;
  spread_win?: number | null;
  spread_lose?: number | null;
  years_consistent?: number | null;
  monotonic?: boolean;
  agrees_with_prior?: boolean;
}

export interface LinkedBacktest {
  screen: string;
  range: string;
  kind: BacktestKind;
  start: string;
  end: string;
  report_id: string;
  summary: BacktestSummary;
  serious_warnings: number;
}

export interface StudyReport {
  id: string;
  name: string;
  kind: StudyKind;
  created_at: string;
  elapsed_seconds?: number;
  objective: string[];
  method: string[];
  warnings: BacktestWarning[];
  params: { screen?: string; screens?: string[]; periods: string[]; with_backtests?: boolean };
  screen: BacktestReport['screen'];
  screens?: BacktestReport['screen'][];
  summary: BacktestSummary;
  /** Per period: the full screen's metrics, with the universe's under `universe`. */
  full?: Record<string, StudyMetrics>;
  gates?: GateRow[];
  sensitivity?: SensitivityRow[];
  signals?: SignalRow[];
  /** One row per (screen, period): `screen`, `title`, `period` + the metrics. */
  comparison?: StudyMetrics[];
  backtests?: LinkedBacktest[];
}

export type AnyReport = BacktestReport | StudyReport;

export function isStudyReport(r: AnyReport): r is StudyReport {
  return isStudyKind(r.kind);
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
    queryFn: async (): Promise<AnyReport> =>
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
    refetchInterval: (q) => (q.state.data?.running || setupPollingKicked() ? 1500 : 15_000),
  });
}

export function useRunBacktest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: RunBacktestBody): Promise<{ pid: number; log_name: string }> =>
      (await api.post('/backtests/run', body)).data,
    onSuccess: () => {
      kickSetupPolling();
      qc.invalidateQueries({ queryKey: ['backtest-run'] });
    },
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
