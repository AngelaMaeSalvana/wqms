import React, { useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from '../components/Toast';
import './Auth.css';

export default function Login() {
  const { user, refreshProfile } = useAuth();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { toasts, showToast, removeToast } = useToast();

  const nextPath = location.state?.from || '/dashboard';
  if (user) return <Navigate to={nextPath} replace />;

  const signIn = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await api.login({ username, password });
      await refreshProfile();
    } catch (err) {
      const message = err?.message || 'Login failed';
      setError(message);
      showToast(message, 'error');
    }
    setLoading(false);
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h2 className="auth-title">Login</h2>
        <p className="auth-subtitle">Sign in to continue to AQUALENS.</p>
        <form className="auth-form" onSubmit={signIn}>
          <input className="auth-input" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" required />
          <div className="auth-password-wrap">
            <input
              className="auth-input auth-password-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              type={showPassword ? 'text' : 'password'}
              required
            />
            <button
              type="button"
              className="auth-password-toggle"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              title={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M3 3l18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <path
                    d="M10.6 10.6A2 2 0 0 0 12 14a2 2 0 0 0 1.4-.6M9.9 5.3A10.9 10.9 0 0 1 12 5c5.5 0 9.5 5.3 9.9 6-.3.5-1.7 2.5-4 4M6.1 6.1C3.8 7.6 2.4 9.6 2.1 10c.4.7 4.4 6 9.9 6 1 0 2-.2 2.9-.5"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M2.1 12s4-7 9.9-7 9.9 7 9.9 7-4 7-9.9 7-9.9-7-9.9-7z"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
                </svg>
              )}
            </button>
          </div>
          <button className="auth-button" type="submit" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
        {error ? <p className="auth-error">{error}</p> : null}
        <p className="auth-footer" style={{ marginTop: 10 }}>
          <Link to="/forgot-password">Forgot password?</Link>
        </p>
        <p className="auth-footer">No account yet? <Link to="/signup">Create one</Link></p>
      </div>
      <ToastContainer toasts={toasts} onClose={removeToast} />
    </div>
  );
}
