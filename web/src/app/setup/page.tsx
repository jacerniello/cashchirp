'use client';

import { useState } from 'react';
import { useSetup, type DatasetStatus, type BuildStep } from '@/hooks/useSetup';
import { Card } from '@/components/Card';
import Link from 'next/link';
import { SetupAreaNav } from './SetupAreaNav';
import { ResetDatabase } from './ResetDatabase';

// Setup — what this database contains, what's missing, and where each piece comes from.
//
// It exists because every data page fails identically against an empty database: a 500
// that reads like a broken deploy when the real answer is "SEP isn't loaded yet". This is
// the page that tells those apart, so it must render something useful even when the API
// itself is down — hence the explicit error branch and no spinner-forever state.
//
// It reports; it does not build. Starting a multi-hour, 35 GB ingest from a web request
// would outlive the request and give you no terminal to Ctrl-C, so the page hands you the
// command instead. While a build IS running, the hook polls the state file bootstrap
// writes and the progress below goes live.

const PHASE_LABEL: Record<string, string> = {
  schema: 'Schema',
  sharadar: 'Sharadar',
  fred: 'FRED',
  finra: 'FINRA',
  sec: 'SEC',
  derived: 'Derived',
};

function Cmd({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(children).then(
          () => { setCopied(true); setTimeout(() => setCopied(false), 1200); },
          () => {},
        );
      }}
      title="Copy"
      className="group w-full text-left font-mono text-[0.8125rem] bg-ink text-white/90
                 rounded-lg px-3 py-2 cursor-pointer border-0 flex items-center gap-2
                 hover:text-white transition-colors"
    >
      <span className="text-white/40 select-none">$</span>
      <span className="flex-1 overflow-x-auto whitespace-pre">{children}</span>
      <span className="text-[0.7rem] text-white/40 group-hover:text-white/70 shrink-0">
        {copied ? 'copied' : 'copy'}
      </span>
    </button>
  );
}

/** loaded / missing / unknown, said out loud. `unknown` is NOT a problem: the dataset
 *  declares no table to measure (the schema step, some derived rebuilds), so there is
 *  nothing to count — which is different from "we looked and it wasn't there". */
const STATE_META: Record<DatasetStatus['state'], { dot: string; label: string; title: string }> = {
  loaded: { dot: 'bg-pos', label: 'loaded', title: 'Rows present in its tables.' },
  missing: { dot: 'bg-neg', label: 'missing', title: 'Its tables exist but hold no rows.' },
  unknown: {
    dot: 'bg-ink-muted/40',
    label: 'n/a',
    title: 'Nothing to measure - this dataset declares no table of its own.',
  },
};

function Dot({ state }: { state: DatasetStatus['state'] }) {
  return (
    <span
      title={STATE_META[state].title}
      className={`inline-block w-2 h-2 rounded-full shrink-0 ${STATE_META[state].dot}`}
    />
  );
}

/** Overall completion of a run, from what the loaders reported — finished steps count 1,
 *  a running step counts only the fraction it actually reported. Never size-weighted: a
 *  step that turns out to be a no-op would otherwise swing the bar for no work done. */
function buildProgress(steps: BuildStep[]): { pct: number; done: number; total: number } {
  const done = steps.filter((s) => ['ok', 'skipped', 'FAIL'].includes(s.status)).length;
  const running = steps
    .filter((s) => s.status === 'running' && s.frac_known)
    .reduce((a, s) => a + s.frac, 0);
  return {
    pct: steps.length ? ((done + running) / steps.length) * 100 : 0,
    done,
    total: steps.length,
  };
}

