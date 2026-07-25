// server/server.js
import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const httpServer = http.createServer(app);

// ---------------------------------------------------------------------------
// CORS — allow all origins (dev + ngrok + LAN + internet)
// ---------------------------------------------------------------------------
const configuredOrigins = (process.env.CLIENT_ORIGIN || '*')
    .split(',').map(o => o.trim()).filter(Boolean);

const isAllowedOrigin = (origin = '') => {
    if (!origin) return true;
    if (configuredOrigins.includes('*')) return true;
    if (configuredOrigins.includes(origin)) return true;
    if (/^https?:\/\/(\d{1,3}\.){3}\d{1,3}(:\d+)?$/.test(origin)) return true;
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return true;
    return false;
};

const io = new Server(httpServer, {
    cors: {
        origin: (origin, cb) => isAllowedOrigin(origin) ? cb(null, true) : cb(new Error(`CORS blocked: ${origin}`)),
        methods: ['GET', 'POST'],
    },
});

app.use((req, res, next) => {
    const origin = req.headers.origin || '';
    if (isAllowedOrigin(origin)) res.setHeader('Access-Control-Allow-Origin', origin || '*');
    next();
});

// ---------------------------------------------------------------------------
// Serve the built client (client/dist) — enables single-port deployment
// Run `npm run build` in the client folder first, then just expose port 3001.
// One ngrok tunnel covers both the app and the signaling server.
// ---------------------------------------------------------------------------
const clientDist = path.resolve(__dirname, '../client/dist');
app.use(express.static(clientDist));

// ---------------------------------------------------------------------------
// Room registry
// ---------------------------------------------------------------------------
const rooms = new Map();
const getRoom = (id) => { if (!rooms.has(id)) rooms.set(id, new Set()); return rooms.get(id); };

app.get('/health', (_, res) => res.json({ status: 'ok', rooms: rooms.size }));

// SPA fallback — must come AFTER /health
app.get(/.*/, (req, res) => res.sendFile(path.join(clientDist, 'index.html')));

// ---------------------------------------------------------------------------
// Signaling
// ---------------------------------------------------------------------------
io.on('connection', (socket) => {
    console.log(`[+] ${socket.id} connected`);

    socket.on('join-room', ({ roomId, role }) => {
        if (!roomId) return socket.emit('error', { message: 'roomId required' });

        const room = getRoom(roomId);

        if (role === 'host' && room.size > 0) {
            const existingHost = [...room].find(id => io.sockets.sockets.get(id)?.data?.role === 'host');
            if (existingHost && existingHost !== socket.id)
                return socket.emit('error', { message: 'Room already has a host.' });
        }

        socket.join(roomId);
        room.add(socket.id);
        socket.data.role = role;
        socket.data.roomId = roomId;

        console.log(`[Room ${roomId}] ${role} joined (${socket.id}). Size: ${room.size}`);
        socket.emit('room-joined', { socketId: socket.id, roomId, participantCount: room.size });

        if (role === 'client') {
            socket.to(roomId).emit('client-joined', { clientId: socket.id, participantCount: room.size });
        }

        // If host joins after clients are already waiting, notify host of each
        if (role === 'host' && room.size > 1) {
            [...room].filter(id => id !== socket.id).forEach(clientId => {
                const cs = io.sockets.sockets.get(clientId);
                if (cs?.data?.role === 'client') {
                    socket.emit('client-joined', { clientId, participantCount: room.size });
                }
            });
        }
    });

    socket.on('offer', ({ targetId, sdp }) => io.to(targetId).emit('offer', { sdp, fromId: socket.id }));
    socket.on('answer', ({ targetId, sdp }) => io.to(targetId).emit('answer', { sdp, fromId: socket.id }));
    socket.on('ice-candidate', ({ targetId, candidate }) => candidate && io.to(targetId).emit('ice-candidate', { candidate, fromId: socket.id }));

    socket.on('disconnect', (reason) => {
        const { roomId, role } = socket.data;
        console.log(`[-] ${socket.id} disconnected (${reason})`);
        if (!roomId) return;
        const room = rooms.get(roomId);
        if (!room) return;
        room.delete(socket.id);
        if (room.size === 0) {
            rooms.delete(roomId);
        } else {
            // Broadcast who left AND their role so clients can ignore non-host disconnects
            socket.to(roomId).emit('peer-disconnected', { peerId: socket.id, role, participantCount: room.size });
        }
    });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => console.log(`AudioSync server on port ${PORT}`));
