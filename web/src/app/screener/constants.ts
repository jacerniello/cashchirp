import type { MarketCapRange } from '@/hooks/useScreener';

export const MARKET_CAP_RANGES: { key: MarketCapRange; label: string; description: string }[] = [
  { key: 'mega', label: 'Mega Cap', description: '$200B+' },
  { key: 'large', label: 'Large Cap', description: '$10B - $200B' },
  { key: 'mid', label: 'Mid Cap', description: '$2B - $10B' },
  { key: 'small', label: 'Small Cap', description: '$300M - $2B' },
  { key: 'micro', label: 'Micro Cap', description: '$50M - $300M' },
  { key: 'nano', label: 'Nano Cap', description: '< $50M' },
];

// ---------------------------------------------------------------------------
// Finviz-style preset ranges for the expandable fundamental-filter grid.
// Each option encodes a min/max as "lo:hi" (blank bound = unbounded); the empty
// value "" means "Any" (ignored). Mirrors the Dash screener's preset dropdowns
// (core/frontend/pages/screener.py). Percent filters store decimals (0.10 = 10%);
// the page maps them through the API's percent contract.
// ---------------------------------------------------------------------------

export interface PresetOption {
  label: string;
  value: string; // "lo:hi"
}

// Generic ratio (P/E, P/B, D/E, current ratio, …)
export const RATIO_PRESETS: PresetOption[] = [
  { label: 'Any', value: '' },
  { label: 'Profitable (>0)', value: '0:' },
  { label: 'Under 5', value: ':5' },
  { label: 'Under 10', value: ':10' },
  { label: 'Under 15', value: ':15' },
  { label: 'Under 20', value: ':20' },
  { label: 'Under 30', value: ':30' },
  { label: 'Under 50', value: ':50' },
  { label: 'Over 5', value: '5:' },
  { label: 'Over 10', value: '10:' },
  { label: 'Over 20', value: '20:' },
  { label: 'Over 50', value: '50:' },
];

// Percentages stored as decimals (margins, ROE, …)
export const PCT_PRESETS: PresetOption[] = [
  { label: 'Any', value: '' },
  { label: 'Positive (>0)', value: '0:' },
  { label: 'Negative (<0)', value: ':0' },
  { label: 'Over 5%', value: '0.05:' },
  { label: 'Over 10%', value: '0.10:' },
  { label: 'Over 15%', value: '0.15:' },
  { label: 'Over 20%', value: '0.20:' },
  { label: 'Over 25%', value: '0.25:' },
  { label: 'Over 30%', value: '0.30:' },
  { label: 'Over 50%', value: '0.50:' },
  { label: 'Under 10%', value: ':0.10' },
  { label: 'Under 20%', value: ':0.20' },
];

// Growth percentages (decimals)
export const GROWTH_PRESETS: PresetOption[] = [
  { label: 'Any', value: '' },
  { label: 'Positive (>0)', value: '0:' },
  { label: 'Negative (<0)', value: ':0' },
  { label: 'Over 5%', value: '0.05:' },
  { label: 'Over 10%', value: '0.10:' },
  { label: 'Over 15%', value: '0.15:' },
  { label: 'Over 20%', value: '0.20:' },
  { label: 'Over 25%', value: '0.25:' },
  { label: 'Over 30%', value: '0.30:' },
  { label: 'High (>50%)', value: '0.50:' },
  { label: 'Under 0%', value: ':0' },
  { label: 'Under 10%', value: ':0.10' },
];

// Altman Z-score (bankruptcy distance)
export const ZSCORE_PRESETS: PresetOption[] = [
  { label: 'Any', value: '' },
  { label: 'Safe (>2.99)', value: '2.99:' },
  { label: 'Grey 1.81–2.99', value: '1.81:2.99' },
  { label: 'Distress (<1.81)', value: ':1.81' },
  { label: 'Survivable (>1)', value: '1:' },
  { label: 'Deep distress (<1)', value: ':1' },
];

// Dividend yield (decimals: 0.03 = 3%)
export const DIV_PRESETS: PresetOption[] = [
  { label: 'Any', value: '' },
  { label: 'Pays a dividend (>0)', value: '0:' },
  { label: 'Over 1%', value: '0.01:' },
  { label: 'Over 2%', value: '0.02:' },
  { label: 'Over 3%', value: '0.03:' },
  { label: 'Over 4%', value: '0.04:' },
  { label: 'Over 5%', value: '0.05:' },
];

