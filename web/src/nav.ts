// The app's page links, rendered by src/components/Navbar.tsx.
//
// Hrefs are ABSOLUTE — the navbar compares them against usePathname() for active-state.
import type { NavLink } from "@/components/Navbar";

export const links: NavLink[] = [
  // Screener owns Ideas via an area sub-nav (see AreaSubNav.tsx) — Ideas is the
  // saved screen this grid feeds, not a separate destination.
  { href: "/screener", label: "Screener" },
  { href: "/dd", label: "DD" },
  // Lower-traffic pages tucked behind an "Other" ▾ dropdown so the row stays short.
  // Commodities and Experiments are NOT here — they live under their area's sub-nav and
  // their URLs say so (/macro/commodities, /dd/experiments).
  {
    label: "Other",
    children: [
      { href: "/sectors", label: "Sectors" },
      { href: "/sp500", label: "S&P 500" },
      { href: "/macro", label: "Macro" },
    ],
  },
  // Last, and deliberately top-level rather than inside "Other": it is the page you need
  // when another page is failing, and a link you have to open a dropdown to find is one
  // you won't think of at that moment.
  { href: "/setup", label: "Setup" },
];
