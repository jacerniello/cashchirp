// Site-wide banner. Edit this file to change what every page shows.
//
// It renders directly under the navbar on every route, so it is the one place to say
// something that applies to the whole site — "this is a demo on generated data", a
// maintenance window, a known-stale dataset. Set `enabled: false` to hide it.
//
// Deliberately a source file rather than an env var: it is versioned, reviewable in a
// diff, and cannot end up saying something in production that nobody can trace.

export type BannerTone = 'info' | 'warn' | 'demo';

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
  enabled: true,
  text: 'Demo site — the figures shown are for demonstration purposes and were randomly generated',
  tone: 'demo',
  dismissible: false,
  id: 'demo-2',
};
