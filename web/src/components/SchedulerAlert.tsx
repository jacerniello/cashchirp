'use client';

import Link from 'next/link';
import { useSetupEnabled } from '@/hooks/useSetupEnabled';
import { useRestartScheduler, useSchedulerHealth, type SchedulerHealth } from '@/hooks/useJobs';

// App-wide alert for a scheduler that is down, stalled or failing every tick.
//
// The scheduler is a thread inside the API, so it can die or hang while every page keeps
// working — and a schedule that silently stops firing looks exactly like a quiet night.
// This makes that state loud, on every page, with the fix one click away.
//
// Renders nothing when healthy, when the deployment has no setup surface, or when the
// health check itself fails (the API being down is every page's problem, not this one's).

const TITLES: Record<SchedulerHealth['status'], string> = {
  ok: 'The scheduler is running',
  stopped: 'The scheduler is not running',
  stalled: 'The scheduler is stuck',
  failing: 'The scheduler is failing',
};

export function SchedulerAlert() {
  const setupEnabled = useSetupEnabled();
  const { data } = useSchedulerHealth(setupEnabled);
  const restart = useRestartScheduler();

  if (!data || data.healthy) return null;

  return (
    <div role="alert" className="border-b border-red/30 bg-red-soft">
      <div className="max-w-[1400px] mx-auto px-6 py-2.5 flex items-center gap-4 flex-wrap text-sm">
        <div className="flex-1 min-w-[240px] text-ink">
          <span className="font-semibold text-red">{TITLES[data.status]}.</span>{' '}
          {data.reason}{' '}
          Scheduled jobs will not fire until it is restarted.{' '}
          <Link href="/setup/schedules" className="underline hover:text-red">Schedules</Link>
        </div>
        {restart.isError && (
          <span className="text-red text-xs">Restart failed — check the API log.</span>
        )}
        <button
          type="button"
          onClick={() => restart.mutate()}
          disabled={restart.isPending}
          className="rounded-md bg-red px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60"
        >
          {restart.isPending ? 'Restarting…' : 'Restart scheduler'}
        </button>
      </div>
    </div>
  );
}
