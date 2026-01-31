import React, { useState, useEffect } from 'react';
import { isSupabaseEnabled, supabase } from '../lib/supabaseClient';
import './DatabaseStatus.css';

/**
 * Shows whether Supabase is configured and reachable.
 * Runs a quick test query on mount so you can see "DB: Supabase ✓" when connected.
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
    return (
      <div
        className="database-status database-status--none"
        role="status"
        aria-label="Supabase not connected"
        title="Set REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY in Vercel Environment Variables, then redeploy."
      >
        <span className="database-status__dot" />
        <span className="database-status__label">DB: Not connected</span>
        <span className="database-status__hint" title="Vercel: Settings → Environment Variables → add REACT_APP_SUPABASE_URL, REACT_APP_SUPABASE_ANON_KEY → Redeploy">
          Vercel: add REACT_APP_SUPABASE_* and redeploy
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
