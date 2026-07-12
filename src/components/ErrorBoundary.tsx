import React from 'react';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div style={{ padding: 24, color: '#e0e0e0', background: '#1e1e2e', minHeight: 200 }}>
          <h3 style={{ color: '#f38ba8', marginBottom: 8 }}>Render Error</h3>
          <pre style={{ fontSize: 12, whiteSpace: 'pre-wrap', color: '#a6adc8' }}>
            {this.state.error?.message || 'Unknown error'}
          </pre>
          <button
            style={{ marginTop: 12, padding: '6px 16px', background: '#45475a', color: '#cdd6f4', border: 'none', borderRadius: 6, cursor: 'pointer' }}
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
