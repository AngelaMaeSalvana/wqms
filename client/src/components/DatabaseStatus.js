import React, { useState, useEffect } from 'react';
import { isSupabaseEnabled, supabase } from '../lib/supabaseClient';
import { config } from '../config/env';
import './DatabaseStatus.css';

/**
 * Shows whether Supabase is configured and reachable.
 * Runs a quick test query on mount so you can see "DB: Supabase ✓" when connected.
 * When not connected, shows which env var(s) are missing so you can fix Vercel.
 */
const DatabaseStatus = () => {
  const [status, setStatus] = useState('idle'); // 'idle' | 'checking' | 'ok' | 'error'
  const [errorMsg, setErrorMsg] = useState(null);

  useEffect(() => {
    if (!isSupabaseEnabled()) {
      setStatus('none');
      return;
    }
    setStatus('checking');
    setErrorMsg(null);
    supabase
      .from('nodes')
      .select('id')
      .limit(1)
      .then(({ error }) => {
        if (error) {
          setStatus('error');
          setErrorMsg(error.message);
        } else {
          setStatus('ok');
        }
      })
      .catch((err) => {
        setStatus('error');
        setErrorMsg(err?.message || 'Connection failed');
      });
  }, []);

  if (!isSupabaseEnabled()) {
    const hasUrl = !!config.supabase.url;
    const hasKey = !!config.supabase.anonKey;
    const missing = [];
    if (!hasUrl) missing.push('NEXT_PUBLIC_SUPABASE_URL');
    if (!hasKey) missing.push('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    const hint = missing.length
      ? `Missing in build: ${missing.join(', ')}. In Vercel add these (or REACT_APP_*), then Redeploy with "Clear cache".`
      : 'Vercel: add NEXT_PUBLIC_SUPABASE_URL & NEXT_PUBLIC_SUPABASE_ANON_KEY (or REACT_APP_*) for Production, then Redeploy with "Clear cache".';
    return (
      <div
        className="database-status database-status--none"
        role="status"
        aria-label="Supabase not connected"
        title={hint}
      >
        <span className="database-status__dot" />
        <span className="database-status__label">DB: Not connected</span>
        <span className="database-status__hint" title={hint}>
          {missing.length ? `Missing: ${missing.join(', ')} — clear cache & redeploy` : 'Clear cache & redeploy'}
        </span>
      </div>
    );
  }

  return (
    <div
      className={`database-status database-status--${status}`}
      role="status"
      aria-label={
        status === 'ok'
          ? 'Connected to Supabase'
          : status === 'error'
          ? `Supabase error: ${errorMsg}`
          : 'Checking Supabase connection'
      }
      title={status === 'error' ? errorMsg : undefined}
    >
      <span className="database-status__dot" />
      <span className="database-status__label">
        DB: Supabase
        {status === 'checking' && ' …'}
        {status === 'ok' && ' ✓'}
        {status === 'error' && ' ✗'}
      </span>
      {status === 'error' && errorMsg && (
        <span className="database-status__error" title={errorMsg}>
          {errorMsg.length > 40 ? errorMsg.slice(0, 40) + '…' : errorMsg}
        </span>
      )}
    </div>
  );
};

export default DatabaseStatus;
