'use client';

import { useMemo, useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Spinner } from '@/components/Loading';
import {
  Table,
  TableRow,
  TableCell,
  TableLink,
} from '@/components/Table';
import { tableStyles, cn } from '@/lib/styles';

// ---------------------------------------------------------------------------
// Types — mirror the self-describing JSON written by
// core.backend.queries.experiments.save_experiment (see research/experiments/results/).
// (see core/backend/queries/experiments.py).
// ---------------------------------------------------------------------------

interface ExperimentSummary {
  id: string;
  title: string;
  generated_at: string | null;
  n: number;
}

interface ColumnSpec {
  id: string;
  label: string;
  kind?: string;
}

interface ExperimentSource {
  label?: string;
  url?: string;
}

interface ExperimentMeta {
  id: string;
  title: string;
  hypothesis?: string;
  method?: string;
  score_formula?: string;
  conclusion?: string;
  caveat?: string;
  universe_filter?: string;
  asof?: string;
  generated_at?: string;
  sources?: (ExperimentSource | string)[];
  columns: ColumnSpec[];
  rows: Record<string, unknown>[];
}

async function fetchIndex(): Promise<ExperimentSummary[]> {
  const res = await fetch('/api/experiments', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to load experiments: ${res.status}`);
  const data = (await res.json()) as { experiments?: ExperimentSummary[] };
  return data.experiments ?? [];
}

async function fetchExperiment(id: string): Promise<ExperimentMeta> {
  const res = await fetch(`/api/experiments?id=${encodeURIComponent(id)}`, {
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Failed to load experiment ${id}: ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Value formatting — faithful to _fmt_value in core/frontend/pages/experiments.py.
//   pct   → value × 100, 1dp, "%"
//   cap   → value / 1e9, 2dp, "B"
//   score → 1dp
//   years → 1dp
//   ratio → 2dp
//   int   → thousands-separated integer
// Non-numeric kinds (text/link) are handled separately.
// ---------------------------------------------------------------------------

function isNil(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v));
}

function formatCell(value: unknown, kind?: string): string {
  if (isNil(value)) return '—';
  const v = value as number;
  switch (kind) {
    case 'pct':
      return `${(v * 100).toFixed(1)}%`;
    case 'cap':
      return `${(v / 1e9).toFixed(2)}B`;
    case 'score':
    case 'years':
      return v.toFixed(1);
    case 'ratio':
      return v.toFixed(2);
    case 'int':
      return Math.round(v).toLocaleString('en-US');
    default:
      return String(value);
  }
}

const NUMERIC_KINDS = new Set(['pct', 'cap', 'score', 'years', 'ratio', 'int']);

// ---------------------------------------------------------------------------

function SourcesBlock({ sources }: { sources: ExperimentMeta['sources'] }) {
  if (!sources || sources.length === 0) return null;
  return (
    <div className="mt-3">
      <span className="text-xs font-semibold text-ink">Sources: </span>
      <ul className="list-disc pl-5 mt-1 space-y-0.5 text-xs">
        {sources.map((s, i) => {
          const url = typeof s === 'string' ? s : s.url;
          const label = typeof s === 'string' ? s : s.label ?? s.url;
          return (
            <li key={i}>
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="text-green hover:text-green-dark break-words"
              >
                {label}
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <p className="text-sm text-ink mb-2 leading-relaxed">
      <strong className="font-semibold text-ink">{label}: </strong>
      {value}
    </p>
  );
}

function DesignBlock({ meta }: { meta: ExperimentMeta }) {
  const foot = [
    meta.asof ? `as-of ${meta.asof}` : null,
    meta.generated_at ? `generated ${meta.generated_at.slice(0, 10)}` : null,
    `${meta.rows?.length ?? 0} names`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div>
      {meta.conclusion && (
        <div className="mb-4 rounded-lg border border-green/30 bg-green-soft px-3 py-2 text-sm text-green-text">
          <strong className="font-semibold">Conclusion: </strong>
          {meta.conclusion}
        </div>
      )}
      <Field label="Question" value={meta.hypothesis} />
      <Field label="Method" value={meta.method} />
      {meta.universe_filter && <Field label="Universe" value={meta.universe_filter} />}
      {meta.score_formula && (
        <p className="text-sm text-ink mb-2">
          <strong className="font-semibold text-ink">Score: </strong>
          <code className="px-1 py-0.5 rounded bg-surface text-[0.85em] font-mono text-ink">
            {meta.score_formula}
          </code>
        </p>
      )}
      {meta.caveat && (
        <div className="mt-3 rounded-lg border border-yellow-300 bg-yellow-50 px-3 py-2 text-xs text-yellow-800">
          {meta.caveat}
        </div>
      )}
      <SourcesBlock sources={meta.sources} />
      <div className="text-xs text-ink-muted mt-3">{foot}</div>
    </div>
  );
}

function ResultsTable({ meta }: { meta: ExperimentMeta }) {
  const cols = meta.columns ?? [];
  const rows = meta.rows ?? [];
  // Only columns present in the data, mirroring the Dash filter.
  const present = useMemo(() => {
    if (rows.length === 0) return cols;
    const keys = new Set(Object.keys(rows[0]));
    return cols.filter((c) => keys.has(c.id));
  }, [cols, rows]);

  if (rows.length === 0) {
    return <div className="text-sm text-ink-muted">No rows.</div>;
  }

  return (
    <Table>
      <thead>
        <tr>
          {present.map((c) => {
            const numeric = NUMERIC_KINDS.has(c.kind ?? 'text');
            return (
              <th
                key={c.id}
                className={numeric ? tableStyles.thNum : tableStyles.th}
              >
                {c.label}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, ri) => (
          <TableRow key={ri}>
            {present.map((c) => {
              const kind = c.kind ?? 'text';
              const raw = row[c.id];
              if (kind === 'link') {
                const permaticker = row['permaticker'];
                const ticker = raw == null ? '—' : String(raw);
                if (permaticker != null && permaticker !== '') {
                  return (
                    <TableCell key={c.id}>
                      <TableLink href={`/company/${Math.trunc(Number(permaticker))}`}>
                        {ticker}
                      </TableLink>
                    </TableCell>
                  );
                }
                return (
                  <TableCell key={c.id} className="font-semibold text-ink">
                    {ticker}
                  </TableCell>
                );
              }
              if (kind === 'text') {
                return (
                  <TableCell key={c.id}>
                    {raw == null ? '—' : String(raw)}
                  </TableCell>
                );
              }
              // Numeric kinds — right-aligned, tabular, monospaced.
              return (
                <td key={c.id} className={cn(tableStyles.tdNum)}>
                  {formatCell(raw, kind)}
                </td>
              );
            })}
          </TableRow>
        ))}
      </tbody>
    </Table>
  );
}

// ---------------------------------------------------------------------------

export function ExperimentsBrowser() {
  const { data: index, isLoading, error } = useQuery({
    queryKey: ['experiments-index'],
    queryFn: fetchIndex,
    staleTime: 60 * 1000,
  });

  const experiments = useMemo(() => index ?? [], [index]);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (!selected && experiments.length > 0) {
      setSelected(experiments[0].id);
    }
  }, [experiments, selected]);

  const {
    data: meta,
    isLoading: metaLoading,
    error: metaError,
  } = useQuery({
    queryKey: ['experiment', selected],
    queryFn: () => fetchExperiment(selected!),
    enabled: !!selected,
    staleTime: 60 * 1000,
  });

  return (
    <div className="max-w-[1200px] mx-auto py-10 px-5 md:py-12 md:px-6">
      <div className="mb-6">
        <h1 className="text-2xl md:text-3xl font-bold text-ink tracking-tight">
          Experiments
        </h1>
        <p className="text-ink-muted mt-1 max-w-3xl">
          Saved research runs — hypothesis, method, and the result table. Tickers link
          through to the company.
        </p>
      </div>

      {/* Picker — newest first, mirrors the Dash dropdown. */}
      <div className="mb-4 max-w-2xl">
        {isLoading ? (
          <div className="flex items-center gap-2 text-ink-muted text-sm">
            <Spinner /> Loading…
          </div>
        ) : experiments.length > 0 ? (
          <select
            value={selected ?? ''}
            onChange={(e) => setSelected(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-rule rounded-lg focus:outline-none focus:ring-2 focus:ring-green focus:border-transparent bg-white"
          >
            {experiments.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      {error && (
        <Card>
          <EmptyState
            iconName="folder"
            title="Could not load experiments"
            description={(error as Error).message}
          />
        </Card>
      )}

      {!error && !isLoading && experiments.length === 0 && (
        <Card>
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
            No experiments saved yet. Backtest a screen to produce one — e.g.{' '}
            <code className="px-1 py-0.5 rounded bg-white/60 font-mono text-[0.9em]">
              python -m core.scripts.screen_portfolio_backtest
            </code>{' '}
            — see <code className="font-mono text-[0.9em]">docs/RESEARCH_WORKFLOW.md</code>.
          </div>
        </Card>
      )}

      {!error && selected && (
        <div className="space-y-6">
          {metaError && (
            <Card>
              <EmptyState
                iconName="folder"
                title="Experiment not found"
                description={(metaError as Error).message}
              />
            </Card>
          )}
          {metaLoading && !meta && (
            <Card>
              <div className="flex items-center gap-2 py-8 text-ink-muted text-sm">
                <Spinner /> Loading…
              </div>
            </Card>
          )}
          {meta && (
            <>
              <Card>
                <h2 className="text-lg font-bold text-ink mb-4">Design</h2>
                <DesignBlock meta={meta} />
              </Card>
              <Card>
                <h2 className="text-lg font-bold text-ink mb-4">Results</h2>
                <ResultsTable meta={meta} />
              </Card>
            </>
          )}
        </div>
      )}
    </div>
  );
}
