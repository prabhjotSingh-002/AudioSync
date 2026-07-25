# 🎵 AudioSync

> **Real-Time Ultra-Low Latency Audio Synchronization & P2P Streaming Engine**

AudioSync is a real-time web application built to stream desktop system audio to multiple mobile devices simultaneously with sub-10ms latency. Designed for silent cinema, shared movie listening in dorm rooms, and synchronized multi-device audio playback over local networks and WebRTC P2P streams.

---

## ✨ Features

- **⚡ Ultra-Low Latency Streaming**: Direct P2P WebRTC audio pipeline ensuring zero audio lag (sub-10ms on LAN).
- **📲 Instant QR Code Join**: Host desktop generates a dynamic QR Code for instant mobile client connection.
- **📊 Real-time VU Visualizer**: Dynamic HTML5 Canvas multi-frequency audio visualizer driven by Web Audio API (`AnalyserNode`).
- **🌐 NAT & Firewall Traversal**: STUN + Multi-Provider TURN relays (`metered.ca`) for cross-network (5G/4G to Wi-Fi) streaming.
- **🔊 Smart Audio Routing**: Custom AudioContext graph preventing mobile earpiece routing issues on Android & iOS devices.

---

## 🛠️ Tech Stack

- **Frontend**: React, Vite, Web Audio API, Canvas API, Socket.io-client, `qrcode.react`
- **Backend**: Node.js, Express.js, Socket.io (Signaling Server)
- **Protocols**: WebRTC (RTCPeerConnection, SDP Offer/Answer, ICE Candidates), WebSockets (WSS)

---

## 🏗️ System Architecture

```
HOST (Desktop Media) ──────── WebRTC P2P (Opus Audio Stream) ────────> CLIENT (Mobile Earphones)
         │                                                                   │
         └───────────── Socket.io Signaling Server (Node.js) ────────────────┘
```

### Signaling Flow
1. **Host** starts audio capture via `getDisplayMedia` and joins a unique room.
2. **Client** scans the host's QR code and joins the same room.
3. **Signaling Server** relays WebRTC SDP Offer/Answer and ICE candidates.
4. **P2P Audio Connection** is established directly between Host and Client.

---

## 🚀 Local Quickstart

### 1. Start Signaling Server
```bash
cd server
npm run dev
```

### 2. Start Client Frontend
```bash
cd client
npm run dev
```

Open `https://localhost:5173` on host desktop, click **Start Sharing Audio**, and scan the QR code using any smartphone.

---

## 📄 License
MIT License. Created for high-performance real-time media streaming.
