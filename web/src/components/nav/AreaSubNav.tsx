'use client';

import { SubNav, type SubNavItem } from './SubNav';

// Sub-navs that group related top-level pages under one banner.
//
//  - Screener area: Screener + Ideas (Ideas is the saved screen the grid feeds, so it
//                   belongs beside the grid rather than as its own destination).
//  - Macro area: Macro + Commodities (Commodities was a top-level item, now a tab here).
//  - DD area:    DD + Experiments (Experiments was top-level, now a tab here).
//
// Rendered at the top of each member page so the toggle is visible from any of them.
const SCREENER_ITEMS: SubNavItem[] = [
  { name: 'Screener', key: 'filter', url: '/filter' },
  { name: 'Ideas', key: 'ideas', url: '/ideas' },
];

const MACRO_ITEMS: SubNavItem[] = [
  { name: 'Macro', key: 'macro', url: '/macro' },
  { name: 'Commodities', key: 'commodities', url: '/commodities' },
];

const DD_ITEMS: SubNavItem[] = [
  { name: 'DD', key: 'dd', url: '/dd' },
  { name: 'Experiments', key: 'experiments', url: '/experiments' },
];

export function ScreenerAreaNav() {
  return <SubNav items={SCREENER_ITEMS} baseUrl="/filter" variant="tools" homeKey="filter" />;
}

export function MacroAreaNav() {
  return <SubNav items={MACRO_ITEMS} baseUrl="/macro" variant="tools" homeKey="macro" />;
}

export function DDAreaNav() {
  return <SubNav items={DD_ITEMS} baseUrl="/dd" variant="tools" homeKey="dd" />;
}
