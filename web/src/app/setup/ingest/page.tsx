'use client';

import { BuildRunner } from '../BuildRunner';
import { SetupAreaNav } from '../SetupAreaNav';

export default function IngestPage() {
  return (
    <div className="bg-white min-h-[calc(100vh-4rem)] font-sans">
      <SetupAreaNav />
      <div className="py-12 px-8 pb-8 text-center border-b border-rule">
        <h1 className="font-sans text-[2rem] font-bold tracking-tight text-ink mb-2">Ingest</h1>
        <p className="text-base text-ink-light max-w-2xl mx-auto">
          Download from the providers into your database.
        </p>
      </div>
      <BuildRunner
        kind="ingest"
        title="Pull data from the providers"
        blurb="Sharadar, FRED, FINRA and SEC, plus the schema they land in. This is the
               slow half: it is network-bound, rate-limited, and Sharadar spends your paid
               subscription. It is resumable, so stopping costs only the step in flight."
        cost="Hours on a first run · uses your Nasdaq Data Link subscription"
      />
    </div>
  );
}
