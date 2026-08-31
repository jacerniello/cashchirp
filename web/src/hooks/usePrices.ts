'use client';

import { useQuery, useQueries } from '@tanstack/react-query';
import api from '../lib/api';

export interface PricePoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  adj_open: number;
  adj_high: number;
  adj_low: number;
  adj_close: number;
  adj_volume: number;
}

export interface CorporateAction {
  date: string;
  type: 'dividend' | 'split';
  value: number;
  color: string;
  radius: number;
}

export interface TickerMeta {
  ticker?: string;
  name?: string;
  exchange?: string;
  asset_type?: string;
}

export interface PricesResponse {
  prices: Record<string, PricePoint>;
  corporate_actions: CorporateAction[];
  meta?: TickerMeta;
}

export interface PriceDataPoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Shared transformation function to avoid code duplication
// Uses simple string comparison instead of localeCompare for ISO date strings (faster)
function transformPricesResponse(
  data: PricesResponse,
  useAdjusted: boolean
): { prices: PriceDataPoint[]; corporateActions: CorporateAction[]; meta?: TickerMeta } {
  const pricesObj = data.prices || {};
  const entries = Object.keys(pricesObj);

  // Pre-sort keys (ISO date strings sort correctly with < >)
  entries.sort();

  // Map in sorted order - avoids sorting array of objects
  const prices: PriceDataPoint[] = entries.map((date) => {
    const p = pricesObj[date];
    return {
      date,
      open: useAdjusted ? p.adj_open : p.open,
      high: useAdjusted ? p.adj_high : p.high,
      low: useAdjusted ? p.adj_low : p.low,
      close: useAdjusted ? p.adj_close : p.close,
      volume: useAdjusted ? p.adj_volume : p.volume,
    };
  });

  return {
    prices,
    corporateActions: data.corporate_actions || [],
    meta: data.meta,
  };
}

export function usePrices(
  tickerOrPermaTicker: string | null,
  options?: { useAdjusted?: boolean; isTickerSymbol?: boolean }
) {
  const useAdjusted = options?.useAdjusted ?? true;
  const isTickerSymbol = options?.isTickerSymbol ?? false;

  return useQuery({
    queryKey: ['prices', tickerOrPermaTicker, useAdjusted, isTickerSymbol],
    queryFn: async () => {
      const param = isTickerSymbol ? 'ticker' : 'perma_ticker';
      const response = await api.get<PricesResponse>(
        `/prices/?${param}=${encodeURIComponent(tickerOrPermaTicker!)}`
      );
      return transformPricesResponse(response.data, useAdjusted);
    },
    enabled: !!tickerOrPermaTicker,
    staleTime: 1000 * 60 * 20, // 20 minutes - data doesn't change frequently
    gcTime: 1000 * 60 * 30, // 30 minutes garbage collection to prevent memory bloat
  });
}

// Hook for fetching multiple tickers/perma_tickers at once (for comparison charts)
// Uses useQueries to comply with React's Rules of Hooks
export function useMultiplePrices(
  tickers: string[],
  options?: { useAdjusted?: boolean; isTickerSymbol?: boolean }
) {
  const useAdjusted = options?.useAdjusted ?? true;
  const isTickerSymbol = options?.isTickerSymbol ?? false;

  return useQueries({
    queries: tickers.map((ticker) => ({
      queryKey: ['prices', ticker, useAdjusted, isTickerSymbol],
      queryFn: async () => {
        const param = isTickerSymbol ? 'ticker' : 'perma_ticker';
        const response = await api.get<PricesResponse>(
          `/prices/?${param}=${encodeURIComponent(ticker)}`
        );
        return transformPricesResponse(response.data, useAdjusted);
      },
      enabled: !!ticker,
      staleTime: 1000 * 60 * 20,
      gcTime: 1000 * 60 * 30,
    })),
  });
}

