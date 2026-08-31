"use client";

// The top navigation bar: the brand, then this app's page links on the right.
//
// Lower-traffic pages fold under a collapsible "Other ▾" group so the row stays short —
// the links themselves are declared in src/investing/nav.ts.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { links } from "@/nav";

/** Render children into document.body once mounted (no-op during SSR / first paint).
 *  The nav row is an `overflow-x-auto` + `-webkit-overflow-scrolling: touch` scroll
 *  container; on iOS Safari that makes it a containing block for `position: fixed`
 *  descendants, so a dropdown rendered inside it gets CLIPPED by the bar's overflow and
 *  never appears ("hidden behind something" on mobile — while desktop/Chromium, which
 *  don't apply the webkit-overflow-scrolling quirk, show it fine). Portaling the menu to
 *  <body> lifts it out of the scroll container so its viewport-fixed coords work
 *  everywhere. */
function BodyPortal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? createPortal(children, document.body) : null;
}

/** A plain page link, or a collapsible group that tucks several links under one label
 *  (e.g. an "Other" ▾ group). Built in nav.ts. */
export type NavLeaf = { href: string; label: string };
export type NavLink = NavLeaf | { label: string; children: NavLeaf[] };

export function Navbar() {
  const pathname = usePathname();
  return (
    <nav className="bg-white border-b border-rule px-8 max-[570px]:px-4 sticky top-0 z-[150]">
      {/* Horizontal swipe when the row is wider than the screen — no chevrons, no buttons,
          just an overflow-scroll. On TOUCH the scrollbar is hidden and you swipe; on a
          HOVER-capable device (desktop) the scrollbar stays hidden until you hover the bar,
          then a thin bottom scrollbar fades in so you can drag it instead of the row itself.
          Every child is shrink-0 so nothing compresses. */}
      <style>{`
        .nav-scroll{-webkit-overflow-scrolling:touch;scrollbar-width:none;-ms-overflow-style:none}
        .nav-scroll::-webkit-scrollbar{height:0}
        @media (hover:hover){
          .nav-scroll:hover{scrollbar-width:thin;scrollbar-color:rgba(0,0,0,.28) transparent}
          .nav-scroll:hover::-webkit-scrollbar{height:8px}
          .nav-scroll:hover::-webkit-scrollbar-thumb{background:rgba(0,0,0,.28);border-radius:4px}
          .nav-scroll:hover::-webkit-scrollbar-thumb:hover{background:rgba(0,0,0,.45)}
          .nav-scroll:hover::-webkit-scrollbar-track{background:transparent}
        }
      `}</style>
      <div className="nav-scroll max-w-[1200px] mx-auto flex items-center h-16 overflow-x-auto">
        {/* Brand: the one logo (public/logo.svg — the same file the tab icon and the chart
            export watermark use) plus the wordmark, linking home. */}
        <Link href="/" className="flex items-center gap-2 no-underline shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element -- a vector mark needs no
              optimising, and next/image refuses SVG without dangerouslyAllowSVG. */}
          <img src="/logo.svg" alt="" width={32} height={25} className="h-6 w-auto" />
          <span className="font-sans text-xl font-bold text-ink tracking-tight">
            cashchirp
          </span>
        </Link>

        <div className="ml-auto flex items-center gap-1 shrink-0">
          {links.map((item) => {
            // A collapsible group ("Other" ▾ …) renders as a dropdown, not a plain link.
            if ("children" in item) {
              return <NavDropdown key={item.label} item={item} pathname={pathname} />;
            }
            const isActive =
              item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`font-sans text-[0.9375rem] font-medium no-underline py-2 px-4 whitespace-nowrap transition-colors duration-150 ${
                  isActive ? "text-green" : "text-ink hover:text-green"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}

/** A collapsible nav group — its label with a ▾ caret that toggles a small menu of the
 *  grouped links, for when the top row would otherwise get too long.
 *
 *  The menu is `position: fixed` on purpose: the nav row is `overflow-x-auto`, which the CSS
 *  spec forces to also clip vertically, so an `absolute` panel would be cut off under the
 *  bar. A fixed panel escapes that clip (its containing block is the viewport), and we
 *  right-anchor it to the trigger via getBoundingClientRect so it hangs under the button no
 *  matter how wide the centered layout is. */
function NavDropdown({
  item,
  pathname,
}: {
  item: { label: string; children: NavLeaf[] };
  pathname: string;
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ right: number; top: number }>({
    right: 0,
    top: 0,
  });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // If you're ON one of the grouped pages, the header lights up — collapsing them under
  // "Other" must not hide that you're there.
  const anyActive = item.children.some((c) => pathname.startsWith(c.href));

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!btnRef.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setCoords({ right: window.innerWidth - r.right, top: r.bottom + 4 });
    setOpen((o) => !o);
  };

  return (
    <div className="shrink-0">
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`font-sans text-[0.9375rem] font-medium no-underline py-2 px-4 whitespace-nowrap transition-colors duration-150 cursor-pointer border-0 bg-transparent ${
          anyActive || open ? "text-green" : "text-ink hover:text-green"
        }`}
      >
        {item.label} <span className="text-[0.7em] align-middle">▾</span>
      </button>
      {open && (
        <BodyPortal>
          <div
            ref={menuRef}
            role="menu"
            style={{ position: "fixed", right: coords.right, top: coords.top }}
            className="z-[200] min-w-[9rem] rounded-md border border-rule bg-white py-1 shadow-lg"
          >
            {item.children.map((c) => {
              const isActive = pathname.startsWith(c.href);
              return (
                <Link
                  key={c.href}
                  href={c.href}
                  onClick={() => setOpen(false)}
                  className={`block font-sans text-[0.9375rem] font-medium no-underline py-2 px-4 whitespace-nowrap transition-colors duration-150 ${
                    isActive ? "text-green" : "text-ink hover:text-green hover:bg-[#F5F5F5]"
                  }`}
                >
                  {c.label}
                </Link>
              );
            })}
          </div>
        </BodyPortal>
      )}
    </div>
  );
}
