'use client';

import { Fragment, type ReactNode } from 'react';

// A small markdown renderer for research notes and red-team memos — no dependency, and no
// raw HTML: everything becomes React elements, so text an AI wrote into a file can never
// inject markup into the page.
//
// Covers what notes actually use: ATX headings, paragraphs, bullet / numbered lists (one
// level of nesting by indentation), task-list boxes, blockquotes, fenced code, horizontal
// rules, pipe tables, and inline code / bold / italic / strikethrough / links / autolinks.
// Anything it does not recognise is shown as plain text, never dropped.

type Block =
  | { t: 'h'; level: number; text: string }
  | { t: 'p'; text: string }
  | { t: 'code'; lang: string; text: string }
  | { t: 'hr' }
  | { t: 'quote'; lines: string[] }
  | { t: 'list'; ordered: boolean; start: number; items: ListItem[] }
  | { t: 'table'; head: string[]; align: ('left' | 'right' | 'center' | null)[]; rows: string[][] };

interface ListItem {
  text: string;
  checked: boolean | null;
  children: ListItem[];
}

const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  // `\|` is a literal pipe inside a cell; park it while splitting.
  return s.replace(/\\\|/g, '\u0000').split('|').map((c) => c.trim().replace(/\u0000/g, '|'));
}

function isTableSep(line: string): boolean {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line) && line.includes('-');
}

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    const fence = line.match(/^\s*(```|~~~)\s*(\S*)/);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i++; // closing fence (or EOF)
      out.push({ t: 'code', lang: fence[2], text: body.join('\n') });
      continue;
    }

    const h = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) { out.push({ t: 'h', level: h[1].length, text: h[2] }); i++; continue; }

    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push({ t: 'hr' }); i++; continue; }

    if (/^\s*>/.test(line)) {
      const q: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push({ t: 'quote', lines: q });
      continue;
    }

    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]).map((c) =>
        c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : null,
      );
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(splitRow(lines[i++]));
      out.push({ t: 'table', head, align, rows });
      continue;
    }

    const lm = line.match(LIST_RE);
    if (lm) {
      const ordered = /\d/.test(lm[2]);
      const baseIndent = lm[1].length;
      const items: ListItem[] = [];
      while (i < lines.length) {
        const l = lines[i];
        if (!l.trim()) {
          // a blank line ends the list unless the next line continues it
          const next = lines[i + 1];
          if (next && LIST_RE.test(next)) { i++; continue; }
          break;
        }
        const m = l.match(LIST_RE);
        if (m) {
          let text = m[3];
          let checked: boolean | null = null;
          const task = text.match(/^\[([ xX])\]\s+(.*)$/);
          if (task) { checked = task[1] !== ' '; text = task[2]; }
          const item = { text, checked, children: [] };
          if (m[1].length > baseIndent + 1 && items.length) items[items.length - 1].children.push(item);
          else items.push(item);
          i++;
        } else if (/^\s+\S/.test(l) && items.length) {
          // lazy continuation of the previous item
          const last = items[items.length - 1];
          const tgt = last.children.length ? last.children[last.children.length - 1] : last;
          tgt.text += ' ' + l.trim();
          i++;
        } else break;
      }
      out.push({ t: 'list', ordered, start: ordered ? parseInt(lm[2], 10) || 1 : 1, items });
      continue;
    }

    const para: string[] = [];
    while (
      i < lines.length && lines[i].trim() &&
      !/^\s*(```|~~~|#{1,6}\s|>)/.test(lines[i]) && !LIST_RE.test(lines[i]) &&
      !(lines[i].includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1]))
    ) para.push(lines[i++]);
    if (!para.length) { para.push(lines[i++]); }
    out.push({ t: 'p', text: para.join('\n') });
  }
  return out;
}

// ------------------------------------------------------------------------------ inline

