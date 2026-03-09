import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '../AISignalDashboard.jsx';

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null, info: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { this.setState({ info }); }
  render() {
    if (this.state.error) {
      return React.createElement('div', { style: { padding: 40, fontFamily: 'monospace' } },
        React.createElement('h1', { style: { color: '#c0392b' } }, 'Something went wrong'),
        React.createElement('pre', { style: { whiteSpace: 'pre-wrap', background: '#f5f5f5', padding: 16, borderRadius: 8 } },
          String(this.state.error)
        ),
        React.createElement('button', {
          onClick: () => window.location.reload(),
          style: { marginTop: 12, padding: '8px 16px', cursor: 'pointer', borderRadius: 6, border: '1px solid #ccc' }
        }, 'Reload')
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
