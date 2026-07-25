// client/src/components/Client.jsx
// Mobile client — receives the WebRTC audio stream from the host.
// Optimised for a phone screen opened by scanning the host's QR code.

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSocket } from '../hooks/useSocket';
import { useClientWebRTC } from '../hooks/useClientWebRTC';

// ── Connection state display config ───────────────────────────────────────
const STATE_CONFIG = {
  idle: { label: 'Waiting for host…', color: '#6b7280', icon: '○', showAudio: false },
  signaling: { label: 'Negotiating connection…', color: '#f59e0b', icon: '◌', showAudio: false },
  connecting: { label: 'Establishing P2P path…', color: '#f59e0b', icon: '◎', showAudio: false },
  connected: { label: 'Streaming live', color: '#22c55e', icon: '●', showAudio: true },
  failed: { label: 'Connection failed', color: '#ef4444', icon: '✕', showAudio: false },
  disconnected: { label: 'Host disconnected', color: '#f97316', icon: '◌', showAudio: false },
  server_offline: { label: 'Server offline / Maintenance', color: '#ef4444', icon: '⚠️', showAudio: false },
};

// ── Props ─────────────────────────────────────────────────────────────────
// roomId: string — extracted from the URL by App.jsx router
export default function Client({ roomId }) {
  const [hasJoined, setHasJoined] = useState(false);
  const [socketId, setSocketId] = useState(null);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [prevVolume, setPrevVolume] = useState(0.8);
  const [connectionState, setConnectionState] = useState('idle');
  const [isServerOffline, setIsServerOffline] = useState(false);

  const vuCanvasRef = useRef(null);
  const socket = useSocket();

  const {
    gainValue,
    setVolume,
    resumeAudioContext,
    analyserRef,
    animFrameRef,
  } = useClientWebRTC({
    socket,
    roomId,
    onStateChange: setConnectionState,
  });

  // ── Join the signaling room & monitor socket health ────────────────────────
  useEffect(() => {
    if (!socket) return;

    const joinRoom = () => {
      setIsServerOffline(false);
      socket.emit('join-room', { roomId, role: 'client' });
      console.log('[Client] Emitted join-room for', roomId);
    };

    const handleRoomJoined = ({ socketId: sid, participantCount }) => {
      setSocketId(sid);
      setHasJoined(true);
      setIsServerOffline(false);
      console.log(`[Client] Joined room. Socket: ${sid}, Participants: ${participantCount}`);
    };

    const handleConnectError = () => {
      console.warn('[Client] Socket connect_error — signaling server offline');
      setIsServerOffline(true);
    };

    socket.on('room-joined', handleRoomJoined);
    socket.on('connect_error', handleConnectError);
    socket.on('disconnect', handleConnectError);

    if (socket.connected) {
      joinRoom();
    } else {
      socket.once('connect', joinRoom);
    }

    // Timer check: if socket fails to connect within 5 seconds, mark server offline
    const timer = setTimeout(() => {
      if (!socket.connected && !hasJoined) {
        setIsServerOffline(true);
      }
    }, 5000);

    return () => {
      clearTimeout(timer);
      socket.off('room-joined', handleRoomJoined);
      socket.off('connect_error', handleConnectError);
      socket.off('disconnect', handleConnectError);
    };
  }, [socket, roomId, hasJoined]);

  // ── VU meter animation ─────────────────────────────────────────────────────
  const drawVuMeter = useCallback(() => {
    const canvas = vuCanvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;

    const ctx = canvas.getContext('2d');
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);

    const avg = data.slice(0, 128).reduce((a, b) => a + b, 0) / 128;
    const level = avg / 255;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const W = canvas.width;
    const H = canvas.height;
    const bars = 32;
    const barW = W / bars - 1.5;

    for (let i = 0; i < bars; i++) {
      // Each bar samples a slightly different frequency band for visual richness
      const binIndex = Math.floor((i / bars) * 64);
      const barLevel = (data[binIndex] / 255) * gainValue; // scale by gain
      const barH = Math.max(2, barLevel * H);
      const hue = 140 - i * (140 / bars);
      const alpha = isMuted ? 0.25 : 1;

      ctx.fillStyle = `hsla(${hue}, 80%, 52%, ${alpha})`;
      ctx.beginPath();
      ctx.roundRect(i * (barW + 1.5), H - barH, barW, barH, 2);
      ctx.fill();
    }

    animFrameRef.current = requestAnimationFrame(drawVuMeter);
  }, [analyserRef, animFrameRef, gainValue, isMuted]);

  // Start the VU animation when connected
  useEffect(() => {
    if (connectionState === 'connected' && audioUnlocked) {
      animFrameRef.current = requestAnimationFrame(drawVuMeter);
    } else {
      cancelAnimationFrame(animFrameRef.current);
    }
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [connectionState, audioUnlocked, drawVuMeter, animFrameRef]);

  // ── iOS/Android audio unlock ───────────────────────────────────────────────
  // Keep this behind an explicit tap. Some mobile browsers still require a
  // direct gesture for HTMLAudioElement playback even when AudioContext is running.
  const handleAudioUnlock = useCallback(async () => {
    try {
      await resumeAudioContext();
    } finally {
      setAudioUnlocked(true);
    }
  }, [resumeAudioContext]);

  // ── Mute toggle ───────────────────────────────────────────────────────────
  // Mute stores the previous volume and sets gain to 0. Un-mute restores it.
  // This keeps the slider position intact while muted — good UX pattern.
  const handleMuteToggle = useCallback(() => {
    if (isMuted) {
      setVolume(prevVolume);
      setIsMuted(false);
    } else {
      setPrevVolume(gainValue);
      setVolume(0);
      setIsMuted(true);
    }
  }, [isMuted, gainValue, prevVolume, setVolume]);

  const handleVolumeChange = useCallback((e) => {
    const v = parseFloat(e.target.value);
    setVolume(v);
    if (isMuted && v > 0) setIsMuted(false);
  }, [setVolume, isMuted]);

  const stateConfig = STATE_CONFIG[connectionState] || STATE_CONFIG.idle;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={S.page}>

      {/* Header */}
      <div style={S.header}>
        <span style={S.logo}>AudioSync</span>
        <span style={S.badge}>Client</span>
      </div>

      {/* Connection state card */}
      <div style={{ ...S.stateCard, borderColor: (isServerOffline ? '#ef4444' : stateConfig.color) + '44' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ ...S.stateIcon, color: isServerOffline ? '#ef4444' : stateConfig.color, animation: connectionState === 'connecting' || connectionState === 'signaling' ? 'spin 1.4s linear infinite' : 'none' }}>
            {isServerOffline ? '⚠️' : stateConfig.icon}
          </span>
          <div>
            <div style={{ ...S.stateLabel, color: isServerOffline ? '#ef4444' : stateConfig.color }}>
              {isServerOffline ? 'Server offline / Maintenance' : stateConfig.label}
            </div>
            {socketId && !isServerOffline && (
              <div style={S.socketHint}>
                ID: <code style={S.mono}>{socketId.slice(0, 12)}…</code>
              </div>
            )}
          </div>
        </div>

        {/* Retry button on failure or server offline */}
        {(connectionState === 'failed' || connectionState === 'disconnected' || isServerOffline) && (
          <button
            style={S.retryBtn}
            onClick={() => window.location.reload()}
          >
            Reconnect
          </button>
        )}
      </div>

      {/* Server Offline / Maintenance Details Card */}
      {isServerOffline && (
        <div style={{
          background: '#2a1a1a',
          border: '1px solid #7f1d1d',
          borderRadius: '16px',
          padding: '24px',
          marginTop: '16px',
          textAlign: 'center',
          color: '#fca5a5'
        }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🛠️</div>
          <h3 style={{ margin: '0 0 8px', fontSize: 18, color: '#f87171' }}>Signaling Server Offline</h3>
          <p style={{ margin: '0 0 16px', fontSize: 13, color: '#fca5a5', lineHeight: 1.5 }}>
            The AudioSync backend server is currently offline or undergoing maintenance. Please check back shortly.
          </p>
          <button
            style={{
              background: '#b91c1c',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              padding: '10px 20px',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer'
            }}
            onClick={() => window.location.reload()}
          >
            🔄 Reconnect Server
          </button>
        </div>
      )}

      {/* Audio unlock — shown when connected but not yet tapped.
          MUST be a real user tap so the <audio> element can call .play() */}
      {connectionState === 'connected' && !audioUnlocked && (
        <button style={S.unlockBtn} onClick={handleAudioUnlock}>
          <span style={{ fontSize: 32, display: 'block', marginBottom: 8 }}>🔊</span>
          Tap to hear audio
          <span style={S.unlockSub}>Required by Android &amp; iOS browsers before playing audio</span>
        </button>
      )}

      {/* Main audio controls — only shown once connected and audio unlocked */}
      {stateConfig.showAudio && audioUnlocked && (
        <div style={S.audioCard}>

          {/* Live indicator */}
          <div style={S.liveRow}>
            <span style={S.liveDot} />
            <span style={S.liveText}>Live audio</span>
            <span style={S.roomBadge}>Room: {roomId.slice(0, 8)}</span>
          </div>

          {/* VU Meter */}
          <canvas
            ref={vuCanvasRef}
            width={320}
            height={56}
            style={{
              ...S.vuCanvas,
              opacity: isMuted ? 0.3 : 1,
              transition: 'opacity 0.3s',
            }}
          />

          {/* Volume slider + mute row */}
          <div style={S.volumeRow}>
            <button
              style={{ ...S.muteBtn, color: isMuted ? '#ef4444' : '#94a3b8' }}
              onClick={handleMuteToggle}
              aria-label={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted ? '🔇' : '🔊'}
            </button>

            <div style={S.sliderTrack}>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={gainValue}
                onChange={handleVolumeChange}
                style={S.slider}
                aria-label="Volume"
              />
              {/* Filled portion indicator */}
              <div
                style={{
                  ...S.sliderFill,
                  width: `${gainValue * 100}%`,
                  opacity: isMuted ? 0.3 : 1,
                }}
              />
            </div>

            <span style={S.volumeLabel}>
              {isMuted ? 'Muted' : `${Math.round(gainValue * 100)}%`}
            </span>
          </div>

          {/* Audio info strip */}
          <div style={S.infoStrip}>
            <InfoPill label="Codec" value="Opus" />
            <InfoPill label="Transport" value="UDP / WebRTC" />
            <InfoPill label="Sample rate" value="48 kHz" />
            <InfoPill label="Channels" value="Stereo" />
          </div>
        </div>
      )}

      {/* Waiting state illustration */}
      {connectionState === 'idle' && (
        <div style={S.waitCard}>
          <div style={S.waitIcon}>📡</div>
          <p style={S.waitTitle}>Waiting for host</p>
          <p style={S.waitSub}>
            The host needs to open <strong>AudioSync</strong> on their laptop
            and start sharing audio. This page will connect automatically.
          </p>
          <div style={S.roomRow}>
            <span style={S.roomLabel}>Room</span>
            <code style={S.roomCode}>{roomId.slice(0, 8)}…</code>
          </div>
        </div>
      )}

      {/* Signaling / connecting state */}
      {(connectionState === 'signaling' || connectionState === 'connecting') && (
        <div style={S.waitCard}>
          <div style={{ ...S.waitIcon, animation: 'pulse 1.2s ease-in-out infinite' }}>🔗</div>
          <p style={S.waitTitle}>
            {connectionState === 'signaling' ? 'Exchanging credentials…' : 'Finding best path…'}
          </p>
          <p style={S.waitSub}>
            {connectionState === 'signaling'
              ? 'Completing WebRTC SDP handshake via signaling server.'
              : 'ICE agent is testing network paths (STUN/TURN). This usually takes under 2 seconds.'}
          </p>
        </div>
      )}

      {/* Disconnected state */}
      {connectionState === 'disconnected' && (
        <div style={S.waitCard}>
          <div style={S.waitIcon}>🔌</div>
          <p style={S.waitTitle}>Host disconnected</p>
          <p style={S.waitSub}>
            The host stopped sharing or lost their connection. Ask them to
            reload the AudioSync host page — you'll reconnect automatically
            when they rejoin this room.
          </p>
          <button style={S.retryBtn} onClick={() => window.location.reload()}>
            Reload &amp; wait
          </button>
        </div>
      )}

      {/* Inline CSS keyframes */}
      <style>{`
        @keyframes spin  { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
        input[type=range] { -webkit-appearance: none; appearance: none; background: transparent; cursor: pointer; width: 100%; }
        input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 22px; height: 22px; border-radius: 50%; background: #7c3aed; border: 2px solid #fff; margin-top: -9px; }
        input[type=range]::-webkit-slider-runnable-track { height: 4px; background: #2d2d44; border-radius: 2px; }
        input[type=range]::-moz-range-thumb { width: 22px; height: 22px; border-radius: 50%; background: #7c3aed; border: 2px solid #fff; }
        input[type=range]::-moz-range-track { height: 4px; background: #2d2d44; border-radius: 2px; }
      `}</style>
    </div>
  );
}

