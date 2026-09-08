'use client';

import { useMemo, useState } from 'react';
import { Badge } from '@/components/Badge';
import {
  useSchedules,
  useScheduleMutations,
  type Cadence,
  type JobMode,
  type Schedule,
} from '@/hooks/useJobs';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Offered as buttons rather than a free number field: these are the intervals anyone
// actually wants, and a box accepting "7" invites a schedule that hammers a paid API.
const INTERVALS: { label: string; minutes: number }[] = [
  { label: '15m', minutes: 15 },
  { label: '1h', minutes: 60 },
  { label: '6h', minutes: 360 },
  { label: '12h', minutes: 720 },
  { label: '24h', minutes: 1440 },
];

const MODE_HELP: Record<JobMode, string> = {
  update: 'Pull what changed since last time. The normal choice.',
  missing: 'Only load what has never been loaded. Skips populated tables.',
  full: 'Re-download everything from scratch. Slow, and spends API quota.',
};

function whenText(nextRunAt: string | null, now: string | undefined): string {
  if (!nextRunAt) return '—';
  const next = new Date(nextRunAt).getTime();
  const base = now ? new Date(now).getTime() : Date.now();
  const mins = Math.round((next - base) / 60000);
  if (mins <= 0) return 'due now';
  if (mins < 60) return `in ${mins}m`;
  if (mins < 60 * 24) return `in ${Math.round(mins / 60)}h`;
  return `in ${Math.round(mins / 1440)}d`;
}

