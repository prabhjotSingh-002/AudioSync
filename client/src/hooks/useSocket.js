// client/src/hooks/useSocket.js
import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';

let socket = null;

const getSocket = () => {
    if (!socket) {
        let serverUrl;
        const explicitUrl = import.meta.env.VITE_SIGNALING_SERVER_URL || '';

        if (explicitUrl && !explicitUrl.includes('localhost')) {
            // Explicit non-localhost URL set (ngrok, production deployment, etc.)
            serverUrl = explicitUrl;
        } else if (window.location.port === '3001' || window.location.port === '') {
            // Page is being served BY the signaling server itself (single-port mode).
            // Connect to same origin — works for ngrok, LAN IP, public IP, all at once.
            serverUrl = window.location.origin;
        } else {
            // Dev mode: Vite (5173/5174) serves the client, server on 3001.
            // Use same hostname but port 3001.
            const hostname = window.location.hostname;
            serverUrl = `http://${hostname}:3001`;
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