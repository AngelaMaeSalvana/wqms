import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import './Auth.css';

export default function ForgotPassword() {
  const [emailOrUsername, setEmailOrUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const data = await api.requestForgotPassword({ emailOrUsername });
      setSuccess(data?.message || 'Check your email for the reset link.');
    } catch (err) {
      setError(err?.message || 'Request failed');
    }
    setLoading(false);
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h2 className="auth-title">Forgot password</h2>
        <p className="auth-subtitle">
          Enter the email or username you use for AQUALENS. We only send a link if the account has an email saved (add one in Settings → Profile if needed).
        </p>
        <form className="auth-form" onSubmit={submit}>
          <input
            className="auth-input"
            value={emailOrUsername}
            onChange={(e) => setEmailOrUsername(e.target.value)}
            placeholder="Email or username"
            required
            autoComplete="username"
          />
          <button className="auth-button" type="submit" disabled={loading}>
            {loading ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
        {error ? <p className="auth-error">{error}</p> : null}
        {success ? <p className="auth-success">{success}</p> : null}
        <p className="auth-footer">
          <Link to="/login">Back to login</Link>
          {' · '}
          <Link to="/signup">Create account</Link>
        </p>
      </div>
    </div>
  );
}
