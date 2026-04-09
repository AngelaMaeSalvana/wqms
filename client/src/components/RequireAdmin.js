import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

export default function RequireAdmin({ children }) {
  const { isAdmin, loading } = useAuth();
  const location = useLocation();

  if (loading) return null;
  if (!isAdmin) {
    return <Navigate to="/dashboard" replace state={{ from: location.pathname }} />;
  }
  return children;
}