function StepRow({ s }: { s: BuildStep }) {
  const icon =
    s.status === 'ok' ? <span className="text-pos">✔</span>
    : s.status === 'running' ? <span className="text-green">▶</span>
    : s.status === 'FAIL' ? <span className="text-neg">✕</span>
    : s.status === 'skipped' ? <span className="text-ink-muted">–</span>
    : <span className="text-ink-muted">·</span>;
  const mins = Math.floor(s.seconds / 60);
  const time = s.seconds ? `${mins}:${String(Math.floor(s.seconds % 60)).padStart(2, '0')}` : '';
  return (
    <div className="flex items-baseline gap-3 py-1 text-sm">
      <span className="w-4 shrink-0 text-center">{icon}</span>
      <span className={`flex-1 ${s.status === 'pending' ? 'text-ink-muted' : 'text-ink'}`}>
        {s.label}
      </span>
      {s.status === 'running' && s.frac_known && (
        <span className="text-xs text-green tnum shrink-0">{(s.frac * 100).toFixed(0)}%</span>
      )}
      {s.detail && s.status === 'running' && (
        <span className="text-xs text-ink-faint truncate max-w-[20rem]">{s.detail}</span>
      )}
      {s.rows != null && (
        <span className="text-xs text-ink-faint tnum">{s.rows.toLocaleString()} rows</span>
      )}
      <span className="text-xs text-ink-muted tnum w-12 text-right">{time}</span>
    </div>
  );
}

