# AudioSync Code Review (Pre-Change)

Date: 2026-04-18
Workspace: audiosync
Scope: server + client runtime readiness for Phase 2/3 flow

## Findings (ordered by severity)

1. Critical: Server cannot start because module type mismatches import syntax.
- File: server/package.json:13
- Current value: "type": "commonjs"
- Related code: server/server.js uses ESM imports (`import ...`) from line 4 onward.
- Runtime evidence:
  - `npm run dev` in server fails with `SyntaxError: Cannot use import statement outside a module`.
- Impact:
  - Signaling server never boots, so join-room/offer/answer/ice flow cannot begin.

2. High: Vite dev server is not configured for LAN access in config.
- File: client/vite.config.js:5
- Current config only has plugins and no `server.host`/`server.port` block.
- Impact:
  - Mobile phone testing over LAN is not consistently available from config defaults.
  - This conflicts with the required end-to-end test sequence.

3. Medium: Host component adds `client-joined` listener but does not clean it up.
- File: client/src/components/Host.jsx:80-95
- Behavior:
  - Listener added via `socket.on('client-joined', ...)`
  - Cleanup removes only `room-joined` listener.
- Impact:
  - In dev/StrictMode remount cycles, duplicate listeners can accumulate and duplicate UI updates.

4. Environment blocker (non-code): Local Node version is below Vite requirement.
- Current: Node v22.11.0
- Vite requirement from runtime output: Node `20.19+` or `22.12+`
- Runtime evidence:
  - `npm run dev` and `npm run build` in client fail with Node version warning and `rolldown` native binding load error.
- Impact:
  - Client dev/build cannot run in current local environment until Node is upgraded (or toolchain is downgraded).

## Planned Changes

1. Set server package type to ESM (`"type": "module"`) to match server.js imports.
2. Update client/vite.config.js to expose dev server on LAN (`host: true`) and explicit `port: 5173`.
3. Fix Host listener cleanup for `client-joined` to avoid duplicate subscriptions.

## Validation Plan

1. Start signaling server: `cd server && npm run dev` should boot without module syntax error.
2. Verify Vite config content includes `server.host` and `server.port`.
3. Re-check diagnostics for changed files.
4. If client still fails on Node 22.11, move to a Node-compatible Vite/plugin pair.

## Applied Changes

1. Updated `server/package.json`:
- `"type": "commonjs"` -> `"type": "module"`

2. Updated `client/vite.config.js`:
- Added:
  - `server.host = true`
  - `server.port = 5173`

3. Updated `client/src/components/Host.jsx`:
- Added named `handleClientJoined` listener and cleaned it up in effect return.
- Added `socket.off('connect', joinRoom)` in cleanup to avoid stale connect callback.

4. Updated `client/package.json` for Node 22.11 compatibility:
- `vite` set to `^6.4.2`
- `@vitejs/plugin-react` set to `^4.7.0`

## 5. WebRTC / Socket LAN Connectivity Fixes

- **Client Socket**: Dynamically resolved the WebSocket URL in `client/src/hooks/useSocket.js` instead of strictly using the `.env.local` `localhost` string. When the app is accessed on a mobile phone using a local IP (like `192.168.x.x`), it now swaps `localhost` for that IP so the WebSocket connection naturally bounds back to your laptop running the server.
- **Server CORS**: Updated the socket connection regex inside `server/server.js` (`isAllowedOrigin()`) to explicitly permit `192.168.*.*`, `10.*.*.*`, and `172.*.*.*` along with `localhost` so the phone's origin doesn't trigger CORS blocks.

## 6. HTTPS Security Constraint Fixes (getDisplayMedia)
- **Error addressed**: `Capture failed: Cannot read properties of undefined (reading 'getDisplayMedia')`
- **Root Cause**: Browsers explicitly block screen/audio capture (`navigator.mediaDevices.getDisplayMedia`) APIs over standard HTTP network IP addresses (like `http://10.x.x.x`) for security reasons. They strictly require HTTPS or `localhost`.
- **Fix**: Installed `@vitejs/plugin-basic-ssl` and configured `client/vite.config.js` to run the development server via HTTPS locally (`https: true`).
- **Proxy Fix**: With the frontend running on securely encrypted HTTPS, the Socket.io connection naturally got blocked by "Mixed Content" protocol rules (since the server was running on basic HTTP/WS). We configured Vite's `server.proxy` to funnel all `/socket.io` API calls directly through the secure HTTPS boundary to the backend on port 3001, skipping the manual server address in `useSocket.js`.

## Post-Change Validation Notes

1. Server now starts successfully with `npm run dev` and logs:
- `AudioSync signaling server running on port 3001`

2. Client now runs successfully in this machine:
- `npm run dev` starts and serves on `http://localhost:5173/`.
- Network URL is available for phone testing.
- `npm run build` completes successfully.
