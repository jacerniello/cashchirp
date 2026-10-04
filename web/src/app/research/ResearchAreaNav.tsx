'use client';

import { SubNav, type SubNavItem } from '@/components/nav/SubNav';

// Research area: what you have researched (rankings), how you have grouped it, the
// screener results you froze to work through, and free-form notes.
const ITEMS: SubNavItem[] = [
  { name: 'Rankings', key: 'research', url: '/research' },
  { name: 'Groups', key: 'groups', url: '/research/groups' },
  { name: 'Snapshots', key: 'snapshots', url: '/research/snapshots' },
  { name: 'Notes', key: 'notes', url: '/research/notes' },
];

export function ResearchAreaNav() {
  return <SubNav items={ITEMS} baseUrl="/research" variant="tools" homeKey="research" />;
}
