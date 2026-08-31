import { promises as fs } from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// The DD pages read the self-describing JSON reports in research/dd/, each carrying its
// full due-diligence write-up (rating, checklist, scenarios, catalysts) plus the data
// series that drive its charts. See research/dd/README.md for the contract. Mirrors the
// experiments route.
// Next runs from `web/`, so process.cwd() is `web/` and `..` is the repo root — the
// reports are at `research/dd/`.
const DD_DIR = path.join(process.cwd(), '..', 'research', 'dd');

interface DDSource {
  label?: string;
  url?: string;
}

interface DDRating {
  score: number;
  label?: string;
  confidence?: string;
  one_liner?: string;
}

interface DDPrice {
  current?: number;
  currency?: string;
  market_cap?: number;
  fair_value_bear?: number;
  fair_value_base?: number;
  fair_value_bull?: number;
  upside_base_pct?: number;
}

interface DDReport {
  id: string;
  ticker: string;
  permaticker?: number | null;
  company: string;
  sector?: string;
  industry?: string;
  group?: number;
  tier?: string;
  asof?: string;
  generated_at?: string;
  rating: DDRating;
  price?: DDPrice;
  tldr?: string;
  bull_case?: string;
  bear_case?: string;
  verdict?: string;
  thesis_points?: unknown[];
  checklist?: unknown[];
  expectations?: unknown;
  analyst_estimates?: unknown;
  scenarios?: unknown[];
  catalysts?: unknown[];
  charts?: unknown[];
  risks?: string[];
  sources?: DDSource[];
  data_gaps?: string[];
}

interface DDSummary {
  id: string;
  ticker: string;
  company: string;
  sector?: string;
  industry?: string;
  group?: number;
  tier?: string;
  score: number;
  label?: string;
  confidence?: string;
  one_liner?: string;
  upside_base_pct?: number | null;
  generated_at?: string | null;
}

// Python's json.dumps can emit bare NaN/Infinity (valid Python JSON); JSON.parse rejects
// them. They mean "missing", so rewrite to null where they appear as a value. (Same guard
// the experiments route uses.)
function sanitizeNonFinite(raw: string): string {
  return raw.replace(/(?<=[:[,]\s*)(-?Infinity|NaN)(?=\s*[,\]}])/g, 'null');
}

async function readReport(file: string): Promise<DDReport | null> {
  try {
    const raw = await fs.readFile(path.join(DD_DIR, file), 'utf-8');
    try {
      return JSON.parse(raw) as DDReport;
    } catch {
      return JSON.parse(sanitizeNonFinite(raw)) as DDReport;
    }
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');

  try {
    // Single report: return the full payload.
    if (id) {
      if (!/^[\w.-]+$/.test(id)) {
        return NextResponse.json({ error: 'invalid id' }, { status: 400 });
      }
      const report = await readReport(`${id}.json`);
      if (!report) {
        return NextResponse.json({ error: `DD ${id} not found.` }, { status: 404 });
      }
      return NextResponse.json(report);
    }

    // Index: lightweight summaries, best rating first. Skip _-prefixed files (templates).
    const entries = await fs.readdir(DD_DIR, { withFileTypes: true });
    const jsonFiles = entries
      .filter((e) => e.isFile() && e.name.endsWith('.json') && !e.name.startsWith('_'))
      .map((e) => e.name)
      .sort();

    const reports = await Promise.all(jsonFiles.map(readReport));
    const dd: DDSummary[] = reports
      .filter((r): r is DDReport => r !== null)
      .map((r) => ({
        id: r.id,
        ticker: r.ticker,
        company: r.company,
        sector: r.sector,
        industry: r.industry,
        group: r.group,
        tier: r.tier,
        score: r.rating?.score ?? 0,
        label: r.rating?.label,
        confidence: r.rating?.confidence,
        one_liner: r.rating?.one_liner,
        upside_base_pct: r.price?.upside_base_pct ?? null,
        generated_at: r.generated_at ?? null,
      }))
      // Highest conviction first; ties broken by base-case upside.
      .sort(
        (a, b) =>
          b.score - a.score ||
          (b.upside_base_pct ?? -Infinity) - (a.upside_base_pct ?? -Infinity)
      );

    return NextResponse.json({ dd });
  } catch (err) {
    return NextResponse.json({ dd: [], error: (err as Error).message }, { status: 200 });
  }
}
