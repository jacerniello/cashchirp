'use client';

import Link from 'next/link';
import { btnGhost } from '@/components/research/ResearchBits';
import { useLoadScreen } from '@/hooks/useSavedScreens';
import { SnapshotScreenButton } from './SnapshotResults';

// The things you do with a saved screen, in one row: snapshot what it finds, backtest it,
// or load it into the filter grid to change it. Used on the Saved screens index and on
// each screen's own page, so the two cannot drift.

export function BacktestScreenLink({ screenId, label = 'Backtest this screen' }: { screenId: string; label?: string }) {
  return (
    <Link href={`/backtests?screen=${encodeURIComponent(screenId)}`} className={`${btnGhost} no-underline`}
          title="Open the backtest form with this screen selected">
      {label}
    </Link>
  );
}

/** Load the screen into `/screener`. If the grid cannot show part of it, say so here —
 *  before leaving the page — instead of letting the grid pass for the whole screen. */
export function EditInScreenerButton({ screenId }: { screenId: string }) {
  const { load, loading, err, lossy, clearLossy } = useLoadScreen();
  return (
    <div className="inline-flex flex-col gap-1.5">
      <button type="button" className={btnGhost} disabled={loading === screenId}
              onClick={() => load(screenId, { holdIfLossy: true })}
              title="Load this screen's filter into the screener grid">
        {loading === screenId ? 'Loading…' : 'Edit in screener'}
      </button>
      {err && <span className="text-xs text-neg">Could not load the screen: {err}</span>}
      {lossy && (
        <div className="text-xs bg-gold-soft text-ink-light rounded-lg px-3 py-2 max-w-md">
          The grid has no widget for part of this screen:
          <ul className="list-disc ml-4 my-1">
            {lossy.items.map((x) => <li key={x}>{x}</li>)}
          </ul>
          Those still apply when the screen is run, and are kept if you re-save it from the grid.{' '}
          <Link href={lossy.href} className="font-semibold text-green">Open in screener anyway →</Link>{' '}
          <button type="button" onClick={clearLossy}
                  className="bg-transparent border-0 p-0 text-ink-muted underline cursor-pointer">
            cancel
          </button>
        </div>
      )}
    </div>
  );
}

export function ScreenActions({ screenId, showOpen = false }: { screenId: string; showOpen?: boolean }) {
  return (
    <div className="flex items-start gap-2 flex-wrap">
      <SnapshotScreenButton screenId={screenId} label={showOpen ? 'Snapshot' : 'Take snapshot now'} />
      <BacktestScreenLink screenId={screenId} label={showOpen ? 'Backtest' : 'Backtest this screen'} />
      <EditInScreenerButton screenId={screenId} />
      {showOpen && (
        <Link href={`/screener/ideas/${encodeURIComponent(screenId)}`} className={`${btnGhost} no-underline`}>
          Open →
        </Link>
      )}
    </div>
  );
}
