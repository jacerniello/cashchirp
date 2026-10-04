'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';

// Research — notes, reports (dated DD + red-team runs), groups and snapshots, stored as plain files on the server
// (core/backend/research/store.py) and served by core/api/routers/research/research.py.
//
// An AI agent edits the same folder directly, so every shape below is a best guess at
// what a hand- or AI-edited file contains: fields are optional and pages must cope with
// anything missing. Stocks are keyed by permaticker (a digit string), never ticker.
//
// Every query uses `retry: false` — a missing research folder or a down backend must say
// so, not spin. Every mutation invalidates the whole ['research'] tree: stocks, groups and
// snapshots cross-reference each other, so a narrower invalidation would leave stale chips.

export interface Rating {
  score?: number | string | null;
  label?: string | null;
  confidence?: string | null;
  one_liner?: string | null;
  upside_base_pct?: number | string | null;
  asof?: string | null;
}

export interface GroupRef {
  id: string;
  name: string;
}

export interface ReportRef {
  id: string;
  name?: string | null;
  created_at?: string | null;
}

/** One row of the rankings: a stock's LATEST analysis across all reports. */
export interface ResearchStock {
  permaticker: string;
  ticker?: string | null;
  name?: string | null;
  has_notes?: boolean;
  has_dd?: boolean;
  dd_error?: string | null;
  has_redteam?: boolean;
  rating?: Rating | null;
  asof?: string | null;
  report?: ReportRef | null;
  previous?: {
    rating?: Rating | null;
    asof?: string | null;
    report_id?: string;
    report_name?: string | null;
    created_at?: string | null;
  } | null;
  analyses?: number;
  price_at_analysis?: number | null;
  price_now?: number | null;
  price_date?: string | null;
  groups?: GroupRef[];
  updated_at?: string | null;
}

export interface ResearchIndex {
  root: string;
  stocks: ResearchStock[];
  prices_error?: string | null;
  reports?: number;
  groups: number;
  snapshots: number;
  notes: number;
}

export interface ResearchGuide {
  root: string;
  guide: string;
}

export interface StockAnalysis {
  report_id: string;
  report_name?: string | null;
  created_at?: string | null;
  asof?: string | null;
  rating?: Rating | null;
  has_dd?: boolean;
  dd_error?: string | null;
  has_redteam?: boolean;
  price_at_analysis?: number | null;
}

export interface StockDetail {
  permaticker: string;
  meta: { ticker?: string; name?: string; [k: string]: unknown } | null;
  notes: string | null;
  notes_updated: string | null;
  /** The latest analysis's DD and red team (from report `latest`). */
  dd: Record<string, unknown> | null;
  dd_error: string | null;
  dd_updated: string | null;
  redteam: string | null;
  redteam_updated: string | null;
  latest?: { report_id: string; report_name?: string | null; created_at?: string | null; asof?: string | null } | null;
  /** Every analysis of this stock, newest first. */
  analyses?: StockAnalysis[];
  /** Reports the stock is in that have no analysis of it yet. */
  pending_reports?: ReportRef[];
  groups: GroupRef[];
  snapshots: { id: string; name: string; created_at?: string | null }[];
}

/** A stock's own folder holds only living notes; DD and red team belong to reports. */
export type StockDoc = 'notes';
export type ReportDoc = 'dd' | 'redteam';

export type ReportSource =
  | { kind: 'snapshot'; snapshot_id?: string; snapshot_name?: string; screen_id?: string; screen_title?: string }
  | { kind: 'group'; group_id?: string; group_name?: string }
  | { kind: 'manual' };

export interface ReportAnalysis {
  has_dd?: boolean;
  dd_error?: string | null;
  has_redteam?: boolean;
  rating?: Rating | null;
  asof?: string | null;
  price_at_analysis?: number | null;
  dd_updated?: string | null;
  redteam_updated?: string | null;
}

