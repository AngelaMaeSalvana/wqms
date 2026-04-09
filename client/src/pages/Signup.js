import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import './Auth.css';

export default function Signup() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const signUp = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');
    const normalizedUsername = username.trim();
    if (!/^[a-zA-Z0-9_]{3,32}$/.test(normalizedUsername)) {
      setError('Username must be 3-32 characters and use letters, numbers, or underscore.');
      setLoading(false);
      return;
    }
    try {
      await api.signup({ username: normalizedUsername, password });
      setSuccess('Signup successful. You can now login with your username and password.');
    } catch (err) {
      setError(err?.message || 'Signup failed');
    }
    setLoading(false);
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h2 className="auth-title">Create account</h2>
        <p className="auth-subtitle">Create your credentials to access AQUALENS.</p>
        <form className="auth-form" onSubmit={signUp}>
          <input className="auth-input" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" required minLength={3} maxLength={32} />
          <input className="auth-input" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" type="password" required minLength={8} />
          <button className="auth-button" type="submit" disabled={loading}>
            {loading ? 'Creating account...' : 'Sign up'}
          </button>
        </form>
        {error ? <p className="auth-error">{error}</p> : null}
        {success ? <p className="auth-success">{success}</p> : null}
        <p className="auth-footer">Already have an account? <Link to="/login">Login</Link></p>
      </div>
    </div>
  );
}