// Net cash (cash − debt) as a fraction of market cap (decimals)
export const NETCASH_PRESETS: PresetOption[] = [
  { label: 'Any', value: '' },
  { label: 'Net cash (>0)', value: '0:' },
  { label: 'Over 25%', value: '0.25:' },
  { label: 'Over 50%', value: '0.50:' },
  { label: 'Over 75%', value: '0.75:' },
  { label: 'Net cash > mkt cap', value: '1.0:' },
];

// Institutional holder count (raw integers)
export const COUNT_PRESETS: PresetOption[] = [
  { label: 'Any', value: '' },
  { label: 'Over 50', value: '50:' },
  { label: 'Over 100', value: '100:' },
  { label: 'Over 250', value: '250:' },
  { label: 'Over 500', value: '500:' },
  { label: 'Over 1000', value: '1000:' },
  { label: 'Under 100', value: ':100' },
];

// Years public / company age (raw years)
export const YEARS_PRESETS: PresetOption[] = [
  { label: 'Any', value: '' },
  { label: 'Over 3y', value: '3:' },
  { label: 'Over 5y', value: '5:' },
  { label: 'Over 10y', value: '10:' },
  { label: 'Over 15y', value: '15:' },
  { label: 'Over 20y', value: '20:' },
  { label: 'Over 25y', value: '25:' },
];

// Distance below the 52-week high (decimals: 0.50 = 50% off the high)
export const HIGHOFF_PRESETS: PresetOption[] = [
  { label: 'Any', value: '' },
  { label: '25%+ off high', value: '0.25:' },
  { label: '50%+ off high', value: '0.50:' },
  { label: '75%+ off high', value: '0.75:' },
];

// Distance above the 52-week low (decimals: small = near the low / out of favor)
export const LOWPROX_PRESETS: PresetOption[] = [
  { label: 'Any', value: '' },
  { label: 'Within 10% of low', value: ':0.10' },
  { label: 'Within 25% of low', value: ':0.25' },
  { label: 'Within 50% of low', value: ':0.50' },
];

/** A fundamental-filter metric rendered as a preset dropdown in the grid. */
export interface ScreenMetric {
  key: string; // the API filter key (…_min / …_max)
  label: string;
  presets: PresetOption[];
  isPercent?: boolean;
}

/** Grouped metrics for the expandable filter grid. Only keys the FastAPI screener
 *  contract supports are included, so every filter actually narrows results. */