export interface ReportMember {
  permaticker: string;
  ticker?: string | null;
  name?: string | null;
  added_at?: string;
  added_by?: string;
  /** false when an analysis sits in the report folder without a members entry. */
  listed?: boolean;
  analysis?: ReportAnalysis | null;
  price_now?: number | null;
  price_date?: string | null;
  groups?: GroupRef[];
}

export interface ReportSummary {
  id: string;
  name: string;
  thesis?: string;
  notes?: string;
  created_at?: string;
  created_by?: string;
  updated_at?: string;
  status?: 'open' | 'complete' | string;
  source?: ReportSource;
  member_count?: number;
  analysed_count?: number;
  redteam_count?: number;
  top?: { permaticker: string; ticker?: string | null; rating?: Rating | null }[];
  error?: string;
}

export interface Report extends ReportSummary {
  /** Already in ranking order: score desc, then base upside desc; unanalysed last. */
  members: ReportMember[];
  prices_error?: string | null;
}

export interface GroupMember {
  permaticker: string;
  ticker?: string | null;
  name?: string | null;
  note?: string;
  added_by?: 'human' | 'ai' | string;
  added_at?: string;
  rating?: Rating | null;
}

export interface GroupHistoryEntry {
  at?: string;
  action?: 'create' | 'add' | 'remove' | 'rename' | 'describe' | 'note' | string;
  permaticker?: string;
  ticker?: string | null;
  by?: string;
  note?: string;
}

export interface Group {
  id: string;
  name: string;
  description?: string;
  members: GroupMember[];
  history?: GroupHistoryEntry[];
  created_by?: string;
  created_at?: string;
  updated_at?: string;
  error?: string;
}

export type SnapshotSource =
  | { kind: 'grid'; params?: Record<string, unknown> }
  | { kind: 'screen'; screen_id?: string; title?: string; spec?: unknown };

export interface SnapshotSummary {
  id: string;
  name: string;
  note?: string;
  source?: SnapshotSource;
  asof?: string | null;
  created_at?: string;
  created_by?: string;
  updated_at?: string;
  count?: number;
  removed_count?: number;
  error?: string;
}

export interface MemberResearch {
  rating?: Rating | null;
  has_notes?: boolean;
  has_dd?: boolean;
  has_redteam?: boolean;
  groups?: GroupRef[];
}

export interface SnapshotMember {
  permaticker: string;
  ticker?: string | null;
  name?: string | null;
  sector?: string | null;
  industry?: string | null;
  exchange?: string | null;
  market_cap?: number | null;
  pe?: number | null;
  ps?: number | null;
  pb?: number | null;
  ev_ebitda?: number | null;
  ev_sales?: number | null;
  p_fcf?: number | null;
  roe?: number | null;
  roic?: number | null;
  gross_margin?: number | null;
  op_margin?: number | null;
  net_margin?: number | null;
  revenue_growth?: number | null;
  eps_growth?: number | null;
  sales_g_5y?: number | null;
  debt_equity?: number | null;
  net_cash_pct?: number | null;
  altman_z?: number | null;
  div_yield?: number | null;
  pct_below_high?: number | null;
  removed?: boolean;
  research?: MemberResearch | null;
}

export interface Snapshot extends SnapshotSummary {
  members: SnapshotMember[];
}

export interface NoteEntry {
  path: string;
  updated_at?: string | null;
  bytes?: number;
}

export interface MemberInput {
  permaticker: string;
  ticker?: string | null;
  name?: string | null;
  note?: string;
}

/** The API's `detail` message if there is one — it usually says exactly what is wrong. */
export function errDetail(e: unknown, fallback = 'Request failed.'): string {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (detail) return JSON.stringify(detail);
  return (e as Error)?.message || fallback;
}

/** True when the request failed with HTTP 404 — "not there", which is not "broken". */
export function isNotFound(e: unknown): boolean {
  return (e as { response?: { status?: number } })?.response?.status === 404;
}

/** Hand-edited files can put anything in `score`; only a finite 1..6-ish number counts. */
export function ratingScore(r: Rating | null | undefined): number | null {
  if (!r || r.score == null || r.score === '') return null;
  const n = Number(r.score);
  return Number.isFinite(n) ? n : null;
}

