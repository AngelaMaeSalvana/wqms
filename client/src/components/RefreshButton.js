import React from 'react';
import './RefreshButton.css';

const RefreshButton = ({ onRefresh, isRefreshing, ariaLabel = 'Refresh data' }) => {
  return (
    <button
      className="refresh-btn"
      onClick={onRefresh}
      disabled={isRefreshing}
      aria-label={ariaLabel}
      aria-busy={isRefreshing}
    >
      <span className={isRefreshing ? 'spinning' : ''}>🔄</span>
      {isRefreshing && <span className="refresh-text">Refreshing...</span>}
    </button>
  );
};

export default RefreshButton;

