import { io } from 'socket.io-client';

// Force polling first, then websocket upgrade to avoid local network drops
export const socket = io({
  transports: ['polling', 'websocket'],
  autoConnect: true
});