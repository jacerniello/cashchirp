// Types mirroring the self-describing DD JSON written into research/dd/<TICKER>.json.
// See research/dd/README.md for the authoritative contract.

export interface DDSource {
  label?: string;
  url?: string;
  accessed?: string;
}

export interface DDRating {
  score: number; // 1..6
  label?: string;
  confidence?: 'high' | 'medium' | 'low' | string;
  one_liner?: string;
}

export interface DDPrice {
  current?: number;
  currency?: string;
  market_cap?: number;
  entry_price?: number;
  entry_note?: string;
  fair_value_bear?: number;
  fair_value_base?: number;
  fair_value_bull?: number;
  upside_base_pct?: number;
}

export interface DDThesisPoint {
  claim: string;
  evidence?: string;
  confidence?: 'verified' | 'reported' | 'uncertain' | string;
  source?: DDSource;
}

export type ChecklistStatus = 'pass' | 'warn' | 'fail' | 'na';

export interface DDChecklistItem {
  section: string;
  item: string;
  status: ChecklistStatus;
  finding?: string;
  sources?: DDSource[];
}

export interface DDExpectations {
  summary?: string;
  implied_growth_pct?: number;
  reference_growth_pct?: number;
  method?: string;
}

export interface DDAnalystEstimates {
  consensus_pt?: number;
  n_analysts?: number;
  rating_dist?: string;
  note?: string;
  source?: DDSource;
}

export interface DDScenario {
  name: string;
  prob?: number;
  price_target?: number;
  return_pct?: number;
  assumptions?: string;
}

export interface DDCatalyst {
  date: string;
  /** date is an estimate / soft milestone, not a confirmed/announced date */
  date_estimated?: boolean;
  title: string;
  kind?: string;
  direction?: 'past' | 'forward' | string;
  price_reaction_pct?: number;
  note?: string;
  source?: DDSource;
}

export type ChartYFormat = 'currency' | 'percent' | 'ratio' | 'number';

export interface ChartPoint {
  date: string;
  value: number | null;
}

export interface ChartSeries {
  label: string;
  points?: ChartPoint[]; // for line / price_catalysts
  values?: (number | null)[]; // for bars (aligned to categories)
  color?: string;
}

export interface ChartMarker {
  date: string;
  label: string;
  tone?: 'pos' | 'neg' | 'neutral' | string;
  value?: number;
}

export interface DDChart {
  id: string;
  type: 'price_catalysts' | 'multiline' | 'bars';
  title: string;
  yFormat?: ChartYFormat;
  yAxisLabel?: string;
  series: ChartSeries[];
  markers?: ChartMarker[]; // price_catalysts
  categories?: string[]; // bars
  note?: string;
}

export type DDTier = 'finalist' | 'bench' | 'cut';

// ---- Round-2 deep-DD enrichment (optional `deep` block) --------------------------------

export interface ReverseDcfSensitivity {
  rows: string[]; // e.g. ["WACC 8%", "WACC 9%", "WACC 10%"]
  cols: string[]; // e.g. ["g 6%", "g 8%", "g 10%"]
  values: (number | null)[][]; // fair value per cell, rows × cols
}

export interface ReverseDcf {
  summary?: string;
  assumptions?: Record<string, number | string>;
  implied_growth_pct?: number; // growth the current price requires
  fair_value?: number;
  sensitivity?: ReverseDcfSensitivity;
}

export interface ExpectedReturn {
  ev_price_target?: number;
  ev_return_pct?: number;
  irr_pct?: number;
  horizon_years?: number;
  breakeven?: string;
  note?: string;
}

export interface KpiTrace {
  name: string;
  thesis_signal?: string; // what the KPI must do to validate the thesis
  yFormat?: ChartYFormat;
  points?: ChartPoint[];
  verdict?: string;
  source?: DDSource;
}

export interface PeerCompColumn {
  id: string;
  label: string;
  kind?: 'ratio' | 'pct' | 'cap' | 'number' | 'text';
}

export interface PeerComps {
  note?: string;
  columns: PeerCompColumn[];
  rows: Record<string, unknown>[]; // each row may carry `self: true` to highlight the subject
}

export interface InsiderSignal {
  summary?: string;
  insider_net_value?: number; // net $ open-market, trailing window
  window?: string;
  institutional_trend?: string;
  source?: DDSource;
}

export interface Falsification {
  hypothesis?: string;
  kill_criteria?: string; // the metric/threshold that would prove the thesis wrong
  check_by?: string;
  experiment_file?: string;
}

