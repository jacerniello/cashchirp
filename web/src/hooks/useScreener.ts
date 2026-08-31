'use client';

import { useQuery, keepPreviousData } from '@tanstack/react-query';
import api from '@/lib/api';

export type MarketCapRange = 'mega' | 'large' | 'mid' | 'small' | 'micro' | 'nano';

export interface ScreenerCompany {
  ticker: string | null;
  name: string | null;
  cik: string | null;
  permaticker: number | string | null;
  sector: string | null;
  industry: string | null;
  exchange: string | null;
  location: string | null;
  market_cap: number | null;
  pe_ratio: number | null;
  ps_ratio: number | null;
  pb_ratio: number | null;
  peg_ratio: number | null;
  ev_ebitda: number | null;
  ev_sales: number | null;
  roe: number | null;
  roic: number | null;
  gross_margin: number | null;
  op_margin: number | null;
  profit_margin: number | null;
  debt_equity: number | null;
  current_ratio: number | null;
  piotroski_f_score: number | null;
  revenue_growth: number | null;
  eps_growth: number | null;
  eps_g_5y: number | null;
  div_yield: number | null;
  net_cash_pct: number | null;
  altman_z: number | null;
  pct_below_high: number | null;
  years_public: number | null;
  inst_holders: number | null;
  inst_ownership_latest: number | null;
  inst_ownership_prev: number | null;
  is_active: boolean;
}

export interface ScreenerResponse {
  results: ScreenerCompany[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
  available_sectors: string[];
  available_industries: string[];
  available_exchanges?: string[];
}

// All numeric range filters share the `<key>_min` / `<key>_max` convention and are
// passed through generically, so this is an open record rather than an exhaustive list.
// Mirrors the Dash screener's metric set (core/api/routers/screener.py → _FILT).
export interface ScreenerParams {
  market_cap_range?: MarketCapRange;
  sector?: string;
  industry?: string;
  exchange?: string;
  exclude_commodities?: boolean;
  exclude_biotech?: boolean;
  include_delisted?: boolean;
  is_active?: boolean;
  sort?: string;
  page?: number;
  per_page?: number;
  // numeric range filters: `${metric}_min` / `${metric}_max`
  [key: `${string}_min`]: number | undefined;
  [key: `${string}_max`]: number | undefined;
}

export interface ScreenerStats {
  ranges: Record<MarketCapRange, number>;
  range_definitions: Record<MarketCapRange, string>;
}

export interface SectorsResponse {
  sectors: string[];
  industries: string[];
  exchanges?: string[];
}

async function fetchScreener(params: ScreenerParams): Promise<ScreenerResponse> {
  const queryParams = new URLSearchParams();

  // Generic pass-through: every defined, non-empty param goes to the API verbatim.
  // The screener router whitelists known keys (_FILT + descriptive), so extra keys
  // are harmless. Keeps this in lockstep with the metric set without a hardcoded list.
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      queryParams.set(key, String(value));
    }
  }

  const response = await api.get(`/screener/?${queryParams.toString()}`);
  return response.data;
}

async function fetchStats(): Promise<ScreenerStats> {
  const response = await api.get('/screener/stats/');
  return response.data;
}

async function fetchSectors(snapshotDate?: string): Promise<SectorsResponse> {
  const params = snapshotDate ? `?snapshot_date=${snapshotDate}` : '';
  const response = await api.get(`/screener/sectors/${params}`);
  return response.data;
}

export function useScreener(params: ScreenerParams, enabled = true) {
  return useQuery({
    queryKey: ['screener', params],
    queryFn: () => fetchScreener(params),
    enabled,
    staleTime: 5 * 60 * 1000,
    // Keep the current page's rows on screen while the next page loads, so paging
    // only swaps the table body instead of collapsing the whole results area.
    placeholderData: keepPreviousData,
  });
}

export function useScreenerStats() {
  return useQuery({
    queryKey: ['screener-stats'],
    queryFn: fetchStats,
    staleTime: 30 * 60 * 1000,
  });
}

export function useScreenerSectors(snapshotDate?: string) {
  return useQuery({
    queryKey: ['screener-sectors', snapshotDate || 'live'],
    queryFn: () => fetchSectors(snapshotDate),
    staleTime: 30 * 60 * 1000,
  });
}
