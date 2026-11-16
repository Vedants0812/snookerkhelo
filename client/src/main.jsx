import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { ToastProvider } from './ui.jsx';
import './styles.css';

// Last-resort screen so an unexpected error never leaves staff looking at a blank page.
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error) { console.error(error); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="crash"><div className="card">
        <h3>Something went wrong</h3>
        <p className="muted">Running tables and bills are already saved. Reload to continue.</p>
        <button className="btn primary" onClick={() => window.location.reload()}>Reload</button>
      </div></div>
    );
  }
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
    <BrowserRouter>
      <ToastProvider>
        <App />
      </ToastProvider>
    </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
);
