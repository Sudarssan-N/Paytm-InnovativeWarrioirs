import React from 'react';

export default class ErrorBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main style={{ padding: 40 }} role="alert">
      <h1>MITRA could not display this view</h1>
      <p>Reload to try again.</p>
      <button onClick={() => window.location.reload()}>Reload MITRA</button>
    </main>;
  }
}
