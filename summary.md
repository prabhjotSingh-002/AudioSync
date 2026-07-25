# AudioSync Project Summary

Yeh document project ka ek detailed overview aur working mechanism explain karta hai.

## 1. Project Overview
Yeh ek **Real-time Audio Synchronization / Streaming Application** hai jisme ek Host device apna audio (ya media stream) network/internet par multiple client devices ke paas stream karta hai bina kisi noticeable delay ke. Yeh WebRTC aur Socket.io par based hai taaki P2P (Peer-to-Peer) communication establish ho sake.

---

## 2. Technology Stack
**Frontend (Client):**
- **React.js & Vite:** UI aur fast development ke liye.
- **WebRTC (Web Real-Time Communication):** Real-time audio streaming (P2P protocol) ke liye.
- **Socket.io-client:** Signaling server se connect karne aur rooms maintain karne ke liye.
- **qrcode.react:** Host se directly room link scan karke clients ko connect karwane ke liye.

**Backend (Signaling Server):**
- **Node.js & Express.js:** Server runtime aur API structure.
- **Socket.io:** Real-time bi-directional events (Offers, Answers, ICE Candidates, Room management) exchange karne ke liye.

---

## 3. Working Mechanism: Local / LAN vs Internet

### A. Localhost ya Same LAN (Wi-Fi) par working
Jab host aur client dono ek hi Wi-Fi router / LAN se connected hain ya same PC (localhost) par hain:
- **Direct P2P Connection:** WebRTC Host aur Client ke Local IP addresses (jaise `192.168.x.x` ya `127.0.0.1`) ko discover kar leta hai (Host candidates).
- **Fast Speed & No Setup:** STUN server ki khaas zarurat nahi parti kyuki router ke andar hi data transfer ho jata hai, directly ek device se dusre device par. Latency bilkul almost zero hoti hai.

### B. Internet par working (Different Networks)
Jab host delhi me ho aur client mumbai me (alag alag network par):
- **NAT / Firewalls:** Devices direct private IP (`192.168.x.x`) se connect nahi ho sakte internet ke through kyuki NAT (Network Address Translation) IPs ko mask kar deta hai.
- **STUN Server:** STUN server (jaise Google ka free STUN server `stun:stun.l.google.com:19302`) host aur client ko unka **Public IP Address** and Port discover karne me help karta hai.
- **TURN Server (Fallback):** Agar strict firewalls/Symmetric NAT hai internet par jo direct P2P P2P WebRTC data ko block karta hai, toh ek TURN server ki zarurat padti hai jo data (audio packets) ko relay karta hai Host se Client tak.

---

## 4. Architecture: Kya kya kaise work kar raha hai? (Step-by-Step)

Project main teen phases me kaam karta hai: Room Entry, Signaling, aur P2P connection.

**Step 1: Room Entry (`RoomEntry.jsx`)**
- User app kholta hai, aur decide karta hai ki usse **Host** banna hai ya **Client**.
- Ek Unique Room ID (uuid) generate hoti hai aur Backend (Socket.io) par ek room create ho jata hai jisme devices join karte hain.

**Step 2: Signaling Phase (via `server.js` & `useSocket.js`)**
WebRTC directly connect nahi hota. Pehle background data exchange karna padta hai:
1. **Media Capture:** Host device apna microphone ya system audio `navigator.mediaDevices.getUserMedia` se capture karta hai (`Host.jsx`).
2. **Offer Generation:** Host WebRTC RTCPeerConnection object banata hai, aur ek "Offer" (SDP - Session Description Protocol) create karta hai.
3. **Transmission:** Host yeh Offer backend Socket server ko bhejta hai. Server usse room me baithe Client(s) tak pohcha deta hai.
4. **Answer Generation:** Client receive karta hai Offer, accept karke apna ek "Answer" banata hai aur server ke through wapas Host ko deta hai.

**Step 3: ICE Candidate Exchange**
- Connectivity paths find karne ke liye WebRTC ICE Candidates (network paths / IP address information) generate karta hai.
- Dono (Host aur Client) apne candidates emit karte hain, jo backend relay karta hai. Dono devices ek dusre ke connection paths add kar lete hain jisse routing finalize hoti hai. (`useWebRTC.js` aur `useClientWebRTC.js`).

**Step 4: P2P Streaming Start (`Client.jsx`)**
- Ek baar Connection ban gaya, toh intermediate Server (Node.js) ka kaam lagbhag khatam ho jata hai.
- Host ka audio stream directly P2P network (ya TURN/STUN) ke zariye WebRTC protocol ke through Client ki taraf behta hai.
- Client audio stream receive karta hai `<audio>` tag ke andar playback start ho jata hai.
