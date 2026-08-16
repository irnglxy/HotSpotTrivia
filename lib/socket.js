import { io } from 'socket.io-client';

// Automatically detects if we are on localhost or a secure cloud URL (Render)
const SOCKET_URL = typeof window !== 'undefined' ? window.location.origin : undefined;

export const socket = io(SOCKET_URL, {
  path: '/socket.io',
  transports: ['polling', 'websocket'], // Polling first ensures mobile browsers establish connection safely
  secure: true,
  rejectUnauthorized: false
});