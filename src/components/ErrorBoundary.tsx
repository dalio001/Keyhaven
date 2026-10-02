/**
 * ErrorBoundary — if a page throws while rendering, show a short recoverable
 * message instead of unmounting the whole app (which left a blank page,
 * KH-06). Reloading locks the vault; nothing decrypted is shown here.
 */

import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface State {
  failed: boolean;
}

export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('KeyHaven page error', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="font-display text-2xl font-semibold text-kh-primary">Something went wrong</h1>
        <p className="text-sm leading-6 text-kh-muted">
          This page hit an unexpected error. Reloading fixes it; your vault stays encrypted and will ask for your
          master password again. Unsaved changes are kept only if the save status said “Saved”.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="bg-aurora rounded-xl px-5 py-2.5 text-sm font-semibold text-[#04110B] transition-all hover:-translate-y-px hover:brightness-110"
        >
          Reload KeyHaven
        </button>
      </div>
    );
  }
}
