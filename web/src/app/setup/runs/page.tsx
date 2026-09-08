'use client';

import { RunHistory } from './RunHistory';
import { SetupAreaNav } from '../SetupAreaNav';

export default function RunsPage() {
  return (
    <div className="bg-white min-h-[calc(100vh-4rem)] font-sans">
      <SetupAreaNav />
      <div className="py-12 px-8 pb-8 text-center border-b border-rule">
        <h1 className="font-sans text-[2rem] font-bold tracking-tight text-ink mb-2">Runs</h1>
        <p className="text-base text-ink-light max-w-2xl mx-auto">
          Every process this app has started, newest first — with its log, and whether a
          schedule fired it or somebody clicked it.
        </p>
      </div>
      <RunHistory />
    </div>
  );
}
