'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { ratingMeta } from '@/components/dd/types';
import { ratingScore, toNum, type GroupRef, type Rating } from '@/hooks/useResearch';

// Small pieces every research page shares: the rating pill, doc indicators, group chips,
// copyable Claude instructions, the page header and the explicit error panel.

export const inputCls =
  'text-sm border border-rule rounded-lg px-3 py-1.5 text-ink bg-white focus:outline-none focus:border-green';
export const btnPrimary =
  'text-sm rounded-lg bg-green text-white px-3.5 py-1.5 border-0 cursor-pointer hover:bg-green-dark ' +
  'disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap';
export const btnGhost =
  'text-sm rounded-lg bg-white text-ink-light px-3 py-1.5 border border-rule cursor-pointer ' +
  'hover:text-ink hover:border-ink-muted disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap';
export const btnDanger =
  'text-sm rounded-lg bg-white text-neg px-3 py-1.5 border border-rule cursor-pointer hover:border-neg ' +
  'disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap';

/** Date (or datetime) to `YYYY-MM-DD HH:MM`, local-free and stable; '—' when absent. */
export function fmtWhen(s: string | null | undefined, withTime = false): string {
  if (!s) return '—';
  const t = String(s).replace('T', ' ');
  return withTime ? t.slice(0, 16) : t.slice(0, 10);
}

/** A decimal fraction (0.12) as a signed percent (+12%). */
export function fmtSignedPct(v: unknown, digits = 0): string {
  const n = toNum(v);
  if (n == null) return '—';
  return `${n >= 0 ? '+' : ''}${(n * 100).toFixed(digits)}%`;
}

export function RatingPill({
  rating,
  showLabel = true,
  size = 'md',
}: {
  rating: Rating | null | undefined;
  showLabel?: boolean;
  size?: 'sm' | 'md' | 'lg';
}) {
  const score = ratingScore(rating);
  if (score == null) return <span className="text-xs text-ink-muted">—</span>;
  const meta = ratingMeta(score);
  const dims =
    size === 'lg' ? 'text-2xl w-12 h-12' : size === 'sm' ? 'text-xs w-6 h-6' : 'text-base w-8 h-8';
  return (
    <span className="inline-flex items-center gap-2" title={rating?.one_liner ?? undefined}>
      <span className={`inline-flex items-center justify-center rounded-lg font-bold shrink-0 ${meta.badge} ${dims}`}>
        {Number.isInteger(score) ? score : score.toFixed(1)}
      </span>
      {showLabel && (
        <span className="text-xs font-semibold text-ink-light whitespace-nowrap">
          {rating?.label || meta.label}
        </span>
      )}
    </span>
  );
}

function Dot({ on, label, title }: { on?: boolean; label: string; title: string }) {
  return (
    <span
      title={on ? title : `No ${title.toLowerCase()}`}
      className={`inline-flex items-center justify-center rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide ${
        on ? 'bg-green-soft text-green-text' : 'bg-surface text-ink-muted/60'
      }`}
    >
      {label}
    </span>
  );
}

export function DocIndicators({
  notes,
  dd,
  redteam,
  ddError,
}: {
  notes?: boolean;
  dd?: boolean;
  redteam?: boolean;
  ddError?: string | null;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <Dot on={notes} label="N" title="Notes" />
      {ddError ? (
        <span title={`dd.json is unreadable: ${ddError}`}
              className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold bg-red-soft text-red">
          DD!
        </span>
      ) : (
        <Dot on={dd} label="DD" title="DD report" />
      )}
      <Dot on={redteam} label="RT" title="Red team" />
    </span>
  );
}

export function GroupChips({ groups, max = 4 }: { groups?: GroupRef[] | null; max?: number }) {
  const g = groups ?? [];
  if (!g.length) return <span className="text-xs text-ink-muted">—</span>;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {g.slice(0, max).map((x) => (
        <Link
          key={x.id}
          href={`/research/groups/${encodeURIComponent(x.id)}`}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center rounded-md bg-surface px-1.5 py-0.5 text-[11px] font-medium text-ink-light no-underline hover:bg-green-soft hover:text-green-text"
        >
          {x.name}
        </Link>
      ))}
      {g.length > max && <span className="text-[11px] text-ink-muted">+{g.length - max}</span>}
    </span>
  );
}

export function AddedByBadge({ by }: { by?: string }) {
  const ai = (by ?? '').toLowerCase() === 'ai';
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
      ai ? 'bg-purple-100 text-purple-700' : 'bg-surface text-ink-faint'
    }`}>
      {ai ? 'AI' : by || 'human'}
    </span>
  );
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle');
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState('ok');
    } catch {
      setState('fail');
    }
    setTimeout(() => setState('idle'), 1500);
  }
  return (
    <button type="button" onClick={copy}
            className="text-xs rounded-md border border-rule bg-white px-2 py-1 text-ink-light cursor-pointer hover:text-ink shrink-0">
      {state === 'ok' ? 'Copied' : state === 'fail' ? 'Select & copy' : label}
    </button>
  );
}

/** A block of text to paste into a terminal or a Claude session, with a copy button. */
export function CopyBlock({ text, className = '' }: { text: string; className?: string }) {
  return (
    <div className={`flex items-start gap-2 rounded-lg bg-surface border border-rule-light px-3 py-2 ${className}`}>
      <pre className="flex-1 m-0 text-xs font-mono text-ink whitespace-pre-wrap break-words">{text}</pre>
      <CopyButton text={text} />
    </div>
  );
}

/** "Point Claude at this" — where the research folder is, and what to ask. */
export function ClaudeInstruction({
  root,
  instruction,
  title = 'Ask Claude',
  blurb,
}: {
  root?: string | null;
  instruction: string;
  title?: string;
  blurb?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-rule bg-white p-4 space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{title}</div>
      {blurb && <p className="text-xs text-ink-light m-0">{blurb}</p>}
      {root ? (
        <CopyBlock text={`cd ${root} && claude`} />
      ) : (
        <p className="text-xs text-ink-muted m-0">
          Research folder path unavailable — open a terminal in the server&apos;s research folder.
        </p>
      )}
      <CopyBlock text={instruction} />
    </div>
  );
}

export function PageHeader({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="py-10 px-8 max-md:px-4 pb-8 text-center border-b border-rule">
      <h1 className="font-sans text-[2rem] font-bold tracking-tight text-ink mb-2">{title}</h1>
      {children && <div className="text-base text-ink-light max-w-2xl mx-auto">{children}</div>}
    </div>
  );
}

/** The failure state every research page shows instead of a spinner that never ends. */
export function ErrorPanel({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-rule bg-white p-6 text-sm text-ink-light">
      <p className="font-semibold text-ink m-0 mb-1">{title}</p>
      {children ?? (
        <p className="m-0">The research API did not answer. Check that the backend is running.</p>
      )}
    </div>
  );
}

export function InlineError({ children }: { children: ReactNode }) {
  return <p className="text-xs text-neg bg-neg-soft rounded-lg px-3 py-2 m-0">{children}</p>;
}

export function SectionCard({
  title,
  actions,
  children,
  className = '',
}: {
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-rule bg-white overflow-hidden ${className}`}>
      <div className="px-5 py-3 border-b border-rule flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-sm font-semibold text-ink uppercase tracking-wide m-0">{title}</h2>
        {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