function fmt(ts: string | null): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function ScheduleManager() {
  const { data, isLoading, isError } = useSchedules();
  const { create, patch, remove, runNow } = useScheduleMutations();

  const [key, setKey] = useState('build:derive');
  const [cadence, setCadence] = useState<Cadence>('daily');
  const [mode, setMode] = useState<JobMode>('update');
  const [minutes, setMinutes] = useState(360);
  const [atTime, setAtTime] = useState('03:00');
  const [weekday, setWeekday] = useState(6);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const jobs = data?.jobs ?? [];
  const grouped = useMemo(() => {
    const out = new Map<string, typeof jobs>();
    for (const j of jobs) out.set(j.phase, [...(out.get(j.phase) ?? []), j]);
    return [...out.entries()];
  }, [jobs]);

  // The page must say something true when the API is off rather than spin forever.
  if (isError) {
    return (
      <div className="max-w-[1100px] mx-auto px-6 py-10">
        <div className="rounded-xl border border-rule bg-white p-6 text-sm text-ink-light">
          Could not reach the setup API. Scheduling is only available where{' '}
          <code className="text-ink">SETUP_ENABLED</code> is on — a public deployment does
          not mount these routes at all.
        </div>
      </div>
    );
  }

  const submit = async () => {
    setError(null);
    try {
      await create.mutateAsync({
        key, cadence, mode,
        interval_minutes: cadence === 'interval' ? minutes : null,
        at_time: cadence === 'interval' ? null : atTime,
        weekday: cadence === 'weekly' ? weekday : null,
        note: note.trim() || null,
      });
      setNote('');
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail ?? 'Could not create the schedule.');
    }
  };

  const schedules = data?.schedules ?? [];

  return (
    <div className="max-w-[1100px] mx-auto px-6 py-10 space-y-8">
      {/* Where the scheduler actually lives — worth stating, because it is the one
          surprising thing about it. */}
      <div className="rounded-xl border border-rule bg-white p-5">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="text-sm text-ink-light">
            Schedules run inside the API process, so they fire only while it is running.
            It checks every {data?.tick_seconds ?? 30}s.
          </div>
          <Badge variant={data?.scheduler_running ? 'green' : 'red'}>
            {data?.scheduler_running ? 'Scheduler running' : 'Scheduler stopped'}
          </Badge>
        </div>
      </div>

      {/* ---------------------------------------------------------------- new */}
      <div className="rounded-xl border border-rule bg-white p-6">
        <h2 className="text-sm font-semibold text-ink uppercase tracking-wide mb-4">
          Schedule a job
        </h2>

        <div className="grid grid-cols-2 max-[760px]:grid-cols-1 gap-5">
          <label className="block">
            <span className="text-xs font-medium text-ink-light">What to run</span>
            <select
              value={key}
              onChange={(e) => setKey(e.target.value)}
              className="mt-1 w-full rounded-lg border border-rule px-3 py-2 text-sm bg-white text-ink"
            >
              {grouped.map(([phase, items]) => (
                <optgroup key={phase} label={phase}>
                  {items.map((j) => (
                    <option key={j.key} value={j.key}>{j.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-xs font-medium text-ink-light">Mode</span>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as JobMode)}
              className="mt-1 w-full rounded-lg border border-rule px-3 py-2 text-sm bg-white text-ink"
            >
              {(data?.modes ?? []).map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <span className="mt-1 block text-xs text-ink-muted">{MODE_HELP[mode]}</span>
          </label>
        </div>

        <div className="mt-5">
          <span className="text-xs font-medium text-ink-light">How often</span>
          <div className="mt-1.5 flex gap-2 flex-wrap">
            {(['interval', 'daily', 'weekly'] as Cadence[]).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCadence(c)}
                className={`rounded-lg border px-3 py-1.5 text-sm cursor-pointer transition-colors
                  ${cadence === c
                    ? 'border-green bg-green-soft text-green-text font-medium'
                    : 'border-rule bg-white text-ink-light hover:border-green'}`}
              >
                {c}
              </button>
            ))}
          </div>

          <div className="mt-3">
            {cadence === 'interval' && (
              <div className="flex gap-2 flex-wrap items-center">
                {INTERVALS.map((i) => (
                  <button
                    key={i.minutes}
                    type="button"
                    onClick={() => setMinutes(i.minutes)}
                    className={`rounded-lg border px-3 py-1.5 text-sm cursor-pointer
                      ${minutes === i.minutes
                        ? 'border-green bg-green-soft text-green-text font-medium'
                        : 'border-rule bg-white text-ink-light hover:border-green'}`}
                  >
                    every {i.label}
                  </button>
                ))}
                <span className="text-xs text-ink-muted">
                  minimum {data?.min_interval_minutes ?? 5} minutes
                </span>
              </div>
            )}

            {cadence !== 'interval' && (
              <div className="flex gap-3 items-center flex-wrap">
                {cadence === 'weekly' && (
                  <div className="flex gap-1 flex-wrap">
                    {DAYS.map((d, i) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setWeekday(i)}
                        className={`rounded-md border px-2.5 py-1.5 text-xs cursor-pointer
                          ${weekday === i
                            ? 'border-green bg-green-soft text-green-text font-medium'
                            : 'border-rule bg-white text-ink-light hover:border-green'}`}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                )}
                <label className="flex items-center gap-2">
                  <span className="text-xs text-ink-light">at</span>
                  <input
                    type="time"
                    value={atTime}
                    onChange={(e) => setAtTime(e.target.value)}
                    className="rounded-lg border border-rule px-2.5 py-1.5 text-sm bg-white text-ink"
                  />
                  <span className="text-xs text-ink-muted">your local time</span>
                </label>
              </div>
            )}
          </div>
        </div>

        <label className="block mt-5">
          <span className="text-xs font-medium text-ink-light">Note (optional)</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="why this exists"
            className="mt-1 w-full rounded-lg border border-rule px-3 py-2 text-sm bg-white text-ink"
          />
        </label>

        {error && (
          <p className="mt-4 text-sm text-red bg-red-soft rounded-lg px-3 py-2">{error}</p>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={create.isPending}
          className="mt-5 rounded-lg bg-green px-4 py-2 text-sm font-medium text-white
                     border-0 cursor-pointer hover:bg-green-dark disabled:opacity-60"
        >
          {create.isPending ? 'Adding…' : 'Add schedule'}
        </button>
      </div>

      {/* ------------------------------------------------------------ existing */}
      <div className="rounded-xl border border-rule bg-white overflow-hidden">
        <div className="px-6 py-4 border-b border-rule">
          <h2 className="text-sm font-semibold text-ink uppercase tracking-wide">
            Schedules {schedules.length > 0 && `(${schedules.length})`}
          </h2>
        </div>

        {isLoading && <p className="px-6 py-8 text-sm text-ink-muted">Loading…</p>}

        {!isLoading && schedules.length === 0 && (
          <p className="px-6 py-8 text-sm text-ink-muted">
            Nothing scheduled. Everything here runs only when you click it.
          </p>
        )}

        {schedules.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-ink-faint">
                  <th className="px-6 py-2 font-medium">Job</th>
                  <th className="px-3 py-2 font-medium">Cadence</th>
                  <th className="px-3 py-2 font-medium">Mode</th>
                  <th className="px-3 py-2 font-medium">Last</th>
                  <th className="px-3 py-2 font-medium">Next</th>
                  <th className="px-6 py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {schedules.map((s: Schedule) => (
                  <tr key={s.id} className="border-t border-rule align-middle">
                    <td className="px-6 py-3">
                      <div className="font-medium text-ink">{s.key}</div>
                      {s.note && <div className="text-xs text-ink-muted">{s.note}</div>}
                    </td>
                    <td className="px-3 py-3 text-ink-light">{s.summary}</td>
                    <td className="px-3 py-3">
                      <Badge variant={s.mode === 'full' ? 'orange' : 'gray'}>{s.mode}</Badge>
                    </td>
                    <td className="px-3 py-3 text-ink-muted text-xs">{fmt(s.last_run_at)}</td>
                    <td className="px-3 py-3">
                      {s.enabled ? (
                        <>
                          <div className="text-ink">{whenText(s.next_run_at, data?.now)}</div>
                          <div className="text-xs text-ink-muted">{fmt(s.next_run_at)}</div>
                        </>
                      ) : (
                        <Badge variant="gray">paused</Badge>
                      )}
                    </td>
                    <td className="px-6 py-3">
                      <div className="flex gap-2 justify-end flex-wrap">
                        <button
                          type="button"
                          onClick={() => runNow.mutate(s.id)}
                          disabled={runNow.isPending}
                          className="rounded-md border border-rule bg-white px-2.5 py-1 text-xs
                                     text-ink-light cursor-pointer hover:border-green hover:text-green"
                        >
                          Run now
                        </button>
                        <button
                          type="button"
                          onClick={() => patch.mutate({ id: s.id, enabled: !s.enabled })}
                          className="rounded-md border border-rule bg-white px-2.5 py-1 text-xs
                                     text-ink-light cursor-pointer hover:border-green hover:text-green"
                        >
                          {s.enabled ? 'Pause' : 'Resume'}
                        </button>
                        <button
                          type="button"
                          onClick={() => remove.mutate(s.id)}
                          className="rounded-md border border-rule bg-white px-2.5 py-1 text-xs
                                     text-ink-muted cursor-pointer hover:border-red hover:text-red"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {runNow.isError && (
        <p className="text-sm text-red bg-red-soft rounded-lg px-3 py-2">
          Could not start it now:{' '}
          {(runNow.error as { response?: { data?: { detail?: string } } })
            ?.response?.data?.detail ?? 'already running?'}
        </p>
      )}
    </div>
  );
}
