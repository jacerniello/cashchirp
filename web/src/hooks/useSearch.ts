'use client';

import { useQuery, keepPreviousData } from '@tanstack/react-query';
import api from '../lib/api';

export type SearchType = 'stock' | 'fund' | 'entity';

export interface StockResult {
  ticker: string;
  name: string;
  exchange: string;
  cik?: string;
  url: string;  // Precomputed URL from search index
}

export interface FundResult {
  ticker: string;
  name: string;
  exchange?: string;
  series_id?: string;
  cik?: string | null;
  has_fund_data?: boolean;
  price_only?: boolean;
  url: string;  // Precomputed URL from search index
}

export interface EntityResult {
  cik?: string;
  lei?: string;
  name?: string;
  entity_legal_name?: string;
  former_name?: string;
  is_lei: boolean;
  url: string;  // Precomputed URL from search index
}

export interface SearchResponse<T> {
  results: T[];
  query: string;
}

async function searchApi<T>(type: SearchType, query: string): Promise<SearchResponse<T>> {
  const response = await api.get('/search/', {
    params: { type, q: query },
  });
  return response.data;
}

export function useSearchStocks(query: string) {
  return useQuery({
    queryKey: ['search-stocks', query],
    queryFn: () => searchApi<StockResult>('stock', query),
    enabled: query.length >= 2,
  });
}

export function useSearchFunds(query: string) {
  return useQuery({
    queryKey: ['search-funds', query],
    queryFn: () => searchApi<FundResult>('fund', query),
    enabled: query.length >= 2,
  });
}

export function useSearchEntities(query: string) {
  return useQuery({
    queryKey: ['search-entities', query],
    queryFn: () => searchApi<EntityResult>('entity', query),
    enabled: query.length >= 2,
  });
}
