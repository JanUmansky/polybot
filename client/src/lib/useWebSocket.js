"use client";

import { useEffect, useRef, useState, useCallback } from "react";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:3004";
const MAX_EVENTS = 500;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15000;

export function useWebSocket(channel) {
  const [events, setEvents] = useState([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);
  const reconnectDelay = useRef(RECONNECT_BASE_MS);
  const reconnectTimer = useRef(null);
  const channelRef = useRef(channel);

  channelRef.current = channel;

  const clearEvents = useCallback(() => setEvents([]), []);

  useEffect(() => {
    if (!channel) return;

    let closed = false;

    function connect() {
      if (closed) return;

      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        reconnectDelay.current = RECONNECT_BASE_MS;
        ws.send(JSON.stringify({ type: "subscribe", channel: channelRef.current }));
      };

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          setEvents((prev) => {
            const next = [...prev, msg];
            return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next;
          });
        } catch {
          // ignore non-JSON
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        setConnected(false);
        if (!closed) {
          reconnectTimer.current = setTimeout(() => {
            reconnectDelay.current = Math.min(reconnectDelay.current * 2, RECONNECT_MAX_MS);
            connect();
          }, reconnectDelay.current);
        }
      };

      ws.onerror = () => {
        // close will fire after this
      };
    }

    connect();

    return () => {
      closed = true;
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
      const ws = wsRef.current;
      if (ws) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "unsubscribe", channel }));
        }
        ws.close();
        wsRef.current = null;
      }
      setEvents([]);
      setConnected(false);
    };
  }, [channel]);

  return { events, connected, clearEvents };
}
