'use client';

import { ScheduleManager } from './ScheduleManager';
import { SetupAreaNav } from '../SetupAreaNav';

export default function SchedulesPage() {
  return (
    <div className="bg-white min-h-[calc(100vh-4rem)] font-sans">
      <SetupAreaNav />
      <div className="py-12 px-8 pb-8 text-center border-b border-rule">
        <h1 className="font-sans text-[2rem] font-bold tracking-tight text-ink mb-2">Schedules</h1>
        <p className="text-base text-ink-light max-w-2xl mx-auto">
          Standing instructions to run a job on a cadence. Anything you can start by hand
          can be scheduled, and every firing is recorded in the run history.
        </p>
      </div>
      <ScheduleManager />
    </div>
  );
}
