import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { PageLoader } from './LoadingSkeleton';
import { useAuth } from '../contexts/AuthContext';

export default function RequireAuth({ children }) {
  const { user, loading, profileCompleted } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <PageLoader />
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (!profileCompleted) {
    return <Navigate to="/complete-profile" replace />;
  }
  return children;
}
