// The app's page links, rendered by src/components/Navbar.tsx.
//
// Hrefs are ABSOLUTE — the navbar compares them against usePathname() for active-state.
import type { NavLink } from "@/components/Navbar";

export const links: NavLink[] = [
  // Flat: every destination is one click, no dropdown. Screener/DD/Macro each own a
  // sub-nav for their second page (Ideas, Commodities), so those don't
  // need a slot here — their URLs say where they live.
  { href: "/screener", label: "Screener" },
  { href: "/sectors", label: "Sectors" },
  { href: "/sp500", label: "S&P 500" },
  { href: "/macro", label: "Macro" },
  // Last: the page you need when another page is failing.
  // Setup is local-only: it can start and stop ingests. Mirrors SETUP_ENABLED on the
  // API — a public build sets neither and the link never renders. The API is the real
  // gate; this only keeps the UI from advertising a route that 404s.
  ...(process.env.NEXT_PUBLIC_SETUP_ENABLED === "true"
    ? [{ href: "/setup", label: "Setup" }]
    : []),
];
