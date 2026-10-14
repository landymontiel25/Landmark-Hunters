import { Component } from 'react';
import { isLoadFailure, pageReload } from '../lib/chunkReload';

const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

// Catches a render-time crash in whatever it wraps: the current screen (keyed
// by route in App.jsx), each piece of always-on chrome (with a `fallback`),
// and the whole app as a last resort (main.jsx). Every catch is console.error'd.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, stillOffline: false };
    this.onOnline = null;
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // No crash-reporting service wired up yet -- at minimum this keeps the
    // real error visible in the console instead of vanishing with the UI.
    console.error('Uncaught render error:', error, info?.componentStack);
    // The screen's file could not download because the connection dropped.
    // React keeps that failure, so the screen stayed broken after the
    // connection came back until Try Again. Reload once it is back. (Found
    // by the app simulation, docs/app-sim-results.md.)
    if (isOffline() && isLoadFailure(error) && !this.onOnline && typeof window !== 'undefined') {
      this.onOnline = () => pageReload.run();
      window.addEventListener('online', this.onOnline, { once: true });
    }
  }

  componentWillUnmount() {
    if (this.onOnline) window.removeEventListener('online', this.onOnline);
  }

  // Offline, a reload swaps the app for the browser's own "no internet"
  // page, so Try Again says it is still offline instead.
  tryAgain = () => {
    if (isOffline()) {
      this.setState({ stillOffline: true });
      return;
    }
    pageReload.run();
  };

  render() {
    if (!this.state.error) return this.props.children;
    // Always-mounted chrome (header, prompts, banners) passes `fallback` so
    // one of them crashing drops just that piece instead of the whole app.
    if (this.props.fallback !== undefined) return this.props.fallback;
    return (
      <div style={{ padding: '24px 20px' }}>
        <h1 className="screen-title">{'\u{26A0}\u{FE0F}'} Something went wrong</h1>
        <p className="screen-subtitle">
          {typeof navigator !== 'undefined' && navigator.onLine === false
            ? "You're offline, and this screen needs a connection to open. It opens by itself once you're back online."
            : 'This screen hit a snag on our end. Anything you were typing is saved on this device, so trying again picks up where you left off.'}
        </p>
        {/* A full reload, not just clearing local state: the most common
            real cause here is a stale JS chunk reference from before the
            latest deploy (this project ships often), and re-rendering the
            same crashed subtree just re-fetches that same now-missing file
            and fails again identically. Reloading fetches the current
            index.html with correct chunk references, which actually fixes
            it -- clearing state can't. */}
        <button className="btn btn-primary btn-block" onClick={this.tryAgain}>
          Try Again
        </button>
        {this.state.stillOffline && (
          <p className="screen-subtitle" role="status" style={{ marginTop: 10 }}>
            Still offline. This screen opens again by itself once you're back online.
          </p>
        )}
        <a
          href="#/"
          onClick={(e) => {
            // Already on the map (the crashed screen IS "/"): the hash doesn't
            // change, so the router never re-renders and the link would do
            // nothing. Reload instead.
            const h = window.location.hash;
            if (!h || h === '#' || h === '#/') {
              e.preventDefault();
              window.location.reload();
            }
          }}
          className="btn btn-ghost btn-block"
          style={{ marginTop: 10, display: 'block', textAlign: 'center' }}
        >
          Back to Map
        </a>
        {/* The real error, small, so a screenshot of this screen says what broke. */}
        <p style={{ marginTop: 16, fontSize: '0.7rem', color: 'var(--color-parchment-dim)', wordBreak: 'break-word' }}>
          Details: {String(this.state.error?.message || this.state.error).slice(0, 300)}
        </p>
      </div>
    );
  }
}
