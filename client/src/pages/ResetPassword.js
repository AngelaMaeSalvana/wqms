import React, { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../services/api';
import './Auth.css';

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const tokenFromUrl = useMemo(() => searchParams.get('token') || '', [searchParams]);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (!tokenFromUrl) {
      setError('Missing reset token. Open the link from your email or request a new reset.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      const data = await api.resetPassword({ token: tokenFromUrl, password });
      setSuccess(data?.message || 'Password updated.');
    } catch (err) {
      setError(err?.message || 'Reset failed');
    }
    setLoading(false);
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h2 className="auth-title">Set new password</h2>
        <p className="auth-subtitle">Choose a new password (at least 8 characters).</p>
        {!tokenFromUrl ? (
          <p className="auth-error">This page needs a valid reset link. Use the URL from your email.</p>
        ) : null}
        <form className="auth-form" onSubmit={submit}>
          <input
            className="auth-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="New password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
          />
          <input
            className="auth-input"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Confirm new password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
          />
          <button className="auth-button" type="submit" disabled={loading || !tokenFromUrl}>
            {loading ? 'Updating…' : 'Update password'}
          </button>
        </form>
        {error ? <p className="auth-error">{error}</p> : null}
        {success ? (
          <p className="auth-success">
            {success}{' '}
            <Link to="/login">Sign in</Link>
          </p>
        ) : null}
        <p className="auth-footer">
          <Link to="/forgot-password">Request a new link</Link>
          {' · '}
          <Link to="/login">Login</Link>
        </p>
      </div>
    </div>
  );
}
