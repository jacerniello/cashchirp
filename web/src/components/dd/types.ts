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

// ---- Tolerant parsing --------------------------------------------------------------------
//
// dd.json is written by an AI (and sometimes fixed by hand), so it can be missing fields,
// carry extra ones, or have a number written as a string. `normalizeDD` coerces the shapes
// the renderer depends on — arrays are arrays, numbers are numbers, required strings exist —
// and drops entries it cannot make sense of instead of crashing the page. Unknown fields are
// ignored. The `deep` block is passed through as-is; the renderer isolates each section in
// an error boundary, so one malformed block cannot take down the rest of the report.

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const s = (v: unknown): string | undefined =>
  typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : undefined;
const n = (v: unknown): number | undefined => {
  if (v == null || v === '') return undefined;
  const x = typeof v === 'number' ? v : Number(String(v).replace(/[$,%\s]/g, ''));
  return Number.isFinite(x) ? x : undefined;
};
const text = (v: unknown): string | undefined => s(v) ?? (v == null ? undefined : JSON.stringify(v));
function list<T>(v: unknown, f: (x: unknown, i: number) => T | null | undefined): T[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.map(f).filter((x): x is T => x != null);
}
const source = (v: unknown): DDSource | undefined => {
  if (typeof v === 'string') return /^https?:/i.test(v) ? { url: v } : { label: v };
  if (!isObj(v)) return undefined;
  return { label: s(v.label) ?? s(v.title), url: s(v.url), accessed: s(v.accessed) };
};
const point = (p: unknown): ChartPoint | null => {
  if (Array.isArray(p)) return { date: s(p[0]) ?? '', value: n(p[1]) ?? null };
  if (!isObj(p)) return null;
  const date = s(p.date) ?? s(p.x);
  return date ? { date, value: n(p.value ?? p.y) ?? null } : null;
};

const STATUSES: ChecklistStatus[] = ['pass', 'warn', 'fail', 'na'];

export function normalizeDD(raw: unknown): DDReport {
  const r: Obj = isObj(raw) ? raw : {};
  const rating: Obj = isObj(r.rating) ? r.rating : {};
  const price: Obj | null = isObj(r.price) ? r.price : null;
  const exp: Obj | null = isObj(r.expectations) ? r.expectations : null;
  const ae: Obj | null = isObj(r.analyst_estimates) ? r.analyst_estimates : null;
  const tier = s(r.tier);

  return {
    id: s(r.id) ?? s(r.ticker) ?? '',
    ticker: s(r.ticker) ?? '',
    permaticker: n(r.permaticker) ?? null,
    company: s(r.company) ?? s(r.name) ?? '',
    sector: s(r.sector),
    industry: s(r.industry),
    group: n(r.group),
    tier: tier && tier in TIER_META ? (tier as DDTier) : undefined,
    asof: s(r.asof),
    generated_at: s(r.generated_at),
    rating: {
      score: n(rating.score) ?? 0,
      label: s(rating.label),
      confidence: s(rating.confidence),
      one_liner: s(rating.one_liner),
    },
    deep: isObj(r.deep) ? (r.deep as DDDeep) : undefined,
    price: price
      ? {
          current: n(price.current),
          currency: s(price.currency),
          market_cap: n(price.market_cap),
          entry_price: n(price.entry_price),
          entry_note: s(price.entry_note),
          fair_value_bear: n(price.fair_value_bear),
          fair_value_base: n(price.fair_value_base),
          fair_value_bull: n(price.fair_value_bull),
          upside_base_pct: n(price.upside_base_pct),
        }
      : undefined,
    tldr: text(r.tldr),
    bull_case: text(r.bull_case),
    bear_case: text(r.bear_case),
    verdict: text(r.verdict),
    tempered_conclusion: text(r.tempered_conclusion),
    thesis_points: list(r.thesis_points, (p) => {
      if (typeof p === 'string') return { claim: p };
      if (!isObj(p)) return null;
      const claim = s(p.claim) ?? s(p.title) ?? s(p.point);
      return claim
        ? { claim, evidence: text(p.evidence), confidence: s(p.confidence), source: source(p.source) }
        : null;
    }),
    checklist: list(r.checklist, (c) => {
      if (!isObj(c)) return null;
      const st = (s(c.status) ?? 'na').toLowerCase() as ChecklistStatus;
      return {
        section: s(c.section) ?? 'Other',
        item: s(c.item) ?? s(c.title) ?? '',
        status: STATUSES.includes(st) ? st : 'na',
        finding: text(c.finding),
        sources: list(c.sources, source),
      };
    }),
    expectations: exp
      ? {
          summary: text(exp.summary),
          implied_growth_pct: n(exp.implied_growth_pct),
          reference_growth_pct: n(exp.reference_growth_pct),
          method: text(exp.method),
        }
      : undefined,
    analyst_estimates: ae
      ? {
          consensus_pt: n(ae.consensus_pt),
          n_analysts: n(ae.n_analysts),
          rating_dist: text(ae.rating_dist),
          note: text(ae.note),
          source: source(ae.source),
        }
      : undefined,
    scenarios: list(r.scenarios, (x, i) =>
      isObj(x)
        ? {
            name: s(x.name) ?? `Scenario ${i + 1}`,
            prob: n(x.prob),
            price_target: n(x.price_target),
            return_pct: n(x.return_pct),
            assumptions: text(x.assumptions),
          }
        : null,
    ),
    catalysts: list(r.catalysts, (c) => {
      if (!isObj(c)) return null;
      return {
        date: s(c.date) ?? '',
        date_estimated: c.date_estimated === true,
        title: s(c.title) ?? s(c.event) ?? '',
        kind: s(c.kind),
        direction: s(c.direction),
        price_reaction_pct: n(c.price_reaction_pct),
        note: text(c.note),
        source: source(c.source),
      };
    }),
    charts: list(r.charts, (c, i) => {
      if (!isObj(c)) return null;
      const type = s(c.type);
      return {
        id: s(c.id) ?? `chart-${i}`,
        type: type === 'price_catalysts' || type === 'bars' ? type : 'multiline',
        title: s(c.title) ?? '',
        yFormat: s(c.yFormat) as ChartYFormat | undefined,
        yAxisLabel: s(c.yAxisLabel),
        series:
          list(c.series, (se, j) =>
            isObj(se)
              ? {
                  label: s(se.label) ?? `Series ${j + 1}`,
                  color: s(se.color),
                  points: list(se.points, point),
                  values: list(se.values, (v) => n(v) ?? null) as (number | null)[] | undefined,
                }
              : null,
          ) ?? [],
        markers: list(c.markers, (m) =>
          isObj(m) && s(m.date)
            ? { date: s(m.date) as string, label: s(m.label) ?? '', tone: s(m.tone), value: n(m.value) }
            : null,
        ),
        categories: list(c.categories, (x) => s(x) ?? ''),
        note: text(c.note),
      };
    }),
    risks: list(r.risks, text),
    red_team: isObj(r.red_team)
      ? ({ ...r.red_team, verdict: s(r.red_team.verdict) ?? '' } as RedTeam)
      : typeof r.red_team === 'string'
        ? ({ verdict: '', summary: r.red_team } as RedTeam)
        : undefined,
    sources: list(r.sources, source),
    data_gaps: list(r.data_gaps, text),
  };
}
