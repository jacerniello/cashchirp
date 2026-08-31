// Curated commodity ETF universe — a faithful port of the Dash commodities page's
// COMMODITIES table (core/frontend/pages/commodities.py). `fredSpot` is the FRED
// *spot* series for the underlying (the backtest-clean reference the ETF proxies),
// or null where there's no clean single FRED spot series. ETF prices come from `sfp`.

export interface Commodity {
  ticker: string;
  label: string;
  group: 'Metals' | 'Energy' | 'Broad' | 'Agriculture';
  fredSpot: string | null;
}

export const COMMODITIES: Commodity[] = [
  { ticker: 'GLD', label: 'Gold — SPDR Gold Trust', group: 'Metals', fredSpot: null },
  { ticker: 'IAU', label: 'Gold — iShares Gold Trust', group: 'Metals', fredSpot: null },
  { ticker: 'SLV', label: 'Silver — iShares Silver Trust', group: 'Metals', fredSpot: null },
  { ticker: 'CPER', label: 'Copper — US Copper Index', group: 'Metals', fredSpot: 'PCOPPUSDM' },
  { ticker: 'PPLT', label: 'Platinum — abrdn Platinum', group: 'Metals', fredSpot: null },
  { ticker: 'PALL', label: 'Palladium — abrdn Palladium', group: 'Metals', fredSpot: null },
  { ticker: 'USO', label: 'Crude (WTI) — US Oil Fund', group: 'Energy', fredSpot: 'DCOILWTICO' },
  { ticker: 'DBO', label: 'Crude (WTI) — Invesco DB Oil', group: 'Energy', fredSpot: 'DCOILWTICO' },
  { ticker: 'BNO', label: 'Crude (Brent) — US Brent Oil Fund', group: 'Energy', fredSpot: 'DCOILBRENTEU' },
  { ticker: 'UNG', label: 'Natural gas — US Nat Gas Fund', group: 'Energy', fredSpot: 'DHHNGSP' },
  { ticker: 'DBC', label: 'Broad — Invesco DB Commodity Idx', group: 'Broad', fredSpot: null },
  { ticker: 'GSG', label: 'Broad — iShares S&P GSCI', group: 'Broad', fredSpot: null },
  { ticker: 'PDBC', label: 'Broad — Invesco Optimum Yield', group: 'Broad', fredSpot: null },
  { ticker: 'CORN', label: 'Corn — Teucrium Corn', group: 'Agriculture', fredSpot: null },
  { ticker: 'WEAT', label: 'Wheat — Teucrium Wheat', group: 'Agriculture', fredSpot: null },
];

export const LABEL: Record<string, string> = Object.fromEntries(
  COMMODITIES.map((c) => [c.ticker, c.label])
);

// ETF -> its FRED spot series (only where FRED has a clean one).
export const SPOT: Record<string, string> = Object.fromEntries(
  COMMODITIES.filter((c) => c.fredSpot).map((c) => [c.ticker, c.fredSpot as string])
);

export type Lookback = '1Y' | '3Y' | '5Y' | '10Y' | 'Max';

export const LOOKBACKS: { label: Lookback; years: number | null }[] = [
  { label: '1Y', years: 1 },
  { label: '3Y', years: 3 },
  { label: '5Y', years: 5 },
  { label: '10Y', years: 10 },
  { label: 'Max', years: null },
];
