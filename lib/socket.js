import { io } from 'socket.io-client';

// Use the domain the visitor opened, so custom domains and the Render URL both work.
const SOCKET_URL = typeof window !== 'undefined'
  ? window.location.origin
  : process.env.NODE_ENV === 'production' ? 'https://hot-spot-trivia.onrender.com' : 'http://localhost:3000';

export const socket = io(SOCKET_URL, {
  path: '/socket.io',
  transports: ['polling', 'websocket'], // Polling first is mandatory for cloud mobile handshakes
  secure: true
});
