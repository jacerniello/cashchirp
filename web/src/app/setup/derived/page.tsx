'use client';

import { BuildRunner } from '../BuildRunner';
import { SetupAreaNav } from '../SetupAreaNav';

export default function DerivedPage() {
  return (
    <div className="bg-white min-h-[calc(100vh-4rem)] font-sans">
      <SetupAreaNav />
      <div className="py-12 px-8 pb-8 text-center border-b border-rule">
        <h1 className="font-sans text-[2rem] font-bold tracking-tight text-ink mb-2">Derived</h1>
        <p className="text-base text-ink-light max-w-2xl mx-auto">
          Recompute the precomputed tables the app reads.
        </p>
      </div>
      <BuildRunner
        kind="derive"
        title="Rebuild the derived tables"
        blurb="The screener snapshot, holder and institutional time-series, insider
               aggregates and S&P 500 concentration — all computed locally from data you
               already have. Rebuild these after an ingest, or whenever a query that
               feeds them changes. Each builds into a new table and swaps it in, so an
               interrupted rebuild leaves the live one untouched."
        cost="Minutes · no network, no cost, safe to re-run at any time"
      />
    </div>
  );
}
