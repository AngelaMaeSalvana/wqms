import React from 'react';
import './OfflineBanner.css';

const OfflineBanner = ({ isOnline }) => {
  if (isOnline) return null;

  return (
    <div className="offline-banner" role="alert" aria-live="assertive">
      <span className="offline-icon">📡</span>
      <span className="offline-message">
        You're offline. Some features may be unavailable.
      </span>
    </div>
  );
};

export default OfflineBanner;

