// client/src/hooks/useClientWebRTC.js
import { useCallback, useEffect, useRef, useState } from 'react';
import { ICE_SERVERS } from '../utils/iceConfig';

export const useClientWebRTC = ({ socket, roomId, onStateChange }) => {
  const pcRef = useRef(null);
  const audioCtxRef = useRef(null);
  const gainNodeRef = useRef(null);
  const analyserRef = useRef(null);
  const animFrameRef = useRef(null);
  const hostIdRef = useRef(null);
  const iceCandidateQueue = useRef([]);
  const audioElRef = useRef(null);

  const [connectionState, setConnectionState] = useState('idle');
  const [gainValue, setGainValue] = useState(0.8);

  const buildAudioGraph = useCallback((track) => {
    const audioEl = new Audio();
    audioEl.srcObject = new MediaStream([track]);
    audioEl.volume = gainValue;
    audioEl.playsInline = true;
    audioElRef.current = audioEl;

    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 48000,
        latencyHint: 'interactive',
      });
    }

    const ctx = audioCtxRef.current;
    const source = ctx.createMediaStreamSource(new MediaStream([track]));

    const gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(gainValue, ctx.currentTime);
    gainNodeRef.current = gainNode;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyserRef.current = analyser;

    // VU meter graph only — NOT connected to ctx.destination (avoids earpiece routing on Android)
    source.connect(gainNode);
    gainNode.connect(analyser);

    console.log('[Client] Audio pipeline ready. AudioContext state:', ctx.state);
  }, [gainValue]);

  const setVolume = useCallback((value) => {
    setGainValue(value);
    if (gainNodeRef.current && audioCtxRef.current) {
      gainNodeRef.current.gain.setTargetAtTime(value, audioCtxRef.current.currentTime, 0.015);
    }
    if (audioElRef.current) {
      audioElRef.current.volume = Math.max(0, Math.min(1, value));
    }
  }, []);

  const createPeerConnection = useCallback(() => {
    if (pcRef.current) { pcRef.current.close(); pcRef.current = null; }

    const pc = new RTCPeerConnection(ICE_SERVERS);
    pcRef.current = pc;

    pc.onicecandidate = ({ candidate }) => {
      if (candidate && hostIdRef.current) {
        socket.emit('ice-candidate', { targetId: hostIdRef.current, candidate });
      }
    };

    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      console.log(`[Client ICE] ${state}`);
      const stateMap = {
        checking: 'connecting', connected: 'connected', completed: 'connected',
        failed: 'failed', disconnected: 'disconnected', closed: 'idle',
      };
      const mapped = stateMap[state] || state;
      setConnectionState(mapped);
      onStateChange?.(mapped);
      if (state === 'failed') { console.warn('[Client] ICE failed — restarting'); pc.restartIce(); }
    };

    pc.ontrack = ({ track }) => {
      console.log('[Client] Track received:', track.kind);
      if (track.kind !== 'audio') return;
      setConnectionState('connected');
      buildAudioGraph(track);
      track.onended = () => { console.log('[Client] Track ended'); setConnectionState('disconnected'); };
    };

    return pc;
  }, [socket, buildAudioGraph, onStateChange]);

  const handleOffer = useCallback(async ({ sdp, fromId }) => {
    console.log('[Client] Offer received from', fromId);
    hostIdRef.current = fromId;
    iceCandidateQueue.current = [];
    setConnectionState('signaling');

    const pc = createPeerConnection();
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));

      // Drain queued ICE candidates
      for (const c of iceCandidateQueue.current) {
        try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch (e) { /* safe */ }
      }
      iceCandidateQueue.current = [];

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('answer', { targetId: fromId, sdp: answer });
      console.log('[Client] Answer sent to host', fromId);
    } catch (err) {
      console.error('[Client] Offer/Answer failed:', err);
      setConnectionState('failed');
    }
  }, [createPeerConnection, socket]);

  const handleIceCandidate = useCallback(async ({ candidate }) => {
    if (!candidate) return;
    if (!pcRef.current || !pcRef.current.remoteDescription) {
      iceCandidateQueue.current.push(candidate);
      return;
    }
    try { await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate)); }
    catch (err) { console.warn('[Client] addIceCandidate error:', err.message); }
  }, []);

  // ── FIX: Check role — only react when the HOST disconnects, not other clients
  const handlePeerDisconnected = useCallback(({ peerId, role }) => {
    // If a CLIENT (not us, not the host) left the room, the server broadcasts
    // peer-disconnected to everyone including us. We must IGNORE it — we only
    // care if OUR host disconnected.
    if (role !== 'host') {
      console.log(`[Client] Another client (${peerId?.slice(0, 6)}) left — ignoring`);
      return;
    }

    console.log('[Client] Host disconnected');
    setConnectionState('disconnected');
    if (audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current.srcObject = null;
    }
    pcRef.current?.close();
    pcRef.current = null;
  }, []);

  useEffect(() => {
    if (!socket) return;
    socket.on('offer', handleOffer);
    socket.on('ice-candidate', handleIceCandidate);
    socket.on('peer-disconnected', handlePeerDisconnected);
    return () => {
      socket.off('offer', handleOffer);
      socket.off('ice-candidate', handleIceCandidate);
      socket.off('peer-disconnected', handlePeerDisconnected);
    };
  }, [socket, handleOffer, handleIceCandidate, handlePeerDisconnected]);

  const resumeAudioContext = useCallback(async () => {
    if (audioCtxRef.current?.state === 'suspended') {
      await audioCtxRef.current.resume();
      console.log('[Client] AudioContext resumed');
    }
    if (audioElRef.current) {
      try {
        await audioElRef.current.play();
        console.log('[Client] Audio element playing');
      } catch (err) {
        console.warn('[Client] Audio element play failed:', err.message);
      }
    }
  }, []);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(animFrameRef.current);
      pcRef.current?.close();
      audioCtxRef.current?.close();
      if (audioElRef.current) { audioElRef.current.pause(); audioElRef.current.srcObject = null; }
    };
  }, []);

  return { connectionState, gainValue, setVolume, resumeAudioContext, analyserRef, animFrameRef };
};