// Mirrors the Dash screener's metric set (core/frontend/pages/screener.py → METRICS),
// keyed to the same screener_snapshot columns the FastAPI screener filters on. Percent
// metrics store decimals in the snapshot, so they use the decimal preset sets + isPercent.
export const SCREEN_METRIC_GROUPS: { title: string; metrics: ScreenMetric[] }[] = [
  {
    title: 'Valuation',
    metrics: [
      { key: 'pe', label: 'P/E', presets: RATIO_PRESETS },
      { key: 'ps', label: 'P/S', presets: RATIO_PRESETS },
      { key: 'pb', label: 'P/B', presets: RATIO_PRESETS },
      { key: 'p_cash', label: 'Price/Cash', presets: RATIO_PRESETS },
      { key: 'p_fcf', label: 'Price/FCF', presets: RATIO_PRESETS },
      { key: 'ev_ebitda', label: 'EV/EBITDA', presets: RATIO_PRESETS },
      { key: 'ev_sales', label: 'EV/Sales', presets: RATIO_PRESETS },
      { key: 'div_yield', label: 'Dividend Yield', presets: DIV_PRESETS, isPercent: true },
      { key: 'div_growth', label: 'Dividend Growth 3Y', presets: GROWTH_PRESETS, isPercent: true },
    ],
  },
  {
    title: 'Profitability & Returns',
    metrics: [
      { key: 'roe', label: 'ROE', presets: PCT_PRESETS, isPercent: true },
      { key: 'roa', label: 'ROA', presets: PCT_PRESETS, isPercent: true },
      { key: 'roic', label: 'ROIC', presets: PCT_PRESETS, isPercent: true },
      { key: 'gross_margin', label: 'Gross Margin', presets: PCT_PRESETS, isPercent: true },
      { key: 'op_margin', label: 'Operating Margin', presets: PCT_PRESETS, isPercent: true },
      { key: 'profit_margin', label: 'Net Margin', presets: PCT_PRESETS, isPercent: true },
      { key: 'payout', label: 'Payout Ratio', presets: PCT_PRESETS, isPercent: true },
    ],
  },
  {
    title: 'Financial Health',
    metrics: [
      { key: 'debt_equity', label: 'Debt/Equity', presets: RATIO_PRESETS },
      { key: 'ltde', label: 'LT Debt/Equity', presets: RATIO_PRESETS },
      { key: 'current_ratio', label: 'Current Ratio', presets: RATIO_PRESETS },
      { key: 'quick_ratio', label: 'Quick Ratio', presets: RATIO_PRESETS },
      { key: 'net_cash_pct', label: 'Net Cash % of Cap', presets: NETCASH_PRESETS, isPercent: true },
      { key: 'altman_z', label: 'Altman Z-Score', presets: ZSCORE_PRESETS },
    ],
  },
  {
    title: 'Growth',
    metrics: [
      { key: 'eps_g_yr', label: 'EPS Growth This Yr', presets: GROWTH_PRESETS, isPercent: true },
      { key: 'eps_g_qoq', label: 'EPS Growth Q/Q', presets: GROWTH_PRESETS, isPercent: true },
      { key: 'eps_growth', label: 'EPS Growth TTM', presets: GROWTH_PRESETS, isPercent: true },
      { key: 'eps_g_3y', label: 'EPS Growth 3Y', presets: GROWTH_PRESETS, isPercent: true },
      { key: 'eps_g_5y', label: 'EPS Growth 5Y', presets: GROWTH_PRESETS, isPercent: true },
      { key: 'sales_g_qoq', label: 'Sales Growth Q/Q', presets: GROWTH_PRESETS, isPercent: true },
      { key: 'revenue_growth', label: 'Sales Growth TTM', presets: GROWTH_PRESETS, isPercent: true },
      { key: 'sales_g_3y', label: 'Sales Growth 3Y', presets: GROWTH_PRESETS, isPercent: true },
      { key: 'sales_g_5y', label: 'Sales Growth 5Y', presets: GROWTH_PRESETS, isPercent: true },
    ],
  },
  {
    title: 'Market & Ownership',
    metrics: [
      { key: 'inst_holders', label: 'Institutional Holders', presets: COUNT_PRESETS },
      { key: 'years_public', label: 'Years Public', presets: YEARS_PRESETS },
      { key: 'pct_below_high', label: 'Off 52w High', presets: HIGHOFF_PRESETS, isPercent: true },
      { key: 'pct_above_low', label: 'Near 52w Low', presets: LOWPROX_PRESETS, isPercent: true },
    ],
  },
];

export const ALL_SCREEN_METRICS: ScreenMetric[] = SCREEN_METRIC_GROUPS.flatMap(
  (g) => g.metrics
);

export interface FilterPreset {
  key: string;
  label: string;
  description: string;
  filters: Record<string, { min: string; max: string }>;
}

export const FILTER_PRESETS: FilterPreset[] = [
  {
    key: 'value',
    label: 'Value',
    description: 'Low P/E, Low P/B',
    filters: {
      pe: { min: '0', max: '15' },
      pb: { min: '0', max: '3' },
    },
  },
  {
    key: 'growth',
    label: 'Growth',
    description: 'High revenue & EPS growth',
    filters: {
      revenue_growth: { min: '20', max: '' },
      eps_growth: { min: '20', max: '' },
    },
  },
  {
    key: 'quality',
    label: 'Quality',
    description: 'High ROE, low debt',
    filters: {
      roe: { min: '15', max: '' },
      debt_equity: { min: '', max: '1' },
    },
  },
  {
    key: 'profitable',
    label: 'Profitable',
    description: 'Strong margins & ROE',
    filters: {
      roe: { min: '15', max: '' },
      profit_margin: { min: '10', max: '' },
    },
  },
  {
    key: 'conservative',
    label: 'Conservative',
    description: 'Low debt, high liquidity',
    filters: {
      debt_equity: { min: '', max: '0.5' },
      current_ratio: { min: '2', max: '' },
    },
  },
  {
    key: 'highroe',
    label: 'High ROE',
    description: 'Top return on equity',
    filters: {
      roe: { min: '25', max: '' },
    },
  },
];
