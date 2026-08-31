'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import type { ScreenerParams } from './useScreener';

// Saved screens — the filters you keep, stored as `config/screens/<id>.yaml`.
//
// Saving writes the SAME format the idea board and the point-in-time backtest read, so a
// filter built by dragging sliders becomes runnable (`run_screen <id>`) and backtestable
// rather than being trapped in this page's URL.

export interface SavedScreen {
  id: string;
  title: string;
  description: string;
  /** Live count of what this screen finds right now; null if its spec won't load. */
  count?: number | null;
  criteria?: string[];
  error?: string;
}

export interface ScreensResponse {
  active: string;
  screens: SavedScreen[];
  asof?: string | null;
}

export interface SaveScreenResult {
  saved: string;
  path: string;
  spec: Record<string, unknown>;
  /** Query params that could NOT be expressed as a gate. The save still succeeded, but
   *  these were not captured — showing them is the difference between "saved" and
   *  "saved the thing you were actually looking at". */
  unsupported: string[];
  /** Constraints inherited from the screen this was loaded from, because the grid has no
   *  widget for them. Reported so the carry-forward is visible, not magic. */
  carried?: string[];
  run: string;
}

export interface ScreenDetail {
  id: string;
  title: string;
  description: string;
  criteria: string[];
  active: boolean;
  spec: Record<string, unknown>;
  /** `/screener` query params that reproduce this screen — what makes it clickable. */
  url_params: Record<string, string>;
  /** Constraints the grid has no widget for. They STILL apply when the screen is run;
   *  they just aren't shown, and the UI must say so. */
  lossy: string[];
}

/** Fetch one screen on demand — used when you click it, to load it into the filter. */
export async function fetchScreen(id: string): Promise<ScreenDetail> {
  return (await api.get(`/screener/screens/${id}`)).data;
}

export function useScreens() {
  return useQuery({
    queryKey: ['screens'],
    queryFn: async (): Promise<ScreensResponse> => (await api.get('/screener/screens/')).data,
    staleTime: 60_000,
  });
}

export function useSaveScreen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      id: string;
      title?: string;
      description?: string;
      params: ScreenerParams;
      overwrite?: boolean;
      base?: string;
    }): Promise<SaveScreenResult> => (await api.post('/screener/screens/', body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['screens'] }),
  });
}

export function useDeleteScreen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/screener/screens/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['screens'] }),
  });
}