export function toNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

const KEY = ['research'] as const;
const enc = encodeURIComponent;
/** Note paths keep their slashes — the API route is `{path:path}`. */
const encPath = (p: string) => p.split('/').map(enc).join('/');

// ------------------------------------------------------------------------------ reads

export function useResearchIndex() {
  return useQuery({
    queryKey: [...KEY, 'index'],
    queryFn: async (): Promise<ResearchIndex> => (await api.get('/research/')).data,
    retry: false,
  });
}

export function useResearchGuide() {
  return useQuery({
    queryKey: [...KEY, 'guide'],
    queryFn: async (): Promise<ResearchGuide> => (await api.get('/research/guide')).data,
    retry: false,
    staleTime: 10 * 60 * 1000,
  });
}

export function useResearchStock(pt: string) {
  return useQuery({
    queryKey: [...KEY, 'stock', pt],
    queryFn: async (): Promise<StockDetail> => (await api.get(`/research/stocks/${enc(pt)}`)).data,
    enabled: !!pt,
    retry: false,
  });
}

export function useGroups() {
  return useQuery({
    queryKey: [...KEY, 'groups'],
    queryFn: async (): Promise<Group[]> => (await api.get('/research/groups')).data?.groups ?? [],
    retry: false,
  });
}

export function useGroup(id: string) {
  return useQuery({
    queryKey: [...KEY, 'group', id],
    queryFn: async (): Promise<Group> => (await api.get(`/research/groups/${enc(id)}`)).data,
    enabled: !!id,
    retry: false,
  });
}

export function useSnapshots() {
  return useQuery({
    queryKey: [...KEY, 'snapshots'],
    queryFn: async (): Promise<SnapshotSummary[]> =>
      (await api.get('/research/snapshots')).data?.snapshots ?? [],
    retry: false,
  });
}

export function useSnapshot(id: string) {
  return useQuery({
    queryKey: [...KEY, 'snapshot', id],
    queryFn: async (): Promise<Snapshot> => (await api.get(`/research/snapshots/${enc(id)}`)).data,
    enabled: !!id,
    retry: false,
  });
}

export function snapshotCsvUrl(id: string): string {
  return `/api/v1/research/snapshots/${enc(id)}/csv`;
}

export function useReports() {
  return useQuery({
    queryKey: [...KEY, 'reports'],
    queryFn: async (): Promise<ReportSummary[]> => (await api.get('/research/reports')).data?.reports ?? [],
    retry: false,
  });
}

export function useReport(id: string) {
  return useQuery({
    queryKey: [...KEY, 'report', id],
    queryFn: async (): Promise<Report> => (await api.get(`/research/reports/${enc(id)}`)).data,
    enabled: !!id,
    retry: false,
  });
}

/** One document of one report — `content` is the DD object or the red-team Markdown. */
export function useReportDoc(id: string, pt: string, doc: ReportDoc) {
  return useQuery({
    queryKey: [...KEY, 'report-doc', id, pt, doc],
    queryFn: async (): Promise<{ content: unknown; error?: string | null }> =>
      (await api.get(`/research/reports/${enc(id)}/stocks/${enc(pt)}/${doc}`)).data,
    enabled: !!id && !!pt,
    retry: false,
  });
}

export function useNotes() {
  return useQuery({
    queryKey: [...KEY, 'notes'],
    queryFn: async (): Promise<NoteEntry[]> => (await api.get('/research/notes')).data?.notes ?? [],
    retry: false,
  });
}

export function useNote(path: string | null) {
  return useQuery({
    queryKey: [...KEY, 'note', path],
    queryFn: async (): Promise<{ path: string; text: string }> =>
      (await api.get(`/research/notes/${encPath(path as string)}`)).data,
    enabled: !!path,
    retry: false,
  });
}

// --------------------------------------------------------------------------- writes

