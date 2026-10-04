'use client';

import { useMemo } from 'react';
import { useBacktests, type BacktestListItem } from './useBacktests';
import { useSnapshots, type SnapshotSummary } from './useResearch';

// What has been done with each saved screen: the snapshots frozen from it and the
// backtests run on it, indexed by screen id. Both lists come from their own endpoints
// (GET /research/snapshots, GET /backtests) and either can fail on its own — the queries
// are returned so a page can say which one is missing rather than showing "none".

function newestFirst<T>(xs: T[], at: (x: T) => string | null | undefined): T[] {
  return [...xs].sort((a, b) => String(at(b) ?? '').localeCompare(String(at(a) ?? '')));
}

export function useScreenHistory() {
  const snapshots = useSnapshots();
  const backtests = useBacktests();

  const snapsByScreen = useMemo(() => {
    const m = new Map<string, SnapshotSummary[]>();
    for (const s of snapshots.data ?? []) {
      const src = s.source;
      if (src?.kind !== 'screen' || !src.screen_id) continue;
      m.set(src.screen_id, [...(m.get(src.screen_id) ?? []), s]);
    }
    for (const [k, v] of m) m.set(k, newestFirst(v, (s) => s.created_at ?? s.id));
    return m;
  }, [snapshots.data]);

  const backtestsByScreen = useMemo(() => {
    const m = new Map<string, BacktestListItem[]>();
    for (const r of backtests.data?.reports ?? []) {
      const sid = r.screen?.id ?? r.params?.screen;
      if (!sid) continue;
      m.set(sid, [...(m.get(sid) ?? []), r]);
    }
    for (const [k, v] of m) m.set(k, newestFirst(v, (r) => r.created_at ?? r.id));
    return m;
  }, [backtests.data]);

  return {
    snapshots,
    backtests,
    snapshotsFor: (id: string) => snapsByScreen.get(id) ?? [],
    backtestsFor: (id: string) => backtestsByScreen.get(id) ?? [],
  };
}
