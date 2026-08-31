import Link from "next/link";

// The site root. Previously a bare redirect to the screener; now a doorway that says what
// this is before handing you a tool.

export const metadata = {
  title: "Personal Investing Research Tool",
  description:
    "A personal research platform for forming hypotheses about how markets behave, testing them against data, and recording what holds up.",
};

/** The tools, in the order someone new should meet them: find names, form a view, write it
 *  up. Mirrors the navbar (src/investing/nav.ts) — keep the two in step. */
const TOOLS: { href: string; label: string; blurb: string }[] = [
  {
    href: "/filter",
    label: "Screener",
    blurb:
      "Filter the whole US equity universe on fundamentals, valuation and quality. The general-purpose starting point.",
  },
  {
    href: "/ideas",
    label: "Ideas",
    blurb:
      "Your saved screen, run live, annotated with what you think of each name — and which ones you have already rejected.",
  },
  {
    href: "/dd",
    label: "Due diligence",
    blurb:
      "Full write-ups: the checklist, the reverse-DCF, the bear case, and a rating that says what would change it.",
  },
  {
    href: "/sectors",
    label: "Sectors",
    blurb: "Where money is being made across the market, and how that has shifted.",
  },
  {
    href: "/sp500",
    label: "S&P 500",
    blurb:
      "Index concentration and a counterfactual lab: how would the index have done without X?",
  },
  {
    href: "/macro",
    label: "Macro",
    blurb: "FRED rates, inflation and activity panels — the regime everything else sits in.",
  },
  {
    href: "/experiments",
    label: "Experiments",
    blurb:
      "Backtest results, point-in-time and survivorship-free, including the ones that failed.",
  },
];

/** The discipline the project runs on. Stated here because it is the actual product — the
 *  tools are just how it gets applied. */
const PRINCIPLES: { title: string; body: string }[] = [
  {
    title: "Hypothesis first",
    body: "Write the question and what would falsify it before building the model. A screen with no stated question is a black box that returns numbers.",
  },
  {
    title: "Define correct before building",
    body: "State the baseline, the holdout and the sanity bounds up front. If a result cannot be independently checked, it is unknown — not done.",
  },
  {
    title: "Record the dead ends",
    body: "A falsified hypothesis is a result, and the one you are most likely to waste a week rediscovering. The catalogue is what compounds.",
  },
];

export default function RootHome() {
  return (
    <div className="bg-white min-h-[calc(100vh-4rem)] font-sans">
      {/* Hero */}
      <div className="py-20 px-8 pb-16 text-center border-b border-rule">
        <p className="text-xs font-semibold uppercase tracking-[0.15em] text-green mb-4">
          Data-driven market dynamics
        </p>
        <h1 className="font-sans text-[2.75rem] max-[570px]:text-[2rem] font-bold tracking-tight text-ink mb-4 text-balance">
          Personal Investing Research Tool
        </h1>
        <p className="text-lg text-ink-light max-w-2xl mx-auto text-pretty">
          A workbench for forming hypotheses about how markets behave, testing them against
          two decades of fundamentals and prices, and writing down what actually holds up.
        </p>
        <p className="text-sm text-ink-muted max-w-2xl mx-auto mt-4">
          A research program, not a trading bot — and nothing here is investment advice.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3 flex-wrap">
          <Link
            href="/filter"
            className="no-underline rounded-lg bg-green px-5 py-2.5 text-[0.9375rem] font-medium text-white transition-colors duration-150 hover:bg-green-dark"
          >
            Open the screener
          </Link>
          <Link
            href="/dd"
            className="no-underline rounded-lg border border-rule px-5 py-2.5 text-[0.9375rem] font-medium text-ink transition-colors duration-150 hover:border-green hover:text-green"
          >
            Read a write-up
          </Link>
        </div>
      </div>

      <div className="max-w-[1100px] mx-auto py-16 px-6">
        {/* Tools */}
        <h2 className="text-sm font-semibold text-ink mb-5 uppercase tracking-wide">
          The tools
        </h2>
        <div className="grid grid-cols-3 max-[900px]:grid-cols-2 max-[570px]:grid-cols-1 gap-4">
          {TOOLS.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className="group no-underline bg-white rounded-xl border border-rule shadow-sm p-5 transition-colors duration-150 hover:border-green"
            >
              <div className="text-base font-semibold text-ink group-hover:text-green transition-colors duration-150">
                {t.label}
              </div>
              <p className="mt-1.5 text-sm text-ink-light leading-relaxed">{t.blurb}</p>
            </Link>
          ))}
        </div>

        {/* How it works */}
        <h2 className="text-sm font-semibold text-ink mt-16 mb-5 uppercase tracking-wide">
          How it works
        </h2>
        <div className="bg-white rounded-xl border border-rule shadow-sm p-6">
          <p className="text-sm text-ink-light leading-relaxed">
            Underneath is a local mirror of the{" "}
            <span className="font-medium text-ink">Sharadar</span> US equity bundle —
            fundamentals, prices, insider transactions and 13F holdings back to 1998 —
            alongside <span className="font-medium text-ink">FRED</span> macro panels. What
            you look for is a screen you define yourself; the same definition drives the live
            idea board <em>and</em> the point-in-time backtest, so a backtest tests the filter
            you actually use.
          </p>
          <div className="mt-5 flex items-center gap-2 flex-wrap text-[0.8125rem] text-ink-faint">
            {["Define a screen", "Pre-register the falsification", "Backtest", "Log the verdict", "Promote what survives"].map(
              (step, i, arr) => (
                <span key={step} className="flex items-center gap-2">
                  <span className="rounded-md bg-green-soft px-2 py-1 font-medium text-green-text">
                    {step}
                  </span>
                  {i < arr.length - 1 && <span className="text-ink-muted">→</span>}
                </span>
              )
            )}
          </div>
        </div>

        {/* Principles */}
        <h2 className="text-sm font-semibold text-ink mt-16 mb-5 uppercase tracking-wide">
          How it is kept honest
        </h2>
        <div className="grid grid-cols-3 max-[900px]:grid-cols-1 gap-4">
          {PRINCIPLES.map((p) => (
            <div
              key={p.title}
              className="bg-white rounded-xl border border-rule shadow-sm p-5"
            >
              <div className="text-base font-semibold text-ink">{p.title}</div>
              <p className="mt-1.5 text-sm text-ink-light leading-relaxed">{p.body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
