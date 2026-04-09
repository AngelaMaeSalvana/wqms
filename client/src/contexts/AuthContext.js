import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import api from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refreshProfile = async () => {
    try {
      const me = await api.getAuthMe();
      const nextUser = me?.user || null;
      setUser(nextUser);
      try {
        if (nextUser) localStorage.setItem('wqms_current_user', JSON.stringify(nextUser));
        else localStorage.removeItem('wqms_current_user');
      } catch {}
    } catch (_) {
      setUser(null);
      try {
        localStorage.removeItem('wqms_current_user');
      } catch {}
    }
  };

  useEffect(() => {
    let mounted = true;
    refreshProfile().finally(() => {
      if (mounted) setLoading(false);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const value = useMemo(() => ({
    user,
    profile: user,
    loading,
    role: user?.role === 'admin' ? 'admin' : 'guest',
    isAdmin: user?.role === 'admin',
    isGuest: user?.role !== 'admin',
    emailVerified: true,
    profileCompleted: !!user?.username,
    refreshProfile: async () => refreshProfile(),
    signOut: async () => {
      await api.logoutServer();
      setUser(null);
      try {
        localStorage.removeItem('wqms_current_user');
      } catch {}
      setLoading(false);
    },
  }), [user, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
