import React, { useState } from 'react';
import { config } from '../config/env';
import './ConnectionStatus.css';

const ConnectionStatus = ({ isConnected, isConnecting, error, onReconnect, brokerUrl }) => {
  const [showDetails, setShowDetails] = useState(false);
  const mqttUrl = brokerUrl || config.mqtt?.url || 'HiveMQ Cloud';

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
              💡 <strong>Live data:</strong> Sensor → LoRa → Forwarder → HiveMQ → Dashboard.<br/>
              Default: HiveMQ Cloud (WSS). Override with REACT_APP_MQTT_WS_URL, REACT_APP_MQTT_USER, REACT_APP_MQTT_PASS in .env
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default ConnectionStatus;

