import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import App from './App.jsx';

class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(e) { return { error: e }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ position:'fixed', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', background:'#faf7f4', gap:16, padding:32, textAlign:'center' }}>
          <svg width="42" height="40" viewBox="0 0 42 40" fill="none" aria-hidden="true">
            <circle cx="15" cy="17" r="10" fill="#c2603a"/>
            <circle cx="27" cy="17" r="10" fill="#3f5e4e"/>
            <circle cx="21" cy="29" r="6.6" fill="#b08642"/>
          </svg>
          <p style={{ color:'#6b5a4e', fontSize:15, margin:0 }}>Something went wrong — please reload.</p>
          <button onClick={() => location.reload()} style={{ padding:'10px 24px', background:'#c2603a', color:'#fff', borderRadius:999, border:'none', fontSize:15, cursor:'pointer' }}>
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
