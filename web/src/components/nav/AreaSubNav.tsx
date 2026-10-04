'use client';

import { SubNav, type SubNavItem } from './SubNav';

// Sub-navs that group related top-level pages under one banner.
//
//  - Screener area: Filter (the grid) + Saved screens (the filters you kept — settings
//                   only) + Snapshots (results you froze to research). All three are the
//                   screener's output at different levels of permanence, so they sit together.
//  - Macro area: Macro + Commodities (Commodities was a top-level item, now a tab here).
//
// URLs mirror the grouping (/screener/ideas, /screener/snapshots, /macro/commodities).
// Saved screens keeps its old /screener/ideas URL so existing links still work.
//
// Rendered at the top of each member page so the toggle is visible from any of them.
const SCREENER_ITEMS: SubNavItem[] = [
  { name: 'Filter', key: 'screener', url: '/screener' },
  { name: 'Saved screens', key: 'ideas', url: '/screener/ideas' },
  { name: 'Snapshots', key: 'snapshots', url: '/screener/snapshots' },
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