// ── Sub-component: info pill ───────────────────────────────────────────────
function InfoPill({ label, value }) {
  return (
    <div style={S.pill}>
      <span style={S.pillLabel}>{label}</span>
      <span style={S.pillValue}>{value}</span>
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────
// Mobile-first: max-width 480px, full bleed on small screens
const S = {
  page: {
    minHeight: '100dvh', // dvh = dynamic viewport height (accounts for mobile chrome bar)
    background: '#0a0a10',
    color: '#e2e8f0',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    padding: '20px 16px 40px',
    boxSizing: 'border-box',
    maxWidth: 480,
    margin: '0 auto',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 20,
  },
  logo: {
    fontSize: 20,
    fontWeight: 700,
    color: '#f1f5f9',
  },
  badge: {
    background: '#14532d',
    color: '#86efac',
    padding: '2px 10px',
    borderRadius: 99,
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
  },
  stateCard: {
    background: '#161622',
    border: '1px solid',
    borderRadius: 14,
    padding: '14px 16px',
    marginBottom: 16,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  stateIcon: {
    fontSize: 24,
    lineHeight: 1,
    display: 'inline-block',
    width: 28,
    textAlign: 'center',
    flexShrink: 0,
  },
  stateLabel: {
    fontSize: 15,
    fontWeight: 600,
    lineHeight: 1.3,
  },
  socketHint: {
    fontSize: 11,
    color: '#475569',
    marginTop: 2,
  },
  mono: {
    fontFamily: 'monospace',
    color: '#64748b',
  },
  retryBtn: {
    background: '#1e1e2e',
    border: '1px solid #2d2d44',
    color: '#c4b5fd',
    padding: '8px 14px',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 600,
    flexShrink: 0,
  },
  unlockBtn: {
    display: 'block',
    width: '100%',
    background: '#4c1d95',
    border: '2px solid #6d28d9',
    color: '#ede9fe',
    borderRadius: 16,
    padding: '28px 20px',
    cursor: 'pointer',
    fontSize: 18,
    fontWeight: 700,
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 1.4,
  },
  unlockSub: {
    display: 'block',
    fontSize: 12,
    fontWeight: 400,
    color: '#a78bfa',
    marginTop: 6,
  },
  audioCard: {
    background: '#161622',
    border: '1px solid #1e293b',
    borderRadius: 18,
    padding: '20px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 18,
  },
  liveRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: '#22c55e',
    boxShadow: '0 0 6px #22c55e99',
    animation: 'pulse 1.4s ease-in-out infinite',
    display: 'inline-block',
    flexShrink: 0,
  },
  liveText: {
    fontSize: 14,
    fontWeight: 600,
    color: '#22c55e',
    flex: 1,
  },
  roomBadge: {
    fontSize: 11,
    color: '#475569',
    fontFamily: 'monospace',
  },
  vuCanvas: {
    width: '100%',
    borderRadius: 8,
    display: 'block',
  },
  volumeRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  muteBtn: {
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    fontSize: 22,
    padding: 4,
    flexShrink: 0,
    lineHeight: 1,
  },
  sliderTrack: {
    flex: 1,
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
  },
  slider: {
    position: 'relative',
    zIndex: 1,
    width: '100%',
  },
  sliderFill: {
    position: 'absolute',
    left: 0,
    height: 4,
    background: '#7c3aed',
    borderRadius: 2,
    pointerEvents: 'none',
    zIndex: 0,
    transition: 'opacity 0.3s',
  },
  volumeLabel: {
    fontSize: 13,
    fontWeight: 600,
    color: '#94a3b8',
    minWidth: 44,
    textAlign: 'right',
    flexShrink: 0,
  },
  infoStrip: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 8,
  },
  pill: {
    background: '#0f0f18',
    borderRadius: 8,
    padding: '8px 10px',
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  pillLabel: {
    fontSize: 10,
    color: '#475569',
    textTransform: 'uppercase',
    letterSpacing: '0.07em',
  },
  pillValue: {
    fontSize: 13,
    fontWeight: 600,
    color: '#94a3b8',
  },
  waitCard: {
    background: '#161622',
    border: '1px solid #1e293b',
    borderRadius: 18,
    padding: '28px 20px',
    textAlign: 'center',
  },
  waitIcon: {
    fontSize: 40,
    display: 'block',
    marginBottom: 12,
    lineHeight: 1,
  },
  waitTitle: {
    margin: '0 0 8px',
    fontSize: 18,
    fontWeight: 700,
    color: '#f1f5f9',
  },
  waitSub: {
    margin: '0 0 18px',
    fontSize: 14,
    color: '#64748b',
    lineHeight: 1.6,
  },
  roomRow: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    background: '#0f0f18',
    padding: '6px 12px',
    borderRadius: 8,
  },
  roomLabel: {
    fontSize: 11,
    color: '#475569',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  },
  roomCode: {
    fontSize: 13,
    fontFamily: 'monospace',
    color: '#7c3aed',
  },
};