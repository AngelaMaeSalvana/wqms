import React, { useState } from 'react';
import './ConnectionStatus.css';

const ConnectionStatus = ({ isConnected, isConnecting, error, onReconnect, brokerUrl }) => {
  const [showDetails, setShowDetails] = useState(false);
  
  const mqttUrl = brokerUrl || process.env.REACT_APP_MQTT_URL || 'ws://localhost:9001';

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
              1. Start MQTT broker on port 9001<br/>
              2. Or set REACT_APP_MQTT_URL in .env<br/>
              3. See MQTT_SETUP.md for details
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default ConnectionStatus;

