import { io } from 'socket.io-client';

// Explicitly provide your live Render URL, with a fallback to localhost for development
const SOCKET_URL = process.env.NODE_ENV === 'production' 
  ? 'https://hot-spot-trivia.onrender.com' 
  : 'http://localhost:3000';

export const socket = io(SOCKET_URL, {
  path: '/socket.io',
  transports: ['polling', 'websocket'], // Polling first is mandatory for cloud mobile handshakes
  secure: true
});