import React, { useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';
import './Auth.css';

export default function Login() {
  const { user, refreshProfile } = useAuth();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
      setError(err?.message || 'Login failed');
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
          <input className="auth-input" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" type="password" required />
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
    </div>
  );
}