const INLINE_RE =
  /(`+)([\s\S]*?[^`])\1(?!`)|\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|(\*\*|__)(?=\S)([\s\S]*?\S)\5|(\*|_)(?=\S)([\s\S]*?\S)\7(?![\w*])|~~(?=\S)([\s\S]*?\S)~~|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])|( {2,}\n|\\\n)/;

function safeHref(href: string): string | null {
  const h = href.trim();
  if (/^(https?:|mailto:|\/|#|\.)/i.test(h)) return h;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(h)) return h; // relative
  return null; // javascript:, data:, …
}

function inline(text: string, key = 'i'): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let n = 0;
  while (rest) {
    const m = rest.match(INLINE_RE);
    if (!m || m.index === undefined) { out.push(rest); break; }
    if (m.index > 0) out.push(rest.slice(0, m.index));
    const k = `${key}-${n++}`;
    if (m[1]) {
      out.push(<code key={k} className="font-mono text-[0.85em] bg-surface rounded px-1 py-0.5">{m[2].trim()}</code>);
    } else if (m[3]) {
      const href = safeHref(m[4]);
      const external = !!href && /^https?:/i.test(href);
      out.push(href ? (
        <a key={k} href={href} className="text-green hover:text-green-dark underline-offset-2"
           {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}>
          {inline(m[3], k)}
        </a>
      ) : <span key={k}>{m[3]}</span>);
    } else if (m[5]) {
      out.push(<strong key={k} className="font-semibold">{inline(m[6], k)}</strong>);
    } else if (m[7]) {
      out.push(<em key={k}>{inline(m[8], k)}</em>);
    } else if (m[9]) {
      out.push(<del key={k}>{inline(m[9], k)}</del>);
    } else if (m[10]) {
      out.push(
        <a key={k} href={m[10]} target="_blank" rel="noreferrer" className="text-green hover:text-green-dark break-all">
          {m[10]}
        </a>,
      );
    } else if (m[11]) {
      out.push(<br key={k} />);
    }
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

// ------------------------------------------------------------------------------ render

const H_CLASS = [
  '',
  'text-xl font-bold text-ink mt-6 mb-3 first:mt-0',
  'text-lg font-bold text-ink mt-6 mb-2 first:mt-0',
  'text-base font-semibold text-ink mt-5 mb-2 first:mt-0',
  'text-sm font-semibold text-ink mt-4 mb-1.5 first:mt-0',
  'text-sm font-semibold text-ink-light mt-3 mb-1 first:mt-0',
  'text-xs font-semibold uppercase tracking-wide text-ink-faint mt-3 mb-1 first:mt-0',
];

function List({ items, ordered, start, k }: { items: ListItem[]; ordered: boolean; start?: number; k: string }) {
  const Tag = ordered ? 'ol' : 'ul';
  const anyTask = items.some((it) => it.checked !== null);
  return (
    <Tag start={start} className={`${anyTask ? 'list-none pl-1' : ordered ? 'list-decimal pl-5' : 'list-disc pl-5'} space-y-1 my-2`}>
      {items.map((it, j) => (
        <li key={j} className="leading-relaxed">
          {it.checked !== null && (
            <input type="checkbox" checked={it.checked} readOnly className="mr-2 align-middle" />
          )}
          {inline(it.text, `${k}-${j}`)}
          {it.children.length > 0 && <List items={it.children} ordered={false} k={`${k}-${j}c`} />}
        </li>
      ))}
    </Tag>
  );
}

export function Markdown({ text, className = '' }: { text: string | null | undefined; className?: string }) {
  if (!text || !text.trim()) return null;
  const blocks = parseBlocks(text);
  return (
    <div className={`text-sm text-ink leading-relaxed break-words ${className}`}>
      {blocks.map((b, i) => {
        const k = `b${i}`;
        switch (b.t) {
          case 'h': {
            const Tag = `h${Math.min(b.level + 1, 6)}` as 'h2';
            return <Tag key={k} className={H_CLASS[b.level]}>{inline(b.text, k)}</Tag>;
          }
          case 'p':
            return <p key={k} className="my-2 first:mt-0 last:mb-0 whitespace-pre-line">{inline(b.text, k)}</p>;
          case 'code':
            return (
              <pre key={k} className="my-3 bg-surface border border-rule-light rounded-lg px-3 py-2 overflow-x-auto text-xs font-mono text-ink">
                <code>{b.text}</code>
              </pre>
            );
          case 'hr':
            return <hr key={k} className="my-4 border-0 border-t border-rule" />;
          case 'quote':
            return (
              <blockquote key={k} className="my-3 border-l-2 border-rule pl-3 text-ink-light">
                <Markdown text={b.lines.join('\n')} />
              </blockquote>
            );
          case 'list':
            return <List key={k} items={b.items} ordered={b.ordered} start={b.start} k={k} />;
          case 'table':
            return (
              <div key={k} className="my-3 overflow-x-auto">
                <table className="border-collapse text-[13px]">
                  <thead>
                    <tr>
                      {b.head.map((c, j) => (
                        <th key={j} style={{ textAlign: b.align[j] ?? 'left' }}
                            className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-ink-muted border-b-2 border-rule">
                          {inline(c, `${k}h${j}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r, ri) => (
                      <tr key={ri} className="odd:bg-surface-warm">
                        {b.head.map((_, j) => (
                          <td key={j} style={{ textAlign: b.align[j] ?? 'left' }}
                              className="px-3 py-1.5 border-b border-rule-light align-top">
                            {inline(r[j] ?? '', `${k}r${ri}c${j}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          default:
            return <Fragment key={k} />;
        }
      })}
    </div>
  );
}
