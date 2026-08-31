'use client';

import Link from 'next/link';
import type { ScreenerCompany } from '@/hooks/useScreener';
import { tableStyles as t } from '@/lib/styles';
import { formatMarketCap, formatRatio, formatPercent } from '../utils';
import { Pagination } from './shared';

interface LiveResultsProps {
  results: ScreenerCompany[];
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

// Result columns mirror the Dash screener RESULT_COLS
// (core/frontend/pages/screener.py). `hide` controls the responsive breakpoint at
// which a (secondary) column appears, so the dense grid stays readable on narrow
// screens while exposing the full set on wide ones.
function fmtInt(v: number | null): string {
  return v === null || v === undefined ? '-' : Math.round(v).toLocaleString();
}

export function LiveResults({ results, page, totalPages, onPageChange }: LiveResultsProps) {
  return (
    <>
      <div className={t.container}>
        <table className={t.table}>
          <thead>
            <tr>
              <th className={t.th}>Ticker</th>
              <th className={t.th}>Company</th>
              <th className={`${t.thNum}`}>Mkt Cap</th>
              <th className={`${t.thNum} hidden md:table-cell`}>P/E</th>
              <th className={`${t.thNum} hidden lg:table-cell`}>P/S</th>
              <th className={`${t.thNum} hidden md:table-cell`}>P/B</th>
              <th className={`${t.thNum} hidden xl:table-cell`}>EV/EBITDA</th>
              <th className={`${t.thNum} hidden 2xl:table-cell`}>EV/Sales</th>
              <th className={`${t.thNum} hidden lg:table-cell`}>ROE</th>
              <th className={`${t.thNum} hidden xl:table-cell`}>ROIC</th>
              <th className={`${t.thNum} hidden 2xl:table-cell`}>Gross M</th>
              <th className={`${t.thNum} hidden 2xl:table-cell`}>Oper M</th>
              <th className={`${t.thNum} hidden lg:table-cell`}>Net M</th>
              <th className={`${t.thNum} hidden xl:table-cell`}>EPS gr TTM</th>
              <th className={`${t.thNum} hidden 2xl:table-cell`}>Sales gr TTM</th>
              <th className={`${t.thNum} hidden 2xl:table-cell`}>EPS gr 5Y</th>
              <th className={`${t.thNum} hidden md:table-cell`}>D/E</th>
              <th className={`${t.thNum} hidden xl:table-cell`}>Curr R</th>
              <th className={`${t.thNum} hidden lg:table-cell`}>Div Yld</th>
              <th className={`${t.thNum} hidden 2xl:table-cell`}>Net Cash %</th>
              <th className={`${t.thNum} hidden xl:table-cell`}>Z-Score</th>
              <th className={`${t.thNum} hidden 2xl:table-cell`}>Off High</th>
              <th className={`${t.thNum} hidden 2xl:table-cell`}>Age (y)</th>
              <th className={`${t.thNum} hidden lg:table-cell`}>Inst</th>
            </tr>
          </thead>
          <tbody>
            {results.map((company, index) => (
              <CompanyRow
                key={company.permaticker ?? company.cik ?? `${company.ticker}-${index}`}
                company={company}
              />
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page} totalPages={totalPages} onPageChange={onPageChange} />
    </>
  );
}

function CompanyRow({ company }: { company: ScreenerCompany }) {
  const ticker = company.ticker?.toUpperCase() || '-';
  // Re-keyed to permaticker (the stable issuer id). The API returns `permaticker`;
  // `cik` carries the same permaticker string as a fallback.
  const permaticker = company.permaticker ?? company.cik;
  const href = permaticker
    ? `/company/${permaticker}`
    : company.ticker
    ? `/ticker/${encodeURIComponent(company.ticker)}`
    : '#';

  return (
    <tr className={t.row}>
      <td className={t.td}>
        <Link href={href} className="font-semibold text-green hover:text-green-dark">
          {ticker}
        </Link>
      </td>
      <td className={t.td}>
        <Link href={href} className="block text-ink hover:text-green leading-tight">
          <span className="font-medium">{company.name || '-'}</span>
          {company.sector && (
            <span className="block text-[11px] text-ink-muted">{company.sector}</span>
          )}
        </Link>
      </td>
      <td className={`${t.tdNum} !text-ink font-medium`}>{formatMarketCap(company.market_cap)}</td>
      <td className={`${t.tdNum} hidden md:table-cell`}>{formatRatio(company.pe_ratio)}</td>
      <td className={`${t.tdNum} hidden lg:table-cell`}>{formatRatio(company.ps_ratio)}</td>
      <td className={`${t.tdNum} hidden md:table-cell`}>{formatRatio(company.pb_ratio)}</td>
      <td className={`${t.tdNum} hidden xl:table-cell`}>{formatRatio(company.ev_ebitda)}</td>
      <td className={`${t.tdNum} hidden 2xl:table-cell`}>{formatRatio(company.ev_sales)}</td>
      <td className={`${t.tdNum} hidden lg:table-cell`}>{formatPercent(company.roe)}</td>
      <td className={`${t.tdNum} hidden xl:table-cell`}>{formatPercent(company.roic)}</td>
      <td className={`${t.tdNum} hidden 2xl:table-cell`}>{formatPercent(company.gross_margin)}</td>
      <td className={`${t.tdNum} hidden 2xl:table-cell`}>{formatPercent(company.op_margin)}</td>
      <td className={`${t.tdNum} hidden lg:table-cell`}>{formatPercent(company.profit_margin)}</td>
      <td className={`${t.tdNum} hidden xl:table-cell`}>{formatPercent(company.eps_growth)}</td>
      <td className={`${t.tdNum} hidden 2xl:table-cell`}>{formatPercent(company.revenue_growth)}</td>
      <td className={`${t.tdNum} hidden 2xl:table-cell`}>{formatPercent(company.eps_g_5y)}</td>
      <td className={`${t.tdNum} hidden md:table-cell`}>{formatRatio(company.debt_equity)}</td>
      <td className={`${t.tdNum} hidden xl:table-cell`}>{formatRatio(company.current_ratio)}</td>
      <td className={`${t.tdNum} hidden lg:table-cell`}>{formatPercent(company.div_yield)}</td>
      <td className={`${t.tdNum} hidden 2xl:table-cell`}>{formatPercent(company.net_cash_pct)}</td>
      <td className={`${t.tdNum} hidden xl:table-cell`}>{formatRatio(company.altman_z)}</td>
      <td className={`${t.tdNum} hidden 2xl:table-cell`}>{formatPercent(company.pct_below_high)}</td>
      <td className={`${t.tdNum} hidden 2xl:table-cell`}>{formatRatio(company.years_public)}</td>
      <td className={`${t.tdNum} hidden lg:table-cell`}>{fmtInt(company.inst_holders)}</td>
    </tr>
  );
}
