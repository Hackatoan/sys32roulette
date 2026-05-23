'use strict';
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3028;

// Landing page at /, game at /play
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'landing.html')));
app.get('/play', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'game.html')));
app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();
const queue = []; // sockets waiting for a quick-play match

function rndCode() { return Math.random().toString(36).slice(2, 8).toUpperCase(); }

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const GAME_TYPES = ['typing', 'click', 'memory'];
const COMMANDS = [
  'rm -rf /',
  'del /s /q C:\\Windows\\System32',
  'sudo rm -rf --no-preserve-root /',
  'format C: /y',
  'dd if=/dev/urandom of=/dev/sda bs=1M',
  'shutdown /s /f /t 0',
];

function makeMemoryGrid(size = 4, count = 5) {
  const grid = new Array(size * size).fill(0);
  shuffle([...Array(size * size).keys()]).slice(0, count).forEach(i => (grid[i] = 1));
  return grid;
}

function startMinigame(room) {
  const type = room.gameOrder[room.currentGame];
  room.gameData = { type, finished: false };
  const payload = { type, round: room.currentGame, of: GAME_TYPES.length };

  if (type === 'typing') {
    const cmd = COMMANDS[Math.floor(Math.random() * COMMANDS.length)];
    payload.command = cmd;
    room.gameData.cmd = cmd;
    room.gameData.firstDone = null;
  } else if (type === 'click') {
    room.gameData.scores = Object.fromEntries(room.players.map(p => [p, 0]));
    payload.duration = 12000;
    clearTimeout(room.timer);
    room.timer = setTimeout(() => {
      if (room.gameData.finished) return;
      room.gameData.finished = true;
      const s = room.gameData.scores;
      const [a, b] = room.players;
      const winner = s[a] > s[b] ? a : s[b] > s[a] ? b : null;
      endMinigame(room, winner, { clickScores: s });
    }, 13000);
  } else if (type === 'memory') {
    const grid = makeMemoryGrid();
    payload.grid = grid;
    payload.showDuration = 3500;
    room.gameData.grid = grid;
    room.gameData.answers = {};
    clearTimeout(room.timer);
    const memRound = room.currentGame;
    room.timer = setTimeout(() => {
      if (room.currentGame !== memRound || room.gameData.finished) return;
      room.gameData.finished = true;
      room.players.forEach(pid => {
        if (!room.gameData.answers[pid]) room.gameData.answers[pid] = new Array(grid.length).fill(0);
      });
      const memScores = {};
      room.players.forEach(pid => {
        const ans = room.gameData.answers[pid];
        memScores[pid] = grid.reduce((s, v, i) => s + (v === (ans[i] || 0) ? 1 : 0), 0);
      });
      const [a, b] = room.players;
      const winner = memScores[a] > memScores[b] ? a : memScores[b] > memScores[a] ? b : null;
      endMinigame(room, winner, { memScores });
    }, 30000);
  }

  io.to(room.id).emit('minigame-start', payload);
}

function endMinigame(room, winnerId, extra = {}) {
  if (winnerId) room.scores[winnerId] = (room.scores[winnerId] || 0) + 1;
  io.to(room.id).emit('minigame-result', {
    winner: winnerId,
    scores: room.scores,
    round: room.currentGame,
    ...extra,
  });
  room.currentGame++;
  setTimeout(() => {
    if (room.currentGame >= room.gameOrder.length) {
      const [a, b] = room.players;
      const sa = room.scores[a] || 0, sb = room.scores[b] || 0;
      io.to(room.id).emit('game-over', {
        winner: sa > sb ? a : sb > sa ? b : null,
        scores: room.scores,
      });
      setTimeout(() => rooms.delete(room.id), 60000);
    } else {
      startMinigame(room);
    }
  }, 5000);
}