export default function SetupPage() {
  const { data, isLoading, error } = useSetup();
  const [showAll, setShowAll] = useState(false);

  return (
    <div className="bg-white min-h-[calc(100vh-4rem)] font-sans">
      <SetupAreaNav />
      <div className="py-14 px-8 pb-10 text-center border-b border-rule">
        <h1 className="font-sans text-[2.25rem] max-[570px]:text-[1.75rem] font-bold tracking-tight text-ink mb-3">
          Setup
        </h1>
        <p className="text-base text-ink-light max-w-2xl mx-auto">
          What this database holds, what is missing, and where every piece comes from.
        </p>
      </div>

      <div className="max-w-[1000px] mx-auto py-10 px-6 space-y-5">
        {/* The API being down is itself the answer — say so, don't spin. */}
        {error && (
          <Card>
            <div className="p-5">
              <div className="text-base font-semibold text-ink mb-1">
                Can&apos;t reach the API
              </div>
              <p className="text-sm text-ink-light mb-4">
                The frontend is running but <code className="font-mono">/api/v1</code> did not
                answer, so there is nothing to report yet. Start the backend:
              </p>
              <Cmd>./dev.sh</Cmd>
            </div>
          </Card>
        )}

        {isLoading && !data && (
          <p className="text-sm text-ink-muted">Checking the database…</p>
        )}

        {data && (
          <>
            {/* ---- headline state ---- */}
            <Card>
              <div className="p-5">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <div className="text-base font-semibold text-ink">
                      {!data.database.connected
                        ? 'Postgres unreachable'
                        : data.summary.empty
                          ? 'Database is empty'
                          : data.summary.complete
                            ? 'Database is complete'
                            : 'Database is partially built'}
                    </div>
                    <p className="text-sm text-ink-light mt-1">
                      <code className="font-mono text-[0.9em]">{data.database.name}</code>{' '}
                      at {data.database.host} · {data.database.tables} tables ·{' '}
                      {data.summary.loaded}/{data.summary.datasets} datasets ·{' '}
                      {data.summary.loaded_size} of ~{data.summary.expected_size}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-3xl font-bold text-ink tnum">
                      {Math.round(
                        (data.summary.loaded /
                          Math.max(data.summary.loaded + data.summary.missing, 1)) * 100,
                      )}%
                    </div>
                    <div className="text-xs text-ink-muted">built</div>
                  </div>
                </div>

                {data.summary.empty && (
                  <p className="text-sm text-ink-light mt-4">
                    This is expected on a fresh clone — nobody ships you the data. Every
                    other page will return an error until the tables exist. Build it:
                  </p>
                )}
                {!data.summary.empty && !data.summary.complete && (
                  <p className="text-sm text-ink-light mt-4">
                    Pages backed by the missing datasets will error. Re-run the build — it
                    skips what is already loaded:
                  </p>
                )}
                <p className="text-xs text-ink-muted mt-4">
                  Full walkthrough:{' '}
                  <code className="font-mono">docs/setup/README.md</code> · database only:{' '}
                  <code className="font-mono">docs/setup/database.md</code>
                </p>
              </div>
            </Card>

            {/* ---- the two operations, as destinations rather than triggers ---- */}
            <div className="grid grid-cols-2 max-[720px]:grid-cols-1 gap-4">
              {([
                {
                  href: '/setup/ingest', label: 'Ingest',
                  desc: 'Download from Sharadar, FRED, FINRA and SEC.',
                  cost: 'Hours on a first run',
                  w: data.work.ingest,
                  busy: data.datasets.some(
                    (d) => d.job.running && d.phase !== 'derived') ||
                    (data.build_status.running && data.build_status.phase !== 'derived'),
                },
                {
                  href: '/setup/derived', label: 'Derived',
                  desc: 'Recompute the tables the app reads, from data you already have.',
                  cost: 'Minutes · free, safe to re-run',
                  w: data.work.derive,
                  busy: data.datasets.some(
                    (d) => d.job.running && d.phase === 'derived') ||
                    (data.build_status.running && data.build_status.phase === 'derived'),
                },
              ] as const).map((x) => (
                <Link
                  key={x.href}
                  href={x.href}
                  className="group no-underline bg-white rounded-xl border border-rule shadow-sm
                             p-5 transition-colors hover:border-green"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-base font-semibold text-ink group-hover:text-green
                                     transition-colors">
                      {x.label}
                      {x.busy && (
                        <span className="ml-2 inline-flex items-center gap-1.5 align-middle
                                         text-xs font-normal text-green">
                          <span className="relative flex h-2 w-2">
                            <span className="absolute inline-flex h-full w-full animate-ping
                                             rounded-full bg-green opacity-60" />
                            <span className="relative inline-flex h-2 w-2 rounded-full bg-green" />
                          </span>
                          running
                        </span>
                      )}
                    </span>
                    <span className="text-sm tnum text-ink-light">
                      {x.w.loaded}/{x.w.datasets}
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm text-ink-light leading-relaxed">{x.desc}</p>
                  <p className="mt-2 text-xs text-ink-muted">
                    ~{x.w.expected_size} · {x.cost}
                  </p>
                  <p className="mt-3 text-xs text-green">Open to run and monitor →</p>
                </Link>
              ))}
            </div>

            {/* Ingest and derived jobs are reported SEPARATELY, each linking to its own
                page. One combined banner had to guess a destination from the build's
                phase, which is stale when only a per-dataset job is running — so a
                derived job sent you to the ingest page. Two kinds, two links, no
                guessing. */}
            {(() => {
              const busy = [
                {
                  kind: 'Ingest', href: '/setup/ingest',
                  jobs: data.datasets.filter((d) => d.job.running && d.phase !== 'derived'),
                  build: data.build_status.running && data.build_status.phase !== 'derived',
                },
                {
                  kind: 'Derived', href: '/setup/derived',
                  jobs: data.datasets.filter((d) => d.job.running && d.phase === 'derived'),
                  build: data.build_status.running && data.build_status.phase === 'derived',
                },
              ].filter((x) => x.jobs.length > 0 || x.build);
              if (!busy.length) return null;
              return (
                <div className="space-y-3">
                  {busy.map((x) => (
                    <Card key={x.kind}>
                      <div className="p-4 flex items-center justify-between gap-3 flex-wrap">
                        <span className="text-sm text-ink inline-flex items-center gap-2">
                          <span className="relative flex h-2 w-2 shrink-0">
                            <span className="absolute inline-flex h-full w-full animate-ping
                                             rounded-full bg-green opacity-60" />
                            <span className="relative inline-flex h-2 w-2 rounded-full bg-green" />
                          </span>
                          <span>
                            <strong>{x.kind}</strong>
                            {x.build
                              ? ` — full build, ${data.build_status.progress_pct}% · `
                                + `${data.build_status.steps_done}/${data.build_status.steps_total} steps`
                              : ` — ${x.jobs.length} dataset job${x.jobs.length === 1 ? '' : 's'} running`}
                            {!x.build && x.jobs.length > 0 && (
                              <span className="text-ink-muted">
                                {' · '}{x.jobs.map((j) => j.label).join(', ')}
                              </span>
                            )}
                          </span>
                        </span>
                        <Link
                          href={x.href}
                          className="text-sm font-medium text-green hover:text-green-dark no-underline"
                        >
                          Monitor / stop →
                        </Link>
                      </div>
                    </Card>
                  ))}
                </div>
              );
            })()}

            {/* ---- live build ---- */}
            {data.build && (
              <Card>
                <div className="p-5">
                  <div className="flex items-baseline justify-between gap-3 mb-3">
                    <h2 className="text-sm font-semibold text-ink uppercase tracking-wide">
                      {(data.build.steps ?? []).some((s) => s.status === 'running')
                        ? 'Build in progress'
                        : 'Last build'}
                    </h2>
                    <span className="text-xs text-ink-muted">
                      started {data.build.started_at} · updated {data.build.updated_at}
                    </span>
                  </div>
                  <div className="divide-y divide-rule-light">
                    {(data.build.steps ?? []).map((s) => <StepRow key={s.key} s={s} />)}
                  </div>
                  {(() => {
                    const p = buildProgress(data.build!.steps ?? []);
                    return (
                      <div className="mt-4">
                        <div className="h-2 rounded-full bg-rule-light overflow-hidden">
                          <div
                            className="h-full bg-green rounded-full transition-all"
                            style={{ width: `${p.pct}%` }}
                          />
                        </div>
                        <div className="flex justify-between mt-1.5 text-xs text-ink-muted">
                          <span className="tnum">{p.pct.toFixed(1)}% · {p.done}/{p.total} steps</span>
                          <span>reported by the loaders, not estimated from size</span>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </Card>
            )}

            {/* ---- credentials ---- */}
            <Card>
              <div className="p-5">
                <h2 className="text-sm font-semibold text-ink uppercase tracking-wide mb-3">
                  Credentials
                </h2>
                <div className="space-y-2">
                  {data.credentials.map((c) => (
                    <div key={c.env} className="flex items-baseline gap-3 text-sm">
                      <span className={c.set ? 'text-pos' : 'text-neg'}>
                        {c.set ? '✔' : '✕'}
                      </span>
                      <code className="font-mono text-[0.85em] text-ink">{c.env}</code>
                      <span className="text-ink-faint text-xs flex-1">
                        {c.unlocks.join(', ')}
                      </span>
                      {!c.set && (
                        <span className="text-xs text-neg">not set in core/.env</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </Card>

            {/* ---- phases ---- */}
            <Card>
              <div className="p-5">
                <h2 className="text-sm font-semibold text-ink uppercase tracking-wide mb-3">
                  Phases
                </h2>
                <p className="text-xs text-ink-faint mb-4">
                  Run in this order. <strong className="text-ink-light">TICKERS</strong> is
                  first because it builds the lookup every other table&apos;s stamping
                  reads; <strong className="text-ink-light">derived</strong> is last because
                  rebuilding it mid-ingest snapshots half-updated data.
                </p>
                <div className="space-y-2">
                  {data.phases.map((p) => {
                    const pct = p.count ? (p.loaded / p.count) * 100 : 0;
                    return (
                      <div key={p.id} className="flex items-center gap-3 text-sm">
                        <span className="w-20 shrink-0 font-medium text-ink">
                          {PHASE_LABEL[p.id] ?? p.id}
                        </span>
                        <div className="flex-1 h-2 rounded-full bg-rule-light overflow-hidden">
                          <div
                            className="h-full bg-green rounded-full transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-xs text-ink-muted tnum w-16 text-right">
                          {p.loaded}/{p.count}
                        </span>
                        <span className="text-xs text-ink-faint tnum w-16 text-right">
                          {p.expected_size}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </Card>

            {/* ---- datasets ---- */}
            <Card>
              <div className="p-5">
                <div className="flex items-baseline justify-between gap-3 mb-1">
                  <h2 className="text-sm font-semibold text-ink uppercase tracking-wide">
                    Datasets
                  </h2>
                  <button
                    type="button"
                    onClick={() => setShowAll((v) => !v)}
                    className="text-xs text-green hover:text-green-dark bg-transparent border-0 cursor-pointer"
                  >
                    {showAll ? 'show missing only' : `show all ${data.datasets.length}`}
                  </button>
                </div>
                <p className="text-xs text-ink-faint mb-4">
                  Declared in <code className="font-mono">core/backend/sources.py</code> —
                  the same registry the build runs from, so this list cannot drift from what
                  is actually ingested.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-ink-muted border-b border-rule">
                        <th className="py-2 pr-3 font-medium">Dataset</th>
                        <th className="py-2 pr-3 font-medium">From</th>
                        <th className="py-2 pr-3 font-medium">Writes</th>
                        <th className="py-2 pr-3 font-medium">State</th>
                        <th className="py-2 pr-3 font-medium text-right">Rows</th>
                        <th className="py-2 pr-3 font-medium text-right">Size</th>
                        <th className="py-2 font-medium text-right">Expected</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-rule-light">
                      {data.datasets
                        .filter((d) => showAll || d.state === 'missing')
                        .map((d) => (
                          <tr key={d.key}>
                            <td className="py-2 pr-3">
                              <span className="flex items-center gap-2">
                                <Dot state={d.state} />
                                <span className="text-ink">{d.label}</span>
                              </span>
                            </td>
                            <td className="py-2 pr-3">
                              {d.source.url ? (
                                <a
                                  href={d.source.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-ink-light hover:text-green no-underline"
                                  title={`${d.endpoint} · ${d.source.licence}`}
                                >
                                  {d.source.short}
                                </a>
                              ) : (
                                <span className="text-ink-faint">{d.source.short}</span>
                              )}
                            </td>
                            <td className="py-2 pr-3 font-mono text-[0.8em] text-ink-faint">
                              {d.tables.map((t) => t.name).join(', ') || '—'}
                            </td>
                            <td className="py-2 pr-3">
                              <span
                                title={STATE_META[d.state].title}
                                className={
                                  d.state === 'loaded' ? 'text-pos text-xs'
                                  : d.state === 'missing' ? 'text-neg text-xs'
                                  : 'text-ink-muted text-xs'
                                }
                              >
                                {STATE_META[d.state].label}
                              </span>
                            </td>
                            <td className="py-2 pr-3 text-right tnum text-ink-light">
                              {d.rows ? d.rows.toLocaleString() : '—'}
                            </td>
                            <td className="py-2 pr-3 text-right tnum text-ink-light">
                              {d.size}
                            </td>
                            <td className="py-2 text-right tnum text-ink-muted">
                              {d.expected_size}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                {!showAll && data.summary.missing === 0 && (
                  <p className="text-sm text-ink-muted mt-3">
                    Nothing missing — every dataset with a table to check is loaded.
                    {data.datasets.some((d) => d.state === 'unknown') && (
                      <>
                        {' '}
                        {data.datasets.filter((d) => d.state === 'unknown').length} declare
                        no table of their own and can&apos;t be measured either way; use
                        &ldquo;show all&rdquo; to see them.
                      </>
                    )}
                  </p>
                )}
                <p className="text-xs text-ink-faint mt-4">
                  Row counts are Postgres estimates (<code className="font-mono">reltuples</code>),
                  not exact counts — an exact count on a 45M-row table would make this page
                  slow, and it is the page you load when things are already broken.
                </p>
              </div>
            </Card>
          </>
        )}
        <ResetDatabase data={data} />

      </div>
    </div>
  );
}
