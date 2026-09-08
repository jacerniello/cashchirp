// Site-wide banner. Edit this file to change what every page shows.
//
// It renders directly under the navbar on every route, so it is the one place to say
// something that applies to the whole site — "this is a demo on generated data", a
// maintenance window, a known-stale dataset. Set `enabled: false` to hide it.
//
// The message is deliberately a source file rather than an env var: it is versioned,
// reviewable in a diff, and cannot end up saying something in production that nobody
// can trace.
//
// WHETHER it shows is per-environment, because the same checkout runs against generated
// demo data on the droplet and against the real mirror locally, and the demo disclaimer
// is a lie in the second case. To hide it on a machine, put this in web/.env.local
// (gitignored, the same place NEXT_PUBLIC_SETUP_ENABLED lives):
//
//     NEXT_PUBLIC_BANNER_DISABLED=true
//
// Opt-OUT, not opt-in, on purpose: a deployment that never sets the flag still shows the
// banner. A demo site silently presenting generated figures as real is the failure worth
// guarding against — a redundant banner on a dev box is not. Next inlines
// NEXT_PUBLIC_* at build time, so changing it needs a dev-server restart or a rebuild.

export type BannerTone = 'info' | 'warn' | 'demo';

/** Master switch. `false` turns the banner off everywhere, env flag or not. */
const ENABLED = true;

export const BANNER: {
  enabled: boolean;
  /** Supports plain text. Keep it to one or two sentences — it sits on every page. */
  text: string;
  tone: BannerTone;
  /** Let a reader close it for this browser. Off for anything they must not miss. */
  dismissible: boolean;
  /** Bump when the message changes so a previous dismissal doesn't hide the new text. */
  id: string;
  link?: { href: string; label: string };
} = {
  enabled: ENABLED && process.env.NEXT_PUBLIC_BANNER_DISABLED !== 'true',
  text: 'Demo site — the figures shown are for demonstration purposes and were randomly generated.',
  tone: 'demo',
  dismissible: false,
  id: 'demo-3',
  // Says where the real thing is. A reader told the figures are fake should be one click
  // from the code that produces real ones, not left to assume the project is a toy.
  link: { href: 'https://github.com/jacerniello/cashchirp', label: 'Source on GitHub' },
};
