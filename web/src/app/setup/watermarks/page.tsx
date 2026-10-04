'use client';

import { WatermarkManager } from './WatermarkManager';
import { SetupAreaNav } from '../SetupAreaNav';

export default function WatermarksPage() {
  return (
    <div className="bg-white min-h-[calc(100vh-4rem)] font-sans">
      <SetupAreaNav />
      <div className="py-12 px-8 pb-8 text-center border-b border-rule">
        <h1 className="font-sans text-[2rem] font-bold tracking-tight text-ink mb-2">Watermarks</h1>
        <p className="text-base text-ink-light max-w-2xl mx-auto">
          Where each table&apos;s next incremental sync starts. If a table is missing data
          after its watermark, rewind it to the last date you trust and re-run the ingest.
          Re-pulling rows you already have is harmless; watermarks can only move back.
        </p>
      </div>
      <WatermarkManager />
    </div>
  );
}
