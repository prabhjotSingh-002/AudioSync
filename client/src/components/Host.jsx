// client/src/components/Host.jsx
// The Host view — captures system audio and streams it to connected clients.

import { useState, useEffect, useRef, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { v4 as uuidv4 } from 'uuid';
import { useSocket } from '../hooks/useSocket';
import { useWebRTC } from '../hooks/useWebRTC';

// ── Constants ─────────────────────────────────────────────────────────────
// ICE state → human-readable label + colour class
const ICE_STATE_META = {
    new: { label: 'Waiting', color: '#888' },
    checking: { label: 'Connecting…', color: '#f59e0b' },
    connected: { label: 'Connected', color: '#22c55e' },
    completed: { label: 'Stable', color: '#22c55e' },
    failed: { label: 'Failed', color: '#ef4444' },
    disconnected: { label: 'Lost', color: '#f97316' },
    closed: { label: 'Closed', color: '#6b7280' },
};

export default function Host() {
    // ── State ─────────────────────────────────────────────────────────────────
    const [roomId] = useState(() => uuidv4()); // stable across re-renders
    const [roomUrl, setRoomUrl] = useState('');
    const [isCapturing, setIsCapturing] = useState(false);
    const [captureError, setCaptureError] = useState(null);
    const [socketId, setSocketId] = useState(null);
    const [isInRoom, setIsInRoom] = useState(false);

    // Map<clientSocketId, { state: ICEConnectionState }>
    const [clients, setClients] = useState(new Map());

    // ── Refs ──────────────────────────────────────────────────────────────────
    // FIX: localStreamRef is kept for imperative track-stopping in stopCapture,
    //      but localStream STATE is what gets passed to useWebRTC so the hook
    //      re-runs when the stream becomes available (refs don't trigger re-renders).
    const localStreamRef = useRef(null); // MediaStream from getDisplayMedia (imperative use)
    const audioContextRef = useRef(null); // AudioContext for local monitoring
    const analyserRef = useRef(null); // AnalyserNode for the VU meter
    const animFrameRef = useRef(null); // requestAnimationFrame handle
    const vuCanvasRef = useRef(null); // <canvas> for the VU meter bars

    // FIX: This state drives useWebRTC so it sees the real stream on re-render
    const [localStream, setLocalStream] = useState(null);

    // ── Hooks ─────────────────────────────────────────────────────────────────
    const socket = useSocket();

    // onConnectionChange — updates the client map when ICE state changes
    const handleConnectionChange = useCallback((clientId, state) => {
        setClients((prev) => {
            const next = new Map(prev);
            if (state === 'closed') {
                next.delete(clientId);
            } else {
                next.set(clientId, { state });
            }
            return next;
        });
    }, []);

    useWebRTC({
        socket,
        localStream,          // FIX: use state, not ref.current
        onConnectionChange: handleConnectionChange,
    });

    // ── Build room URL ─────────────────────────────────────────────────────────
    useEffect(() => {
        let base = window.location.origin;

        // If the host is developing on localhost (required for getDisplayMedia to work securely limitlessly),
        // the generated QR code MUST point to the LAN IP so the phone can scan and reach it over the local network.
        if (base.includes('localhost') && import.meta.env.VITE_LAN_IP) {
            base = `http://${import.meta.env.VITE_LAN_IP}:${window.location.port}`;
        }

        setRoomUrl(`${base}/room/${roomId}`);
    }, [roomId]);

    // ── Join signaling room ────────────────────────────────────────────────────
    useEffect(() => {
        if (!socket) return;

        const handleRoomJoined = ({ socketId: sid }) => {
            setSocketId(sid);
            setIsInRoom(true);
            console.log(`[Host] Joined room ${roomId} as ${sid}`);
        };

        const handleClientJoined = ({ clientId }) => {
            // Pre-populate the client entry so it appears immediately in the UI
            setClients((prev) => new Map(prev).set(clientId, { state: 'checking' }));
        };

        socket.on('room-joined', handleRoomJoined);
        socket.on('client-joined', handleClientJoined);

        // Emit join as soon as the socket is connected (or immediately if already connected)
        const joinRoom = () => socket.emit('join-room', { roomId, role: 'host' });
        if (socket.connected) {
            joinRoom();
        } else {
            socket.once('connect', joinRoom);
        }

        return () => {
            socket.off('room-joined', handleRoomJoined);
            socket.off('client-joined', handleClientJoined);
            socket.off('connect', joinRoom);
        };
    }, [socket, roomId]);

    // ── VU Meter animation ─────────────────────────────────────────────────────
    const drawVuMeter = useCallback(() => {
        const canvas = vuCanvasRef.current;
        const analyser = analyserRef.current;
        if (!canvas || !analyser) return;

        const ctx = canvas.getContext('2d');
        const data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);

        // Average the first 128 bins (bass + mids) — most musical content
        const avg = data.slice(0, 128).reduce((a, b) => a + b, 0) / 128;
        const level = avg / 255; // normalise 0–1

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const barCount = 24;
        const barW = canvas.width / barCount - 2;

        for (let i = 0; i < barCount; i++) {
            const barLevel = Math.max(0, level - i * (1 / barCount));
            const barH = barLevel * canvas.height * barCount;
            const hue = 120 - i * (120 / barCount); // green → yellow → red
            ctx.fillStyle = `hsl(${hue}, 85%, 50%)`;
            ctx.fillRect(i * (barW + 2), canvas.height - barH, barW, barH);
        }

        animFrameRef.current = requestAnimationFrame(drawVuMeter);
    }, []);

    // ── Start / Stop audio capture ─────────────────────────────────────────────
    const startCapture = useCallback(async () => {
        setCaptureError(null);

        // ── Secure context check ───────────────────────────────────────────────
        // getDisplayMedia only works on HTTPS or localhost (browser security rule).
        // With the updated vite.config.js (basicSsl plugin), all URLs are HTTPS
        // so this should never trigger. Kept as a safety net.
        if (!window.isSecureContext || !navigator.mediaDevices?.getDisplayMedia) {
            setCaptureError(
                'Audio capture requires a secure connection. ' +
                'Make sure you opened AudioSync via https:// (not http://). ' +
                'If you see a certificate warning, click "Advanced → Proceed anyway".'
            );
            return;
        }

        try {
            let stream;
            try {
                stream = await navigator.mediaDevices.getDisplayMedia({
                    video: false,
                    audio: {
                        echoCancellation: false,
                        noiseSuppression: false,
                        autoGainControl: false,
                        suppressLocalAudioPlayback: true,
                        sampleRate: 48000,
                        channelCount: 2,
                    },
                });
            } catch (err) {
                if (err.name !== 'NotSupportedError' && err.name !== 'TypeError') throw err;
                stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
                stream.getVideoTracks().forEach((track) => track.stop());
            }

            if (stream.getAudioTracks().length === 0) {
                stream.getTracks().forEach((track) => track.stop());
                throw new Error('No audio track received. Select a browser tab and enable "Share tab audio".');
            }

            localStreamRef.current = stream;
            setLocalStream(stream);
            setIsCapturing(true);

            audioContextRef.current = new AudioContext({ sampleRate: 48000 });
            const source = audioContextRef.current.createMediaStreamSource(stream);
            const analyser = audioContextRef.current.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);
            analyserRef.current = analyser;
            animFrameRef.current = requestAnimationFrame(drawVuMeter);

            stream.getAudioTracks()[0].onended = stopCapture;
            console.log('[Host] Audio capture started');
        } catch (err) {
            if (err.name === 'NotAllowedError') {
                setCaptureError('Permission denied. Please allow screen sharing and check "Share tab audio".');
            } else if (err.name === 'NotFoundError') {
                setCaptureError('No audio source found. Make sure to select a tab or window with audio.');
            } else if (err.name === 'NotSupportedError') {
                setCaptureError('This browser cannot capture audio. Use Chrome or Edge on desktop.');
            } else {
                setCaptureError(`Capture failed: ${err.message}`);
            }
        }
    }, [drawVuMeter]);

    const stopCapture = useCallback(() => {
        localStreamRef.current?.getTracks().forEach((t) => t.stop());
        localStreamRef.current = null;
        setLocalStream(null);  // FIX: clear state so useWebRTC knows stream is gone

        cancelAnimationFrame(animFrameRef.current);
        audioContextRef.current?.close();

        setIsCapturing(false);
        console.log('[Host] Audio capture stopped');
    }, []);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            stopCapture();
        };
    }, [stopCapture]);

    // ── Render ─────────────────────────────────────────────────────────────────
    return (
        <div style={styles.page}>
            <header style={styles.header}>
                <h1 style={styles.title}>🎵 AudioSync</h1>
                <span style={styles.badge}>Host</span>
            </header>

            {/* ── Status bar ── */}
            <div style={styles.statusBar}>
                <StatusDot active={isInRoom} label={isInRoom ? `Signaling ready · ${socketId?.slice(0, 8)}` : 'Connecting to signaling server…'} />
                <StatusDot active={isCapturing} label={isCapturing ? 'Audio capturing' : 'Audio not started'} />
            </div>

            {/* ── Two-column layout ── */}
            <div style={styles.grid}>

                {/* LEFT: QR Code + URL */}
                <section style={styles.card}>
                    <h2 style={styles.cardTitle}>Scan to connect</h2>
                    <p style={styles.cardSub}>Mobile client scans this QR code to join the room instantly.</p>

                    <div style={styles.qrWrapper}>
                        {roomUrl ? (
                            <QRCodeSVG
                                value={roomUrl}
                                size={200}
                                level="M"              // Error correction level M (15%) — good balance
                                includeMargin={true}
                                bgColor="transparent"
                                fgColor="currentColor"
                            />
                        ) : (
                            <div style={styles.qrPlaceholder}>Generating…</div>
                        )}
                    </div>

                    <div style={styles.urlBox}>
                        <code style={styles.urlText}>{roomUrl}</code>
                        <button
                            style={styles.copyBtn}
                            onClick={() => navigator.clipboard.writeText(roomUrl)}
                        >
                            Copy
                        </button>
                    </div>

                    <p style={styles.hint}>Room ID: <code>{roomId.slice(0, 8)}…</code></p>
                </section>

                {/* RIGHT: Capture controls + VU meter + client list */}
                <section style={styles.card}>
                    <h2 style={styles.cardTitle}>Audio source</h2>

                    <button
                        style={{
                            ...styles.captureBtn,
                            background: isCapturing ? '#ef4444' : '#6d28d9',
                        }}
                        onClick={isCapturing ? stopCapture : startCapture}
                    >
                        {isCapturing ? '⏹ Stop sharing' : '🎤 Start sharing audio'}
                    </button>

                    {captureError && (
                        <div style={styles.errorBox}>
                            ⚠️ {captureError}
                        </div>
                    )}

                    {/* VU Meter */}
                    <div style={styles.vuSection}>
                        <p style={styles.vuLabel}>
                            {isCapturing ? 'Live audio level' : 'No signal'}
                        </p>
                        <canvas
                            ref={vuCanvasRef}
                            width={280}
                            height={48}
                            style={{
                                ...styles.vuCanvas,
                                opacity: isCapturing ? 1 : 0.2,
                            }}
                        />
                    </div>

                    {/* Connected clients */}
                    <div style={styles.clientSection}>
                        <h3 style={styles.clientTitle}>
                            Connected clients ({clients.size})
                        </h3>
                        {clients.size === 0 ? (
                            <p style={styles.noClients}>
                                Waiting for clients to scan the QR code…
                            </p>
                        ) : (
                            <ul style={styles.clientList}>
                                {[...clients.entries()].map(([id, { state }]) => {
                                    const meta = ICE_STATE_META[state] || ICE_STATE_META.new;
                                    return (
                                        <li key={id} style={styles.clientItem}>
                                            <span style={{ ...styles.clientDot, background: meta.color }} />
                                            <span style={styles.clientId}>{id.slice(0, 10)}…</span>
                                            <span style={{ ...styles.clientState, color: meta.color }}>
                                                {meta.label}
                                            </span>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>

                    {/* Browser compatibility notice */}
                    <div style={styles.noteBox}>
                        <strong>Browser note:</strong> Use Chrome or Edge. When prompted,
                        select the tab playing audio and check "Share tab audio".
                        Firefox and Safari have limited system audio capture support.
                    </div>
                </section>
            </div>
        </div>
    );
}

// ── Sub-component: status dot ─────────────────────────────────────────────
function StatusDot({ active, label }) {
    return (
        <div style={styles.statusItem}>
            <span style={{
                ...styles.dot,
                background: active ? '#22c55e' : '#6b7280',
                boxShadow: active ? '0 0 6px #22c55e88' : 'none',
            }} />
            <span style={styles.statusLabel}>{label}</span>
        </div>
    );
}

// ── Styles (plain JS objects — no CSS-in-JS lib needed) ───────────────────
const styles = {
    page: {
        minHeight: '100vh',
        background: '#0f0f13',
        color: '#e2e8f0',
        fontFamily: 'system-ui, sans-serif',
        padding: '24px',
        boxSizing: 'border-box',
    },
    header: {
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        marginBottom: '16px',
    },
    title: {
        margin: 0,
        fontSize: '24px',
        fontWeight: 700,
        color: '#f1f5f9',
    },
    badge: {
        background: '#6d28d9',
        color: '#ede9fe',
        padding: '2px 10px',
        borderRadius: '99px',
        fontSize: '12px',
        fontWeight: 600,
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
    },
    statusBar: {
        display: 'flex',
        gap: '24px',
        marginBottom: '24px',
        padding: '10px 16px',
        background: '#1e1e2e',
        borderRadius: '10px',
        flexWrap: 'wrap',
    },
    statusItem: { display: 'flex', alignItems: 'center', gap: '8px' },
    dot: {
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        flexShrink: 0,
        transition: 'background 0.3s, box-shadow 0.3s',
    },
    statusLabel: { fontSize: '13px', color: '#94a3b8' },
    grid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
        gap: '20px',
    },
    card: {
        background: '#1e1e2e',
        borderRadius: '16px',
        padding: '24px',
        border: '1px solid #2d2d44',
    },
    cardTitle: {
        margin: '0 0 6px',
        fontSize: '18px',
        fontWeight: 600,
        color: '#f1f5f9',
    },
    cardSub: {
        margin: '0 0 20px',
        fontSize: '13px',
        color: '#64748b',
        lineHeight: 1.5,
    },
    qrWrapper: {
        display: 'flex',
        justifyContent: 'center',
        background: '#fff',
        borderRadius: '12px',
        padding: '16px',
        marginBottom: '16px',
        color: '#0f0f13',
    },
    qrPlaceholder: {
        width: 200,
        height: 200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#9ca3af',
        fontSize: '14px',
    },
    urlBox: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        background: '#0f0f13',
        border: '1px solid #2d2d44',
        borderRadius: '8px',
        padding: '8px 12px',
        marginBottom: '8px',
        overflow: 'hidden',
    },
    urlText: {
        flex: 1,
        fontSize: '11px',
        color: '#94a3b8',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        fontFamily: 'monospace',
    },
    copyBtn: {
        background: '#2d2d44',
        border: 'none',
        color: '#c4b5fd',
        padding: '4px 10px',
        borderRadius: '6px',
        cursor: 'pointer',
        fontSize: '12px',
        fontWeight: 600,
        flexShrink: 0,
    },
    hint: { fontSize: '12px', color: '#475569', margin: 0 },
    captureBtn: {
        width: '100%',
        padding: '14px',
        border: 'none',
        borderRadius: '10px',
        color: '#fff',
        fontSize: '15px',
        fontWeight: 600,
        cursor: 'pointer',
        marginBottom: '16px',
        transition: 'background 0.2s, transform 0.1s',
    },
    errorBox: {
        background: '#3f1515',
        border: '1px solid #7f1d1d',
        borderRadius: '8px',
        padding: '12px',
        fontSize: '13px',
        color: '#fca5a5',
        marginBottom: '16px',
        lineHeight: 1.5,
    },
    vuSection: { marginBottom: '20px' },
    vuLabel: {
        fontSize: '12px',
        color: '#64748b',
        marginBottom: '8px',
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
    },
    vuCanvas: {
        width: '100%',
        borderRadius: '6px',
        transition: 'opacity 0.4s',
    },
    clientSection: { borderTop: '1px solid #2d2d44', paddingTop: '16px' },
    clientTitle: {
        margin: '0 0 12px',
        fontSize: '14px',
        fontWeight: 600,
        color: '#94a3b8',
    },
    noClients: { fontSize: '13px', color: '#475569', fontStyle: 'italic' },
    clientList: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' },
    clientItem: {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        background: '#0f0f13',
        padding: '8px 12px',
        borderRadius: '8px',
    },
    clientDot: { width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0 },
    clientId: { flex: 1, fontSize: '12px', fontFamily: 'monospace', color: '#64748b' },
    clientState: { fontSize: '12px', fontWeight: 600 },
    noteBox: {
        marginTop: '16px',
        background: '#1a1a2e',
        border: '1px solid #2d2d44',
        borderRadius: '8px',
        padding: '12px',
        fontSize: '12px',
        color: '#64748b',
        lineHeight: 1.6,
    },
};