// client/src/hooks/useSocket.js
import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';

let socket = null;

const getSocket = () => {
    if (!socket) {
        let serverUrl;
        const explicitUrl = import.meta.env.VITE_SIGNALING_SERVER_URL || '';

        if (explicitUrl && !explicitUrl.includes('localhost')) {
            // Explicit production deployment URL (e.g. Railway / Render / ngrok)
            serverUrl = explicitUrl;
        } else {
            // Dev mode or single-port mode:
            // Connect to window.location.origin so Socket.io routes through
            // Vite's HTTPS proxy (/socket.io -> 3001). This eliminates Mixed Content errors on mobile!
            serverUrl = window.location.origin;
        }

        console.log('[Socket] Connecting to:', serverUrl);

        socket = io(serverUrl, {
            autoConnect: false,
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
        });
    }
    return socket;
};

export const useSocket = () => {
    const socketRef = useRef(getSocket());

    useEffect(() => {
        const s = socketRef.current;
        if (!s.connected) s.connect();
        return () => { };
    }, []);

    return socketRef.current;
};