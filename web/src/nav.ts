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
];

// Setup is local-only — it can start and stop ingests — so the link appears only where
// the API actually serves it. That is asked at runtime (see useSetupEnabled) rather than
// baked in from NEXT_PUBLIC_SETUP_ENABLED, which duplicated SETUP_ENABLED on the API and
// could disagree with it: a link to a route that 404s, or a working surface with no way in.
export const SETUP_LINK: NavLink = { href: "/setup", label: "Setup" };
