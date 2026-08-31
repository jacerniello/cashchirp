'use client';

import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import type { ScreenerCompany } from './useScreener';

// Idea board — the ACTIVE screen (ACTIVE_SCREEN -> config/screens/<id>.yaml) run
// live on the snapshot, served by GET /screener/ideas/. Each row is a ScreenerCompany (so
// the `/ideas` page reuses the screener grid), annotated where I have a view: `thesis` +
// `why_unloved` for names I'd own, `caution` for ones the screen catches but I'd flag.
// Numbers stay live; see core/api/routers/screener.py → IDEAS / CAUTIONS.
export interface IdeaCompany extends ScreenerCompany {
  thesis: string | null;
  why_unloved: string | null;
  caution: string | null;
}

export interface IdeasResponse {
  results: IdeaCompany[];
  total: number;
  ideas: number;
  flagged: number;
  asof: string | null;
  criteria: string[];
  /** The screen that produced this board — its own title/description, so the page
   *  describes whatever filter is active rather than hardcoding one. */
  screen?: { id: string; title: string; description: string; is_active: boolean };
  /** Every saved screen, so the board can offer a switcher without a second request. */
  available?: { id: string; title: string; description: string }[];
}

async function fetchIdeas(screen?: string): Promise<IdeasResponse> {
  const qs = screen ? `?screen=${encodeURIComponent(screen)}` : '';
  const response = await api.get(`/screener/ideas/${qs}`);
  return response.data;
}

export function useIdeas(screen?: string) {
  return useQuery({
    queryKey: ['ideas', screen ?? '(active)'],
    queryFn: () => fetchIdeas(screen),
    staleTime: 30 * 60 * 1000,
  });
}
