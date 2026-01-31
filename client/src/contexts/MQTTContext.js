import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { useMQTT } from '../hooks/useMQTT';
import { normalizeMQTTReading } from '../utils/mqttReading';

const MQTTContext = createContext(null);

const DATA_TOPIC_PREFIX = 'water-quality/';

export function MQTTProvider({ children }) {
  const { client, isConnected, isConnecting, error, reconnect } = useMQTT(null, {});
  const [latestReadingsByNode, setLatestReadingsByNode] = useState({});
  const clientRef = useRef(client);
  clientRef.current = client;

  useEffect(() => {
    if (!client || !isConnected) return;

    const c = client;
    c.subscribe('water-quality/#', { qos: 1 }, (err) => {
      if (err) {
        console.error('❌ MQTT subscribe water-quality/# failed:', err);
        return;
      }
      console.log('📡 Subscribed to water-quality/# (HiveMQ live data)');
    });

    const messageHandler = (topic, message) => {
      if (!topic.startsWith(DATA_TOPIC_PREFIX) || topic.endsWith('/command')) return;
      const nodeId = topic.slice(DATA_TOPIC_PREFIX.length).split('/')[0];
      if (!nodeId) return;
      try {
        const payload = JSON.parse(message.toString());
        const normalized = normalizeMQTTReading(payload, nodeId);
        if (normalized) {
          setLatestReadingsByNode((prev) => ({
            ...prev,
            [normalized.nodeId || nodeId]: { ...normalized, _receivedAt: Date.now() },
          }));
        }
      } catch (e) {
        console.warn('MQTT message parse error:', topic, e.message);
      }
    };

    c.on('message', messageHandler);
    return () => {
      c.removeListener('message', messageHandler);
      c.unsubscribe('water-quality/#');
    };
  }, [isConnected, client]);

  const getLatestReading = useCallback(
    (nodeId) => {
      if (!nodeId) return null;
      return latestReadingsByNode[nodeId] ?? null;
    },
    [latestReadingsByNode]
  );

  const sendCommand = useCallback((nodeId, command) => {
    const c = clientRef.current;
    if (!c || !c.connected || !nodeId || command == null) return false;
    const topic = `water-quality/${nodeId}/command`;
    const payload = typeof command === 'string' ? command : JSON.stringify(command);
    c.publish(topic, payload, { qos: 1 }, (err) => {
      if (err) console.error('MQTT publish command failed:', err);
      else console.log('📤 Command sent:', topic, payload);
    });
    return true;
  }, []);

  const value = {
    client,
    isConnected,
    isConnecting,
    error,
    reconnect,
    latestReadingsByNode,
    getLatestReading,
    sendCommand,
  };

  return <MQTTContext.Provider value={value}>{children}</MQTTContext.Provider>;
}

export function useMQTTContext() {
  const ctx = useContext(MQTTContext);
  if (!ctx) {
    throw new Error('useMQTTContext must be used within MQTTProvider');
  }
  return ctx;
}

export function useMQTTContextOptional() {
  return useContext(MQTTContext);
}
