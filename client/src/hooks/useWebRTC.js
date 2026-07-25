// client/src/hooks/useWebRTC.js
// Host-side WebRTC orchestration hook.
//
// ARCHITECTURE — why a Map of PeerConnections:
//   In a P2P mesh, the host maintains N separate RTCPeerConnection objects,
//   one per client. Each connection has its own ICE gathering state, DTLS
//   handshake, and SRTP session. This is why mesh topology caps at ~5 users —
//   the host's upload bandwidth is split N ways.
//
//   For >10 users, the correct architecture shifts to SFU (Selective Forwarding
//   Unit) — one server-side connection that fans out. Out of scope here.

import { useCallback, useEffect, useRef } from 'react';
import { ICE_SERVERS } from '../utils/iceConfig';

export const useWebRTC = ({ socket, localStream, onConnectionChange }) => {
  // Map<clientSocketId, RTCPeerConnection>
  const peerConnections = useRef(new Map());

  // ── Helper: create and configure a new RTCPeerConnection ─────────────────
  const createPeerConnection = useCallback(
    (clientId) => {
      const pc = new RTCPeerConnection(ICE_SERVERS);

      // ── 1. Add the local audio track to this connection ──────────────────
      // We add tracks BEFORE creating the offer so the SDP includes our
      // audio codec preferences (Opus). Adding tracks after createOffer
      // would require a re-negotiation round-trip.
      if (localStream) {
        localStream.getTracks().forEach((track) => {
          pc.addTrack(track, localStream);
        });
      }

      // ── 2. Trickle ICE — forward candidates to the target client ─────────
      // onicecandidate fires once per discovered candidate (host, srflx, relay).
      // We forward each one immediately as it arrives ("trickle") rather than
      // waiting for gathering to complete. This cuts connection setup time by
      // ~300ms on average because the remote peer can start connectivity
      // checks while gathering continues in parallel.
      pc.onicecandidate = ({ candidate }) => {
        if (candidate) {
          socket.emit('ice-candidate', { targetId: clientId, candidate });
        }
        // candidate === null signals ICE gathering complete — server.js
        // already handles this gracefully (silent drop).
      };

      // ── 3. Monitor ICE connection state ───────────────────────────────────
      // ICE states: new → checking → connected → completed
      // Failure states: failed → disconnected → closed
      pc.oniceconnectionstatechange = () => {
        const state = pc.iceConnectionState;
        console.log(`[ICE:${clientId.slice(0, 6)}] ${state}`);
        onConnectionChange?.(clientId, state);

        // If ICE fails (symmetric NAT, no TURN), attempt an ICE restart.
        // An ICE restart generates new ICE credentials and re-gathers candidates
        // without closing the DTLS session — less disruptive than a full reconnect.
        if (state === 'failed') {
          console.warn(`[ICE:${clientId.slice(0, 6)}] Failed — attempting ICE restart`);
          pc.restartIce();
        }
      };

      // ── 4. Store in map ───────────────────────────────────────────────────
      peerConnections.current.set(clientId, pc);
      return pc;
    },
    [socket, localStream, onConnectionChange]
  );

  // ── Handler: new client joined — HOST initiates the offer ────────────────
  // The host ALWAYS creates the offer. This is a WebRTC convention: the party
  // that knows a new participant has arrived (via signaling) makes the offer.
  const handleClientJoined = useCallback(
    async ({ clientId }) => {
      console.log(`[Host] New client: ${clientId} — creating offer`);

      // Close any stale connection for this clientId (e.g., client refreshed)
      const stale = peerConnections.current.get(clientId);
      if (stale) stale.close();

      const pc = createPeerConnection(clientId);

      try {
        // createOffer generates an SDP (Session Description Protocol) blob
        // containing: supported codecs, DTLS fingerprint, ICE ufrag/pwd.
        // For audio-only, we suppress video to reduce SDP size and prevent
        // unnecessary video codec negotiation.
        const offer = await pc.createOffer({
          offerToReceiveAudio: false, // Host sends, client receives — not vice versa
          offerToReceiveVideo: false,
        });

        // setLocalDescription triggers ICE gathering to begin. We set it
        // BEFORE emitting so ICE candidates don't fire before the remote
        // peer has set our offer as their remoteDescription.
        await pc.setLocalDescription(offer);

        socket.emit('offer', { targetId: clientId, sdp: offer });
        console.log(`[Host] Offer sent to ${clientId}`);
      } catch (err) {
        console.error('[Host] Failed to create offer:', err);
      }
    },
    [createPeerConnection, socket]
  );

  // Whenever localStream becomes available or changes, update tracks on all existing peer connections
  useEffect(() => {
    if (!localStream) return;

    peerConnections.current.forEach((pc, clientId) => {
      const senders = pc.getSenders();
      const hasAudioTrack = senders.some((sender) => sender.track?.kind === 'audio');

      if (!hasAudioTrack) {
        localStream.getAudioTracks().forEach((track) => {
          pc.addTrack(track, localStream);
        });

        (async () => {
          try {
            const offer = await pc.createOffer({
              offerToReceiveAudio: false,
              offerToReceiveVideo: false,
            });
            await pc.setLocalDescription(offer);
            socket.emit('offer', { targetId: clientId, sdp: offer });
            console.log(`[Host] Re-negotiated offer with audio track to ${clientId}`);
          } catch (err) {
            console.error('[Host] Offer renegotiation error:', err);
          }
        })();
      }
    });
  }, [localStream, socket]);

  // ── Handler: answer received from a client ────────────────────────────────
  const handleAnswer = useCallback(async ({ sdp, fromId }) => {
    const pc = peerConnections.current.get(fromId);
    if (!pc) return console.warn(`[Host] Answer from unknown client: ${fromId}`);

    try {
      // setRemoteDescription completes the SDP handshake. After this, ICE
      // connectivity checks begin using the candidates both sides are trickling.
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      console.log(`[Host] Answer accepted from ${fromId}`);
    } catch (err) {
      console.error('[Host] Failed to set remote description:', err);
    }
  }, []);

  // ── Handler: ICE candidate from a client ──────────────────────────────────
  const handleIceCandidate = useCallback(async ({ candidate, fromId }) => {
    const pc = peerConnections.current.get(fromId);
    if (!pc) return;

    try {
      // addIceCandidate feeds the remote peer's network addresses into the
      // ICE agent. It runs STUN connectivity checks for each candidate pair
      // (our candidate × their candidate) to find the best working path.
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      // Can happen if addIceCandidate is called before setRemoteDescription.
      // Safe to ignore — the candidate is simply discarded.
      console.warn('[Host] addIceCandidate error (safe to ignore):', err.message);
    }
  }, []);

  // ── Handler: peer disconnected ────────────────────────────────────────────
  const handlePeerDisconnected = useCallback(({ peerId }) => {
    const pc = peerConnections.current.get(peerId);
    if (pc) {
      pc.close();
      peerConnections.current.delete(peerId);
      onConnectionChange?.(peerId, 'closed');
      console.log(`[Host] Closed connection for ${peerId}`);
    }
  }, [onConnectionChange]);

  // ── Register/unregister all socket listeners ──────────────────────────────
  useEffect(() => {
    if (!socket) return;

    socket.on('client-joined', handleClientJoined);
    socket.on('answer', handleAnswer);
    socket.on('ice-candidate', handleIceCandidate);
    socket.on('peer-disconnected', handlePeerDisconnected);

    return () => {
      socket.off('client-joined', handleClientJoined);
      socket.off('answer', handleAnswer);
      socket.off('ice-candidate', handleIceCandidate);
      socket.off('peer-disconnected', handlePeerDisconnected);
    };
  }, [socket, handleClientJoined, handleAnswer, handleIceCandidate, handlePeerDisconnected]);

  // ── Cleanup: close all peer connections on unmount ────────────────────────
  useEffect(() => {
    return () => {
      peerConnections.current.forEach((pc) => pc.close());
      peerConnections.current.clear();
    };
  }, []);

  return { peerConnections };
};