// client/src/App.jsx
// Simple client-side router — no react-router needed yet.
// Pattern: /room/:roomId → Client view, / → Host view

import Host from './components/Host';
import Client from './components/Client'; // Built in Phase 3

function App() {
  const path = window.location.pathname;
  const roomMatch = path.match(/^\/room\/([a-f0-9-]{36})$/i);

  if (roomMatch) {
    return <Client roomId={roomMatch[1]} />;
  }

  return <Host />;
}

export default App;