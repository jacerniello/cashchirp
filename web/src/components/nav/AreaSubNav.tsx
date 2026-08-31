'use client';

import { SubNav, type SubNavItem } from './SubNav';

// Sub-navs that group related top-level pages under one banner.
//
//  - Screener area: Screener + Ideas (Ideas is the saved screen the grid feeds, so it
//                   belongs beside the grid rather than as its own destination).
//  - Macro area: Macro + Commodities (Commodities was a top-level item, now a tab here).
//
// URLs mirror the grouping (/screener/ideas, /macro/commodities).
//
// Rendered at the top of each member page so the toggle is visible from any of them.
const SCREENER_ITEMS: SubNavItem[] = [
  { name: 'Screener', key: 'screener', url: '/screener' },
  { name: 'Ideas', key: 'ideas', url: '/screener/ideas' },
];

const MACRO_ITEMS: SubNavItem[] = [
  { name: 'Macro', key: 'macro', url: '/macro' },
  { name: 'Commodities', key: 'commodities', url: '/macro/commodities' },
];


export function ScreenerAreaNav() {
  return <SubNav items={SCREENER_ITEMS} baseUrl="/screener" variant="tools" homeKey="screener" />;
}

export function MacroAreaNav() {
  return <SubNav items={MACRO_ITEMS} baseUrl="/macro" variant="tools" homeKey="macro" />;
}

