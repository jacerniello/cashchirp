// Types for screen-study reports (core/backend/backtest/study/): does a screen remove
// losers and keep winners? Rendered by StudyReport.tsx in this folder.

import type {
  BacktestKind, BacktestReport, BacktestSummary, BacktestWarning,
} from '@/hooks/useBacktests';

/** Report kinds written by the study runner. */
export type StudyKind = 'gate-audit' | 'signal-study' | 'screen-comparison';

export const STUDY_KINDS: readonly StudyKind[] = ['gate-audit', 'signal-study', 'screen-comparison'];

export function isStudyKind(k: string | null | undefined): k is StudyKind {
  return !!k && (STUDY_KINDS as readonly string[]).includes(k);
}


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

