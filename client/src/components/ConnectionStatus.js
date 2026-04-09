import React, { useState } from 'react';
import './ConnectionStatus.css';

const ConnectionStatus = ({ isConnected, isConnecting, error, onReconnect, brokerUrl }) => {
  const [showDetails, setShowDetails] = useState(false);
  
  const mqttUrl = brokerUrl || process.env.REACT_APP_MQTT_WS_URL || process.env.REACT_APP_MQTT_URL || 'HiveMQ (not configured)';

  return (
    <div 
      className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}
      role="status"
      aria-live="polite"
      aria-label={isConnected ? 'Connected to MQTT' : 'Disconnected from MQTT'}
      onMouseEnter={() => setShowDetails(true)}
      onMouseLeave={() => setShowDetails(false)}
    >
      <span className={`status-dot ${isConnected ? 'connected' : 'disconnected'}`} />
      <span className="status-text">
        {isConnecting ? 'Connecting...' : isConnected ? 'Live' : 'Offline'}
      </span>
      {error && onReconnect && (
        <button
          className="reconnect-btn"
          onClick={onReconnect}
          aria-label="Reconnect to MQTT"
        >
          Reconnect
        </button>
      )}
      {showDetails && !isConnected && (
        <div className="connection-details">
          <div className="connection-details-content">
            <p><strong>MQTT Broker:</strong> {mqttUrl}</p>
            {error && <p><strong>Error:</strong> {error}</p>}
            <p className="connection-help">
              💡 <strong>To connect:</strong><br/>
              Set REACT_APP_MQTT_WS_URL (e.g. mqtt://xxx.s1.eu.hivemq.cloud), REACT_APP_MQTT_USER, and REACT_APP_MQTT_PASS in client/.env
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default ConnectionStatus;

