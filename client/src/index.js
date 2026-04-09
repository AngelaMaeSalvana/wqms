import React from 'react';
import ReactDOM from 'react-dom/client';
import 'leaflet/dist/leaflet.css';
import './index.css';
import App from './App';
import { ThemeProvider } from './contexts/ThemeContext';
import ErrorBoundary from './components/ErrorBoundary';

// Apply saved font preference before first paint
const savedFont = localStorage.getItem('fontPreference');
if (savedFont) document.documentElement.setAttribute('data-font-size', savedFont);

// Suppress benign ResizeObserver loop errors in development
// These are non-critical browser notifications that don't affect functionality
if (process.env.NODE_ENV === 'development') {
  const _error = window.onerror;
  window.onerror = function(message, ...args) {
    if (typeof message === 'string' && message.includes('ResizeObserver loop')) return true;
    return _error ? _error(message, ...args) : false;
  };
  const _addEventListener = window.addEventListener.bind(window);
  window.addEventListener = function(type, listener, ...rest) {
    if (type === 'error') {
      const wrappedListener = function(event) {
        if (event.message && event.message.includes('ResizeObserver loop')) {
          event.stopImmediatePropagation();
          return;
        }
        listener(event);
      };
      return _addEventListener(type, wrappedListener, ...rest);
    }
    return _addEventListener(type, listener, ...rest);
  };
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <ErrorBoundary>
    <ThemeProvider>
      <App />
    </ThemeProvider>
    </ErrorBoundary>
  </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals

