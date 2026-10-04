'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/Badge';
import { useScreens } from '@/hooks/useSavedScreens';
import {
  errorText,
  useCurrentBacktestRun,
  useRunBacktest,
  type BacktestKind,
} from '@/hooks/useBacktests';

const inputCls =
  'w-full rounded-lg border border-rule bg-white px-3 py-2 text-sm text-ink focus:outline-none focus:border-green';
const labelCls = 'block text-xs font-semibold uppercase tracking-wide text-ink-faint mb-1';

// Starting a run spawns `python -m core.backend.backtest.run` as a detached process; this
// form then tails its log. The same command works from a terminal — the form is a
// convenience, not the only way in.
export function RunBacktestForm() {
  const qc = useQueryClient();
  const screensQ = useScreens();
  const runQ = useCurrentBacktestRun();
  const start = useRunBacktest();

  const [screen, setScreen] = useState('');
  const [kind, setKind] = useState<BacktestKind>('portfolio');
  const [from, setFrom] = useState('2005-01-01');
  const [to, setTo] = useState('');
  const [rebalance, setRebalance] = useState(12);
  const [hold, setHold] = useState(12);
  const [cost, setCost] = useState(30);
  const [benchmark, setBenchmark] = useState('SPY');
  const [name, setName] = useState('');
  const [startedHere, setStartedHere] = useState(false);

  const screens = useMemo(() => screensQ.data?.screens ?? [], [screensQ.data]);
  // Default to the active screen until the user picks one — derived, not copied into state.
  const chosen = screen || screensQ.data?.active || screens[0]?.id || '';

  const run = runQ.data;
  const running = !!run?.running;

  // When a run finishes, refresh the report list so the new report appears.
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !running) qc.invalidateQueries({ queryKey: ['backtests'] });
    wasRunning.current = running;
  }, [running, qc]);

  const logRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [run?.lines]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chosen) return;
    setStartedHere(true);
    start.mutate({
      screen: chosen,
      kind,
      start: from,
      end: to || null,
      rebalance_months: rebalance,
      hold_months: hold,
      cost_bps: cost,
      benchmark: benchmark || 'SPY',
      name: name.trim() || null,
    });
  };

  const showLog = running || (startedHere && run && (run.lines?.length ?? 0) > 0);

  return (
    <div className="rounded-xl border border-rule bg-white overflow-hidden">
      <div className="px-6 py-4 border-b border-rule flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-ink">Run a backtest</h2>
          <p className="text-sm text-ink-faint">
            Point-in-time and survivorship-free. Write down what result would make you
            abandon the screen <em>before</em> you run it.
          </p>
        </div>
        {running && <Badge variant="yellow">running</Badge>}
      </div>

      <form onSubmit={submit} className="px-6 py-5 grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="col-span-2">
          <label className={labelCls} htmlFor="bt-screen">Saved screen</label>
          {screensQ.isError ? (
            <p className="text-sm text-neg">Could not load saved screens: {errorText(screensQ.error)}</p>
          ) : (
            <select
              id="bt-screen"
              className={inputCls}
              value={chosen}
              onChange={(e) => setScreen(e.target.value)}
              disabled={screensQ.isLoading}
            >
              {screensQ.isLoading && <option>Loading…</option>}
              {screens.map((s) => (
                <option key={s.id} value={s.id}>{s.title} ({s.id})</option>
              ))}
            </select>
          )}
        </div>
        <div>
          <label className={labelCls} htmlFor="bt-kind">Kind</label>
          <select id="bt-kind" className={inputCls} value={kind}
                  onChange={(e) => setKind(e.target.value as BacktestKind)}>
            <option value="portfolio">Portfolio (equal-weight, rebalanced)</option>
            <option value="cohort">Cohort (forward returns per name)</option>
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="bt-bench">Benchmark</label>
          <input id="bt-bench" className={inputCls} value={benchmark}
                 onChange={(e) => setBenchmark(e.target.value.toUpperCase())} />
        </div>
        <div>
          <label className={labelCls} htmlFor="bt-start">Start</label>
          <input id="bt-start" type="date" className={inputCls} value={from} min="1999-01-01"
                 onChange={(e) => setFrom(e.target.value)} required />
        </div>
        <div>
          <label className={labelCls} htmlFor="bt-end">End (blank = latest)</label>
          <input id="bt-end" type="date" className={inputCls} value={to}
                 onChange={(e) => setTo(e.target.value)} />
        </div>
        <div>
          <label className={labelCls} htmlFor="bt-reb">Rebalance (months)</label>
          <input id="bt-reb" type="number" min={1} max={60} className={inputCls} value={rebalance}
                 onChange={(e) => setRebalance(Number(e.target.value) || 12)} />
        </div>
        {kind === 'cohort' ? (
          <div>
            <label className={labelCls} htmlFor="bt-hold">Forward horizon (months)</label>
            <input id="bt-hold" type="number" min={1} max={120} className={inputCls} value={hold}
                   onChange={(e) => setHold(Number(e.target.value) || 12)} />
          </div>
        ) : (
          <div>
            <label className={labelCls} htmlFor="bt-cost">Cost (bps / turnover)</label>
            <input id="bt-cost" type="number" min={0} max={1000} className={inputCls} value={cost}
                   onChange={(e) => setCost(Number(e.target.value) || 0)} />
          </div>
        )}
        <div className="col-span-2 md:col-span-3">
          <label className={labelCls} htmlFor="bt-name">Report name (optional)</label>
          <input id="bt-name" className={inputCls} value={name} maxLength={120}
                 placeholder="defaults to screen + kind + years"
                 onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="flex items-end">
          <button
            type="submit"
            disabled={running || start.isPending || !chosen}
            className="w-full rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white cursor-pointer
                       hover:bg-ink-mid disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {running ? 'Running…' : start.isPending ? 'Starting…' : 'Run backtest'}
          </button>
        </div>
      </form>

      {start.isError && (
        <div className="mx-6 mb-4 rounded-lg border border-neg bg-neg-soft px-4 py-3 text-sm text-neg">
          Could not start: {errorText(start.error)}
        </div>
      )}
      {runQ.isError && (
        <div className="mx-6 mb-4 rounded-lg border border-rule bg-surface px-4 py-3 text-sm text-ink-faint">
          Could not check for a running backtest: {errorText(runQ.error)}
        </div>
      )}

      {showLog && run && (
        <div className="border-t border-rule px-6 py-4 space-y-3">
          <div className="flex items-center justify-between gap-3 text-xs text-ink-faint">
            <span className="font-mono">{run.log_name}</span>
            {!running && run.phase === 'done' && run.report_id && (
              <Link href={`/backtests/${run.report_id}`} className="text-sm font-semibold text-green no-underline">
                Open the new report →
              </Link>
            )}
            {!running && run.phase === 'failed' && (
              <Badge variant="red">failed{run.detail ? `: ${run.detail.slice(0, 120)}` : ''}</Badge>
            )}
            {!running && run.phase && !['done', 'failed'].includes(run.phase) && (
              <Badge variant="gray">process ended ({run.phase}) — see the log</Badge>
            )}
          </div>
          <pre
            ref={logRef}
            className="max-h-80 overflow-auto rounded-lg bg-ink text-white/85 text-[0.72rem]
                       leading-relaxed font-mono p-3 whitespace-pre-wrap"
          >
            {(run.lines ?? []).join('\n') || 'Starting…'}
          </pre>
        </div>
      )}
    </div>
  );
}
