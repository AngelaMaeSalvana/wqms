import React from 'react';
import './EmptyState.css';

const EmptyState = ({ icon, title, message, action }) => {
  return (
    <div className="empty-state" role="status">
      {icon && <span className="empty-icon" aria-hidden="true">{icon}</span>}
      {title && <h3 className="empty-title">{title}</h3>}
      {message && <p className="empty-message">{message}</p>}
      {action && (
        <button 
          className="ghost-btn empty-action"
          onClick={action.onClick}
          aria-label={action.label}
        >
          {action.label}
        </button>
      )}
    </div>
  );
};

export default EmptyState;

