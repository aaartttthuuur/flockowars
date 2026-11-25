const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: ['https://flocko-wars.onrender.com', 'http://localhost:3000'], methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling']
});

const rooms = new Map();
const socketRooms = new Map();
const PORT = process.env.PORT || 3000;
const MAX_ROOMS = 100;
const MAX_PLAYERS = 8;

app.get('/', (_req, res) => res.json({ name: 'Flocko Wars Lobby', status: 'ok', rooms: rooms.size }));
app.get('/health', (_req, res) => res.status(200).json({ status: 'ok', uptime: process.uptime() }));

function cleanName(value, fallback) {
  return String(value || fallback).replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 18) || fallback;
}
function publicRoom(room) {
  return {
    id: room.id, code: room.code, name: room.name,
    players: room.players.size, maxPlayers: room.maxPlayers,
    status: room.status, createdAt: room.createdAt
  };
}
function snapshot(room, socketId) {
  return {
    room: { ...publicRoom(room), hostId: room.hostId },
    playerId: socketId,
    players: [...room.players.values()].map(p => ({ id: p.id, name: p.name, ready: p.ready }))
  };
}
function sendRoom(room) {
  io.to(room.id).emit('room:update', {
    room: { ...publicRoom(room), hostId: room.hostId },
    players: [...room.players.values()].map(p => ({ id: p.id, name: p.name, ready: p.ready }))
  });
}
function listRooms() {
  return [...rooms.values()].filter(r => r.status === 'waiting' && r.isPublic).map(publicRoom).sort((a,b) => b.createdAt-a.createdAt);
}
function leave(socket) {
  const roomId = socketRooms.get(socket.id);
  if (!roomId) return;
  const room = rooms.get(roomId);
  socketRooms.delete(socket.id);
  socket.leave(roomId);
  if (!room) return;
  room.players.delete(socket.id);
  if (!room.players.size) rooms.delete(roomId);
  else {
    if (room.hostId === socket.id) room.hostId = room.players.keys().next().value;
    sendRoom(room);
  }
  io.emit('rooms:list', listRooms());
}
function join(socket, room, name) {
  if (!room) return socket.emit('room:error', { message: 'Salon introuvable.' });
  if (room.status !== 'waiting') return socket.emit('room:error', { message: 'Cette partie a déjà commencé.' });
  if (room.players.size >= room.maxPlayers) return socket.emit('room:error', { message: 'Ce salon est complet.' });
  leave(socket);
  room.players.set(socket.id, { id: socket.id, name: cleanName(name, 'Commander'), ready: socket.id === room.hostId });
  socketRooms.set(socket.id, room.id);
  socket.join(room.id);
  socket.emit('room:joined', snapshot(room, socket.id));
  sendRoom(room);
  io.emit('rooms:list', listRooms());
}
io.on('connection', socket => {
  socket.emit('rooms:list', listRooms());
  socket.on('rooms:list', () => socket.emit('rooms:list', listRooms()));

  socket.on('room:create', payload => {
    if (rooms.size >= MAX_ROOMS) return socket.emit('room:error', { message: 'Trop de salons actifs. Réessayez plus tard.' });
    leave(socket);
    let code;
    do { code = crypto.randomBytes(3).toString('hex').toUpperCase(); }
    while ([...rooms.values()].some(r => r.code === code));
    const room = {
      id: crypto.randomUUID(), code,
      name: cleanName(payload?.roomName, 'Conquête du monde'),
      hostId: socket.id, maxPlayers: MAX_PLAYERS, status: 'waiting',
      isPublic: true, createdAt: Date.now(), players: new Map()
    };
    rooms.set(room.id, room);
    join(socket, room, payload?.name);
  });

  socket.on('room:join', payload => join(socket, rooms.get(String(payload?.roomId || '')), payload?.name));
  socket.on('room:join-code', payload => {
    const code = String(payload?.code || '').trim().toUpperCase();
    const room = [...rooms.values()].find(r => r.code === code);
    join(socket, room, payload?.name);
  });

  socket.on('room:ready', payload => {
    const room = rooms.get(socketRooms.get(socket.id));
    if (!room || room.id !== payload?.roomId) return;
    const player = room.players.get(socket.id);
    if (!player) return;
    player.ready = !player.ready;
    sendRoom(room);
  });

  socket.on('room:start', payload => {
    const room = rooms.get(socketRooms.get(socket.id));
    if (!room || room.id !== payload?.roomId) return;
    if (room.hostId !== socket.id) return socket.emit('room:error', { message: 'Seul l’hôte peut lancer la partie.' });
    if (![...room.players.values()].every(p => p.ready)) return socket.emit('room:error', { message: 'Tous les joueurs doivent être prêts.' });
    room.status = 'playing';
    const game = { room: publicRoom(room), players: [...room.players.values()].map(p => ({ id: p.id, name: p.name })) };
    io.to(room.id).emit('game:start', game);
    io.emit('rooms:list', listRooms());
  });

  socket.on('game:action', payload => {
    const room = rooms.get(socketRooms.get(socket.id));
    if (!room || room.status !== 'playing' || room.id !== payload?.roomId) return;
    const action = payload?.action;
    if (!action || !Number.isInteger(action.faction) || action.faction < 0 || action.faction >= room.players.size) return;
    if (action.type === 'attack' && (!Number.isInteger(action.from) || !Number.isInteger(action.to) || typeof action.ratio !== 'number' || typeof action.roll !== 'number')) return;
    if (action.type === 'build' && (!Number.isInteger(action.region) || !['farm', 'barracks', 'fort', 'factory'].includes(action.building))) return;
    if (!['attack', 'build'].includes(action.type)) return;
    socket.to(room.id).emit('game:action', { playerId: socket.id, action });
  });

  socket.on('room:leave', () => leave(socket));
  socket.on('disconnect', () => leave(socket));
});
setInterval(() => {
  const cutoff = Date.now() - 1000 * 60 * 60 * 4;
  for (const [id, room] of rooms) if (room.createdAt < cutoff && !room.players.size) rooms.delete(id);
}, 60_000).unref();

server.listen(PORT, '0.0.0.0', () => console.log(`Flocko Wars lobby listening on ${PORT}`));
