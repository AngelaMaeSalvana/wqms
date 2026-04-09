import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import './Auth.css';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Signup() {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
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
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^[a-zA-Z0-9_]{3,32}$/.test(normalizedUsername)) {
      setError('Username must be 3-32 characters and use letters, numbers, or underscore.');
      setLoading(false);
      return;
    }
    if (!normalizedEmail) {
      setError('Please enter your email.');
      setLoading(false);
      return;
    }
    if (!EMAIL_REGEX.test(normalizedEmail)) {
      setError('Please enter a valid email address.');
      setLoading(false);
      return;
    }
    try {
      await api.signup({ username: normalizedUsername, email: normalizedEmail, password });
      setSuccess('Signup successful. You can sign in with your username and password. This email is used for password recovery.');
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
          <input className="auth-input" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" required minLength={3} maxLength={32} autoComplete="username" />
          <input className="auth-input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email" required autoComplete="email" />
          <input className="auth-input" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" type="password" required minLength={8} autoComplete="new-password" />
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
