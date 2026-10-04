'use client';

import { RebuildManager } from './RebuildManager';
import { SetupAreaNav } from '../SetupAreaNav';

export default function RebuildsPage() {
  return (
    <div className="bg-white min-h-[calc(100vh-4rem)] font-sans">
      <SetupAreaNav />
      <div className="py-12 px-8 pb-8 text-center border-b border-rule">
        <h1 className="font-sans text-[2rem] font-bold tracking-tight text-ink mb-2">Rebuilds</h1>
        <p className="text-base text-ink-light max-w-2xl mx-auto">
          Reload a table whole from Sharadar to catch retroactive edits and deleted rows —
          now, or on a monthly schedule.
        </p>
      </div>
      <RebuildManager />
    </div>
  );
}