export interface DDDeep {
  reverse_dcf?: ReverseDcf;
  expected_return?: ExpectedReturn;
  kpi_trace?: KpiTrace;
  peer_comps?: PeerComps;
  insider_signal?: InsiderSignal;
  falsification?: Falsification;
}

// ---- Red-team / disconfirmation pass ----------------------------------------------------

export type RedVerdict = 'SURVIVES' | 'CONDITIONAL' | 'FAILS' | string;
export type RedCheckTag = 'DAMAGING' | 'NEUTRAL' | 'REFUTES-BEAR' | string;

export interface RedCheck {
  fact: string;
  finding: string;
  verdict: RedCheckTag;
  source?: DDSource;
}

export interface RedTeam {
  verdict: RedVerdict;
  summary?: string;
  short_thesis?: string;
  most_damaging?: string;
  checks?: RedCheck[];
  inverted_dcf?: string;
  base_rate?: string;
  institutional?: string;
  recommendation?: string;
  memo_file?: string;
  reviewed_price?: number;
}

export interface DDReport {
  id: string;
  ticker: string;
  permaticker?: number | null;
  company: string;
  sector?: string;
  industry?: string;
  group?: number;
  tier?: DDTier;
  asof?: string;
  generated_at?: string;
  rating: DDRating;
  deep?: DDDeep;
  price?: DDPrice;
  tldr?: string;
  bull_case?: string;
  bear_case?: string;
  verdict?: string;
  thesis_points?: DDThesisPoint[];
  checklist?: DDChecklistItem[];
  expectations?: DDExpectations;
  analyst_estimates?: DDAnalystEstimates;
  scenarios?: DDScenario[];
  catalysts?: DDCatalyst[];
  charts?: DDChart[];
  risks?: string[];
  red_team?: RedTeam;
  tempered_conclusion?: string;
  sources?: DDSource[];
  data_gaps?: string[];
}

export interface DDSummary {
  id: string;
  ticker: string;
  company: string;
  sector?: string;
  industry?: string;
  group?: number;
  tier?: DDTier;
  score: number;
  label?: string;
  confidence?: string;
  one_liner?: string;
  upside_base_pct?: number | null;
  generated_at?: string | null;
}

export const TIER_META: Record<DDTier, { label: string; blurb: string; badge: string }> = {
  finalist: {
    label: 'Finalists',
    blurb: 'Cleanest theses — real mispricing, downside protection, a live driver. Round-2 deep DD.',
    badge: 'bg-green-600 text-white',
  },
  bench: {
    label: 'Bench',
    blurb: 'Real but second-order — partly-deserved discount or narrower runway. Revisit after the finalists.',
    badge: 'bg-blue-soft text-blue-text',
  },
  cut: {
    label: 'Cut',
    blurb: 'Removed: fairly valued, structural/peak-earnings overhang, or permanent governance/liquidity discount. Kept for the record.',
    badge: 'bg-surface text-ink-faint',
  },
};

export const TIER_ORDER: DDTier[] = ['finalist', 'bench', 'cut'];

// ---- Rating presentation (the 1..6 scale from research/dd/README.md) -------------------

export interface RatingMeta {
  label: string;
  /** Tailwind text/bg classes for the badge. */
  badge: string;
  /** Short bucket used to group the index. */
  bucket: 'Top buys' | 'Buy' | 'Watch' | 'Pass';
}

export const RATING_META: Record<number, RatingMeta> = {
  6: { label: 'Conviction double', badge: 'bg-green-600 text-white', bucket: 'Top buys' },
  5: { label: 'Strong double candidate', badge: 'bg-green-soft text-green-text', bucket: 'Top buys' },
  4: { label: 'Solid long / money-maker', badge: 'bg-blue-soft text-blue-text', bucket: 'Buy' },
  3: { label: 'Fairly valued / hold', badge: 'bg-surface text-ink-faint', bucket: 'Watch' },
  2: { label: 'Value trap / overhang', badge: 'bg-orange-100 text-orange-700', bucket: 'Pass' },
  1: { label: 'Avoid / impaired', badge: 'bg-red-soft text-red', bucket: 'Pass' },
};

export function ratingMeta(score: number): RatingMeta {
  return (
    RATING_META[Math.round(score)] ?? {
      label: 'Unrated',
      badge: 'bg-surface text-ink-faint',
      bucket: 'Watch',
    }
  );
}
