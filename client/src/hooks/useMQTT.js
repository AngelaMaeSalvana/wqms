import { useEffect, useRef, useState, useCallback } from 'react';
import mqtt from 'mqtt';
import { config } from '../config/env';

// Local dev fallback when .env has no MQTT URL (browser needs ws/wss)
const FALLBACK_URL = 'ws://localhost:9001';

/** HTTPS pages cannot use ws:// (mixed content). Use wss:// or skip connect. */
function getSafeMqttUrl(url) {
  if (typeof window === 'undefined') return url;
  if (window.location.protocol !== 'https:') return url;
  // Page is HTTPS (e.g. Vercel): must use wss://
  if (url.startsWith('wss://') || url.startsWith('wss:')) return url;
  if (url.startsWith('ws://')) return 'wss://' + url.slice(5);
  // Fallback is ws://localhost — cannot use on HTTPS; return as-is and let connection fail with clear error
  return url;
}

/**
 * Custom hook for MQTT connection and subscription.
 * Config from .env: REACT_APP_MQTT_WS_URL, REACT_APP_MQTT_USER, REACT_APP_MQTT_PASS
 *
 * Sensor node → LoRa → Forwarder → HiveMQ → WQMS dashboard
 *
 * @param {string} brokerUrl - Override URL (optional)
 * @param {object} options - Override options (optional)
 */
export const useMQTT = (brokerUrl = null, options = {}) => {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(true);
  const [error, setError] = useState(null);
  const clientRef = useRef(null);

  let url = brokerUrl || config.mqtt.url || FALLBACK_URL;
  url = getSafeMqttUrl(url);
  const username = options.username ?? config.mqtt.user ?? '';
  const password = options.password ?? config.mqtt.pass ?? '';

  useEffect(() => {
    const mqttOptions = {
      clientId: `wqms-dashboard-${Math.random().toString(16).substr(2, 8)}`,
      clean: true,
      reconnectPeriod: 5000,
      connectTimeout: 30000,
      protocolVersion: 4,
      protocolId: 'MQTT',
      username: (url.startsWith('wss://') || url.startsWith('wss:')) && username ? username : undefined,
      password: (url.startsWith('wss://') || url.startsWith('wss:')) && password ? password : undefined,
      ...options,
    };

    console.log('🔌 Attempting to connect to MQTT broker:', url);

    // Connect to MQTT broker
    const client = mqtt.connect(url, mqttOptions);
    clientRef.current = client;

    // Connection event handlers
    client.on('connect', () => {
      setIsConnected(true);
      setIsConnecting(false);
      setError(null);
      console.log('✅ MQTT Connected to broker:', url);
    });

    client.on('reconnect', () => {
      setIsConnecting(true);
      console.log('🔄 MQTT Reconnecting...');
    });

    client.on('close', () => {
      setIsConnected(false);
      setIsConnecting(false);
      console.log('❌ MQTT Connection closed');
      console.log('💡 Attempting to reconnect in 5 seconds...');
    });

    client.on('offline', () => {
      setIsConnected(false);
      setIsConnecting(false);
      console.log('⚠️ MQTT Client offline');
    });

    client.on('error', (err) => {
      setError(err.message);
      setIsConnected(false);
      setIsConnecting(false);
      console.error('❌ MQTT Error:', err);
      console.error('❌ Error details:', {
        message: err.message,
        code: err.code,
        errno: err.errno,
        syscall: err.syscall,
        address: err.address,
        port: err.port
      });
    });

    client.on('end', () => {
      setIsConnected(false);
      console.log('🔚 MQTT Connection ended');
    });

    // Cleanup on unmount
    return () => {
      if (clientRef.current) {
        clientRef.current.end();
        clientRef.current = null;
      }
    };
  }, [url, username, password, JSON.stringify(options)]);

  const subscribe = useCallback((topics, callback) => {
    if (!clientRef.current || !clientRef.current.connected) {
      console.warn('⚠️ MQTT client not connected. Cannot subscribe.');
      return;
    }

    // Handle single topic string or array of topics
    const topicArray = Array.isArray(topics) ? topics : [topics];
    
    topicArray.forEach(topic => {
      clientRef.current.subscribe(topic, { qos: 1 }, (err) => {
        if (err) {
          console.error(`❌ Failed to subscribe to ${topic}:`, err);
          setError(`Subscription failed: ${err.message}`);
        } else {
          console.log(`📡 Subscribed to topic: ${topic}`);
        }
      });

      // Set up message handler for this topic
      if (callback) {
        clientRef.current.on('message', (receivedTopic, message) => {
          if (receivedTopic === topic) {
            try {
              const data = JSON.parse(message.toString());
              callback(data, receivedTopic);
            } catch (err) {
              // If not JSON, pass as string
              callback(message.toString(), receivedTopic);
            }
          }
        });
      }
    });
  }, []);

  const unsubscribe = useCallback((topics) => {
    if (!clientRef.current || !clientRef.current.connected) {
      return;
    }

    const topicArray = Array.isArray(topics) ? topics : [topics];
    topicArray.forEach(topic => {
      clientRef.current.unsubscribe(topic, (err) => {
        if (err) {
          console.error(`❌ Failed to unsubscribe from ${topic}:`, err);
        } else {
          console.log(`📡 Unsubscribed from topic: ${topic}`);
        }
      });
    });
  }, []);

  const reconnect = useCallback(() => {
    if (clientRef.current) {
      clientRef.current.reconnect();
    }
  }, []);

  return {
    client: clientRef.current,
    isConnected,
    isConnecting,
    error,
    subscribe,
    unsubscribe,
    reconnect,
  };
};

/**
 * Hook for subscribing to water quality data topics
 * 
 * Expected MQTT topics based on system architecture:
 * - water-quality/node1
 * - water-quality/node2
 * - water-quality/all
 * - sensor-data/+
 * - alerts/+
 * 
 * @param {object} client - MQTT client instance
 * @param {function} onData - Callback function when data is received
 * @param {array} topics - Topics to subscribe to
 */
export const useWaterQualityMQTT = (client, onData, topics = ['water-quality/+', 'sensor-data/+', 'alerts/+']) => {
  useEffect(() => {
    if (!client || !client.connected || !onData) {
      return;
    }

    // Subscribe to all topics
    topics.forEach(topic => {
      client.subscribe(topic, { qos: 1 }, (err) => {
        if (err) {
          console.error(`❌ Failed to subscribe to ${topic}:`, err);
        } else {
          console.log(`📡 Subscribed to MQTT topic: ${topic}`);
        }
      });
    });

    // Set up message handler
    const messageHandler = (topic, message) => {
      try {
        const data = JSON.parse(message.toString());
        onData(data, topic);
      } catch (err) {
        // If not JSON, pass as string
        onData(message.toString(), topic);
      }
    };

    client.on('message', messageHandler);

    // Cleanup: unsubscribe on unmount
    return () => {
      if (client) {
        topics.forEach(topic => {
          client.unsubscribe(topic);
        });
        client.removeListener('message', messageHandler);
      }
    };
  }, [client, onData, JSON.stringify(topics)]);
};