function startRoom(pidA, pidB) {
  let code;
  do { code = rndCode(); } while (rooms.has(code));
  const room = {
    id: code, players: [pidA, pidB],
    scores: { [pidA]: 0, [pidB]: 0 },
    currentGame: 0,
    gameOrder: shuffle([...GAME_TYPES]),
    state: 'playing', gameData: {}, timer: null,
  };
  rooms.set(code, room);
  const sockA = io.sockets.sockets.get(pidA);
  const sockB = io.sockets.sockets.get(pidB);
  sockA.roomCode = code;
  sockB.roomCode = code;
  sockA.join(code);
  sockB.join(code);
  room.players.forEach(pid =>
    io.to(pid).emit('game-init', { yourId: pid, players: room.players, gameOrder: room.gameOrder })
  );
  setTimeout(() => startMinigame(room), 3500);
}

function removeFromQueue(socketId) {
  const idx = queue.indexOf(socketId);
  if (idx !== -1) queue.splice(idx, 1);
}

io.on('connection', socket => {
  socket.on('queue-join', () => {
    if (queue.includes(socket.id)) return;
    queue.push(socket.id);
    socket.emit('queue-status', { position: queue.length, total: queue.length });

    // Try to match immediately
    if (queue.length >= 2) {
      const pidA = queue.shift();
      const pidB = queue.shift();
      const sockA = io.sockets.sockets.get(pidA);
      const sockB = io.sockets.sockets.get(pidB);
      // Guard: one may have disconnected between queue-join and now
      if (!sockA || !sockB) {
        if (sockA) { queue.unshift(pidA); sockA.emit('queue-status', { position: 1, total: 1 }); }
        if (sockB) { queue.unshift(pidB); sockB.emit('queue-status', { position: 1, total: 1 }); }
        return;
      }
      startRoom(pidA, pidB);
    }
  });

  socket.on('queue-leave', () => removeFromQueue(socket.id));

  socket.on('create-room', () => {
    let code;
    do { code = rndCode(); } while (rooms.has(code));
    const room = {
      id: code, players: [socket.id],
      scores: { [socket.id]: 0 },
      currentGame: 0,
      gameOrder: shuffle([...GAME_TYPES]),
      state: 'waiting', gameData: {}, timer: null,
    };
    rooms.set(code, room);
    socket.roomCode = code;
    socket.join(code);
    socket.emit('room-created', code);
  });

  socket.on('join-room', raw => {
    const code = (raw || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return socket.emit('join-error', 'Room not found');
    if (room.players.length >= 2) return socket.emit('join-error', 'Room is full');
    room.players.push(socket.id);
    room.scores[socket.id] = 0;
    socket.roomCode = code;
    socket.join(code);
    room.state = 'playing';
    room.players.forEach(pid =>
      io.to(pid).emit('game-init', { yourId: pid, players: room.players, gameOrder: room.gameOrder })
    );
    setTimeout(() => startMinigame(room), 3500);
  });

  socket.on('typing-done', () => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.gameData.type !== 'typing' || room.gameData.finished || room.gameData.firstDone) return;
    room.gameData.firstDone = socket.id;
    room.gameData.finished = true;
    endMinigame(room, socket.id);
  });

  socket.on('click-score', score => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.gameData.type !== 'click' || room.gameData.finished) return;
    room.gameData.scores[socket.id] = score;
  });

  socket.on('memory-submit', answer => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.gameData.type !== 'memory' || room.gameData.finished) return;
    room.gameData.answers[socket.id] = answer;
    if (Object.keys(room.gameData.answers).length < 2) return;
    room.gameData.finished = true;
    const grid = room.gameData.grid;
    const memScores = {};
    room.players.forEach(pid => {
      const ans = room.gameData.answers[pid] || [];
      memScores[pid] = grid.reduce((s, v, i) => s + (v === (ans[i] || 0) ? 1 : 0), 0);
    });
    const [a, b] = room.players;
    const winner = memScores[a] > memScores[b] ? a : memScores[b] > memScores[a] ? b : null;
    endMinigame(room, winner, { memScores });
  });

  socket.on('disconnect', () => {
    removeFromQueue(socket.id);
    const room = rooms.get(socket.roomCode);
    if (!room) return;
    clearTimeout(room.timer);
    room.players.filter(p => p !== socket.id).forEach(p => io.to(p).emit('opponent-left'));
    rooms.delete(room.id);
  });
});

server.listen(PORT, () => console.log(`System 32 Roulette running on :${PORT}`));

