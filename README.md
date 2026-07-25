# AudioSync

Local Network Audio Bridge scaffold.

## Structure

- client: Vite + React frontend
- server: Node.js signaling server

## Planned signaling flow

HOST                    SIGNALING SERVER               CLIENT
 |                            |                           |
 |-- join-room(roomId) ------>|                           |
 |<- room-joined(hostId) -----|                           |
 |                            |<-- join-room(roomId) -----|
 |                            |-- client-joined --------->| HOST
 |                            |                           |
 |-- offer(sdp) ------------->|-- offer(sdp) ------------>| 
 |                            |                           |
 |<- answer(sdp) -------------|<- answer(sdp) ------------|
 |                            |                           |
 |-- ice-candidate ---------->|-- ice-candidate --------->|
 |<- ice-candidate -----------|<- ice-candidate ----------|
 |                            |                           |
 |======= P2P Audio Stream (UDP, bypasses server) ========|
