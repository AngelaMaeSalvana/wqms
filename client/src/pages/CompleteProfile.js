import React, { useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';

export default function CompleteProfile() {
  const { user, profileCompleted, refreshProfile } = useAuth();
  const suggested = useMemo(() => {
    const fromMeta = user?.user_metadata?.username;
    if (fromMeta && typeof fromMeta === 'string') return fromMeta;
    return user?.email ? user.email.split('@')[0] : '';
  }, [user]);
  const [username, setUsername] = useState(suggested);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (!user) return <Navigate to="/login" replace />;
  if (profileCompleted) return <Navigate to="/dashboard" replace />;

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await api.upsertProfile({ username });
      await refreshProfile();
    } catch (err) {
      setError(err?.message || 'Unable to save profile');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 420, margin: '48px auto', padding: 16 }}>
      <h2>Complete profile</h2>
      <p>Choose a unique username to continue.</p>
      <form onSubmit={submit}>
        <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" minLength={3} maxLength={32} required style={{ width: '100%', marginBottom: 12 }} />
        <button type="submit" disabled={loading} style={{ width: '100%' }}>
          {loading ? 'Saving...' : 'Save username'}
        </button>
      </form>
      {error ? <p style={{ color: 'crimson' }}>{error}</p> : null}
    </div>
  );
}
