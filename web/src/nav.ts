// The app's page links, rendered by src/components/Navbar.tsx.
//
// Hrefs are ABSOLUTE — the navbar compares them against usePathname() for active-state.
import type { NavLink } from "@/components/Navbar";

export const links: NavLink[] = [
  // Flat: every destination is one click, no dropdown. Screener/DD/Macro each own a
  // sub-nav for their second page (Ideas, Experiments, Commodities), so those don't
  // need a slot here — their URLs say where they live.
  { href: "/screener", label: "Screener" },
  { href: "/dd", label: "DD" },
  { href: "/sectors", label: "Sectors" },
  { href: "/sp500", label: "S&P 500" },
  { href: "/macro", label: "Macro" },
  // Last: the page you need when another page is failing.
  { href: "/setup", label: "Setup" },
];
