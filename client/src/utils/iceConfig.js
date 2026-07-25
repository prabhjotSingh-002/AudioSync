// client/src/utils/iceConfig.js
// ICE server config for NAT traversal.
//
// For cross-network (cellular ↔ LAN) connections, STUN alone is NOT enough.
// STUN only works when both peers have compatible NAT types (~70% of cases).
// TURN is a relay server that works for ALL network types — the audio flows
// through it when a direct path can't be established.
//
// We list multiple TURN providers as fallbacks. The browser races them and
// uses whichever responds first. This makes cross-network connections reliable.

export const ICE_SERVERS = {
  iceServers: [
    // ── STUN servers (free, no relay — works for same-network / simple NAT) ──
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },

    // ── TURN Provider 1: Open Relay (metered.ca) ─────────────────────────────
    // Port 80 is the most firewall-friendly — almost always open on mobile data
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    // TLS variant — bypasses deep packet inspection on strict networks
    {
      urls: 'turns:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },

    // ── TURN Provider 2: Metered.ca global relay (separate endpoint) ─────────
    // Different infrastructure from Provider 1 — true fallback
    {
      urls: 'turn:a.relay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:a.relay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turns:a.relay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },

    // ── TURN Provider 3: ExpressTurn (free tier, different datacenter) ────────
    {
      urls: 'turn:relay1.expressturn.com:3480',
      username: 'efEFLZOT7DPII1N62Y',
      credential: 'U6jXGYFGjXJSxMpB',
    },
  ],

  // Uncomment this during debugging to FORCE TURN-only mode.
  // If connection works with this on, your TURN servers are fine.
  // REMOVE before production — it disables direct P2P even when available.
  // iceTransportPolicy: 'relay',
};