function useResearchMutation<TVars, TResult>(fn: (v: TVars) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useSaveStockDoc(pt: string) {
  return useResearchMutation(
    async (v: { doc: StockDoc; content: unknown; ticker?: string | null; name?: string | null }) =>
      (await api.put(`/research/stocks/${enc(pt)}/${v.doc}`, {
        content: v.content,
        ticker: v.ticker || undefined,
        name: v.name || undefined,
      })).data,
  );
}

export function useDeleteStockDoc(pt: string) {
  return useResearchMutation(
    async (doc: StockDoc) => (await api.delete(`/research/stocks/${enc(pt)}/${doc}`)).data,
  );
}

export function useCreateGroup() {
  return useResearchMutation(
    async (v: { name: string; description?: string }): Promise<Group> =>
      (await api.post('/research/groups', { name: v.name, description: v.description ?? '' })).data,
  );
}

export function usePatchGroup() {
  return useResearchMutation(
    async (v: {
      id: string;
      name?: string;
      description?: string;
      add?: MemberInput[];
      remove?: string[];
    }): Promise<Group> => {
      const { id, ...body } = v;
      const clean = {
        ...body,
        add: (body.add ?? []).map((m) => ({
          permaticker: String(m.permaticker),
          ticker: m.ticker || undefined,
          name: m.name || undefined,
          note: m.note ?? '',
        })),
      };
      return (await api.patch(`/research/groups/${enc(id)}`, clean)).data;
    },
  );
}

export function useDeleteGroup() {
  return useResearchMutation(
    async (id: string) => (await api.delete(`/research/groups/${enc(id)}`)).data,
  );
}

export function useCreateSnapshot() {
  return useResearchMutation(
    async (v: {
      name?: string;
      note?: string;
      params?: Record<string, unknown>;
      screen_id?: string;
    }): Promise<{ id: string; count: number; open: string }> =>
      (await api.post('/research/snapshots', v)).data,
  );
}

export function usePatchSnapshot() {
  return useResearchMutation(
    async (v: {
      id: string;
      name?: string;
      note?: string;
      remove?: string[];
      restore?: string[];
    }): Promise<Snapshot> => {
      const { id, ...body } = v;
      return (await api.patch(`/research/snapshots/${enc(id)}`, body)).data;
    },
  );
}

export function useDeleteSnapshot() {
  return useResearchMutation(
    async (id: string) => (await api.delete(`/research/snapshots/${enc(id)}`)).data,
  );
}

export function useCreateReport() {
  return useResearchMutation(
    async (v: {
      name?: string;
      thesis?: string;
      snapshot_id?: string;
      group_id?: string;
      permatickers?: string[];
      members_from?: 'kept' | 'selected';
      members?: MemberInput[];
    }): Promise<{ id: string; count: number; open: string }> =>
      (await api.post('/research/reports', v)).data,
  );
}

export function usePatchReport() {
  return useResearchMutation(
    async (v: {
      id: string;
      name?: string;
      thesis?: string;
      status?: 'open' | 'complete';
      notes?: string;
      add?: MemberInput[];
      add_from_source?: boolean;
      remove?: string[];
    }): Promise<Report> => {
      const { id, ...body } = v;
      const clean = {
        ...body,
        add: (body.add ?? []).map((m) => ({
          permaticker: String(m.permaticker),
          ticker: m.ticker || undefined,
          name: m.name || undefined,
        })),
      };
      return (await api.patch(`/research/reports/${enc(id)}`, clean)).data;
    },
  );
}

export function useDeleteReport() {
  return useResearchMutation(
    async (id: string) => (await api.delete(`/research/reports/${enc(id)}`)).data,
  );
}

export function useSaveNote() {
  return useResearchMutation(
    async (v: { path: string; text: string }): Promise<{ saved: string }> =>
      (await api.put(`/research/notes/${encPath(v.path)}`, { text: v.text })).data,
  );
}

export function useDeleteNote() {
  return useResearchMutation(
    async (path: string) => (await api.delete(`/research/notes/${encPath(path)}`)).data,
  );
}
