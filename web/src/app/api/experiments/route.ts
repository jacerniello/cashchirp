import { promises as fs } from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Mirror of core/backend/queries/experiments.py: the Experiments page reads the
// self-describing JSON result files in research/experiments/results/, each carrying its
// own design notes (hypothesis, method, score formula, conclusion, caveat, sources) plus
// the ranked result table (columns + rows).
// Next runs from `web/`, so process.cwd() is `web/` and `..` is the repo root — the
// results are at `research/experiments/results/`.
const RESULTS_DIR = path.join(process.cwd(), '..', 'research', 'experiments', 'results');

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

// Python's json.dumps emits bare `NaN`/`Infinity` literals (valid Python JSON, which the
// Dash app reads fine), but JSON.parse rejects them. These stand for missing values, so
// rewrite them to null — only where they appear as a JSON value (after `:`/`[`/`,`), never
// inside a string. This keeps the web reader's coverage identical to Dash's.
function sanitizeNonFinite(raw: string): string {
  // Lookbehind for the opening delimiter / lookahead for the closing one so adjacent
  // tokens (e.g. `NaN, NaN`) are each replaced without consuming the shared comma.
  return raw.replace(/(?<=[:[,]\s*)(-?Infinity|NaN)(?=\s*[,\]}])/g, 'null');
}

async function readMeta(file: string): Promise<ExperimentMeta | null> {
  try {
    const raw = await fs.readFile(path.join(RESULTS_DIR, file), 'utf-8');
    try {
      return JSON.parse(raw) as ExperimentMeta;
    } catch {
      return JSON.parse(sanitizeNonFinite(raw)) as ExperimentMeta;
    }
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');

  try {
    // Single experiment: return the full self-describing payload.
    if (id) {
      // Guard against path traversal — ids are plain file stems.
      if (!/^[\w.-]+$/.test(id)) {
        return NextResponse.json({ error: 'invalid id' }, { status: 400 });
      }
      const meta = await readMeta(`${id}.json`);
      if (!meta) {
        return NextResponse.json(
          { error: `Experiment ${id} not found.` },
          { status: 404 }
        );
      }
      return NextResponse.json(meta);
    }

    // Index: lightweight list (id, title, generated_at, n), newest first.
    const entries = await fs.readdir(RESULTS_DIR, { withFileTypes: true });
    const jsonFiles = entries
      .filter((e) => e.isFile() && e.name.endsWith('.json'))
      .map((e) => e.name)
      .sort();

    const metas = await Promise.all(jsonFiles.map(readMeta));
    const experiments: ExperimentSummary[] = metas
      .filter((m): m is ExperimentMeta => m !== null)
      .map((m) => ({
        id: m.id,
        title: m.title,
        generated_at: m.generated_at ?? null,
        n: Array.isArray(m.rows) ? m.rows.length : 0,
      }))
      .sort((a, b) =>
        (b.generated_at ?? '').localeCompare(a.generated_at ?? '')
      );

    return NextResponse.json({ experiments });
  } catch (err) {
    return NextResponse.json(
      { experiments: [], error: (err as Error).message },
      { status: 200 }
    );
  }
}
