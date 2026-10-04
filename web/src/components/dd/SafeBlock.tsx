'use client';

import { Component, type ReactNode } from 'react';

// Contains a render crash to one block of a report. DD files are hand- and AI-edited, so a
// field can hold something the renderer never expected; that should cost one section,
// with a note saying so, not the whole page.
export class SafeBlock extends Component<
  { children: ReactNode; label?: string },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-lg border border-rule bg-gold-soft px-4 py-3 text-xs text-ink-light">
          Could not render {this.props.label ? <strong>{this.props.label}</strong> : 'this section'} — the
          data in the file has an unexpected shape ({this.state.error.message}). The rest of the report is unaffected.
        </div>
      );
    }
    return this.props.children;
  }
}
