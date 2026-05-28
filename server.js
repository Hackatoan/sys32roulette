'use strict';
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3028;

// ── Wipe counter ──────────────────────────────────────────
const STATS_FILE = process.env.STATS_FILE || '/data/stats.json';

function readStats() {
  try { return JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')); } catch { return { wipes: 0 }; }
}
function writeStats(s) {
  try {
    fs.mkdirSync(path.dirname(STATS_FILE), { recursive: true });
    fs.writeFileSync(STATS_FILE, JSON.stringify(s));
  } catch {}
}

app.post('/wipe', (_req, res) => {
  const s = readStats();
  s.wipes = (s.wipes || 0) + 1;
  writeStats(s);
  res.json(s);
});

app.get('/stats', (_req, res) => res.json(readStats()));
// ─────────────────────────────────────────────────────────

app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'landing.html')));
app.get('/play', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'game.html')));
app.get('/macos', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'macos.html')));
app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();
const queue = [];

function rndCode() { return Math.random().toString(36).slice(2, 8).toUpperCase(); }

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 15 game types — each match plays 5 randomly selected
const GAME_TYPES = [
  'typing', 'click', 'memory',
  'reaction', 'math', 'order', 'scramble',
  'whack', 'binary', 'stroop', 'hold',
  'aim', 'simon', 'countdown', 'pipes',
];
const ROUNDS_PER_MATCH = 5;

// ── Game data ─────────────────────────────────────────────
const COMMANDS = [
  'rm -rf /',
  'del /s /q C:\\Windows\\System32',
  'sudo rm -rf --no-preserve-root /',
  'format C: /y',
  'dd if=/dev/urandom of=/dev/sda bs=1M',
  'shutdown /s /f /t 0',
];

const SCRAMBLE_WORDS = [
  'CHMOD', 'KERNEL', 'SOCKET', 'BUFFER', 'MALLOC', 'MUTEX',
  'THREAD', 'DAEMON', 'SIGNAL', 'REBOOT', 'STDOUT', 'STDERR',
  'INODE', 'SYSCALL', 'PRINTF', 'MEMORY', 'PROCESS', 'VECTOR',
  'INJECT', 'BINARY', 'PACKET', 'POINTER', 'EXPLOIT', 'ROOTKIT',
];

const STROOP_COLORS = ['RED', 'GREEN', 'BLUE', 'YELLOW'];

const PIPE_PUZZLES = [
  { display: 'echo "cat" | rev', answer: 'tac' },
  { display: 'echo "HELLO" | tr A-Z a-z', answer: 'hello' },
  { display: 'echo "123" | rev', answer: '321' },
  { display: 'echo "Linux" | tr a-z A-Z', answer: 'LINUX' },
  { display: 'echo "abc" | rev | tr a-z A-Z', answer: 'CBA' },
  { display: 'echo "ROOT" | tr A-Z a-z | rev', answer: 'toor' },
  { display: 'echo "galf" | rev', answer: 'flag' },
  { display: 'echo "BIN" | tr A-Z a-z', answer: 'bin' },
  { display: 'echo "gnip" | rev', answer: 'ping' },
  { display: 'echo "BASH" | tr A-Z a-z | rev', answer: 'hsab' },
  { display: 'echo "dev" | rev | tr a-z A-Z', answer: 'VED' },
  { display: 'echo "TCP" | tr A-Z a-z', answer: 'tcp' },
];

// ── Helper functions ──────────────────────────────────────
function makeMemoryGrid(size = 4, count = 5) {
  const grid = new Array(size * size).fill(0);
  shuffle([...Array(size * size).keys()]).slice(0, count).forEach(i => (grid[i] = 1));
  return grid;
}

function makeMathQ() {
  const ops = ['+', '-', '*'];
  const op = ops[Math.floor(Math.random() * ops.length)];
  let a, b;
  if (op === '+') { a = 10 + Math.floor(Math.random() * 80); b = 5 + Math.floor(Math.random() * 50); }
  else if (op === '-') { a = 30 + Math.floor(Math.random() * 60); b = 1 + Math.floor(Math.random() * 29); }
  else { a = 2 + Math.floor(Math.random() * 11); b = 2 + Math.floor(Math.random() * 11); }
  const ans = op === '+' ? a + b : op === '-' ? a - b : a * b;
  return { a, op, b, ans };
}

function makeBinaryQ() {
  const bits = 4 + Math.floor(Math.random() * 5);
  const value = Math.floor(Math.random() * Math.pow(2, bits));
  const binary = value.toString(2).padStart(bits, '0');
  const wrong = new Set();
  while (wrong.size < 3) {
    const w = Math.floor(Math.random() * Math.pow(2, bits));
    if (w !== value) wrong.add(w);
  }
  const choices = shuffle([value, ...wrong]);
  return { binary, value, choices };
}

function makeStroopQ() {
  const word = STROOP_COLORS[Math.floor(Math.random() * STROOP_COLORS.length)];
  let displayColor;
  do { displayColor = STROOP_COLORS[Math.floor(Math.random() * STROOP_COLORS.length)]; }
  while (displayColor === word);
  return { word, displayColor };
}

function scrambleWord(word) {
  const arr = word.split('');
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  if (arr.join('') === word) [arr[0], arr[arr.length - 1]] = [arr[arr.length - 1], arr[0]];
  return arr.join('');
}

function makeSimonSeq(len = 6) {
  const keys = ['W', 'A', 'S', 'D'];
  return Array.from({ length: len }, () => keys[Math.floor(Math.random() * 4)]);
}

// ── Core game logic ───────────────────────────────────────
function startMinigame(room) {
  const type = room.gameOrder[room.currentGame];
  room.gameData = { type, finished: false };
  const payload = { type, round: room.currentGame, of: room.gameOrder.length };

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
      endMinigame(room, s[a] > s[b] ? a : s[b] > s[a] ? b : null, { clickScores: s });
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
      endMinigame(room, memScores[a] > memScores[b] ? a : memScores[b] > memScores[a] ? b : null, { memScores });
    }, 30000);

  } else if (type === 'reaction') {
    room.gameData.signalSent = false;
    const delay = 2000 + Math.random() * 3500;
    room.timer = setTimeout(() => {
      room.gameData.signalSent = true;
      io.to(room.id).emit('reaction-go');
      room.timer = setTimeout(() => {
        if (room.gameData.finished) return;
        room.gameData.finished = true;
        endMinigame(room, null);
      }, 5000);
    }, delay);

  } else if (type === 'math') {
    const TARGET = 5;
    room.gameData.target = TARGET;
    room.gameData.progress = Object.fromEntries(room.players.map(p => [p, 0]));
    room.gameData.questions = {};
    room.players.forEach(pid => {
      const q = makeMathQ();
      room.gameData.questions[pid] = q;
      io.to(pid).emit('math-question', { ...q, qnum: 1, target: TARGET });
    });
    clearTimeout(room.timer);
    room.timer = setTimeout(() => {
      if (room.gameData.finished) return;
      room.gameData.finished = true;
      const [a, b] = room.players;
      const pa = room.gameData.progress[a], pb = room.gameData.progress[b];
      endMinigame(room, pa > pb ? a : pb > pa ? b : null);
    }, 45000);

  } else if (type === 'order') {
    const nums = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    payload.nums = nums;
    room.gameData.startTime = Date.now();
    clearTimeout(room.timer);
    room.timer = setTimeout(() => {
      if (room.gameData.finished) return;
      room.gameData.finished = true;
      endMinigame(room, null);
    }, 25000);

  } else if (type === 'scramble') {
    const word = SCRAMBLE_WORDS[Math.floor(Math.random() * SCRAMBLE_WORDS.length)];
    const scrambled = scrambleWord(word);
    payload.scrambled = scrambled;
    room.gameData.word = word;
    clearTimeout(room.timer);
    room.timer = setTimeout(() => {
      if (room.gameData.finished) return;
      room.gameData.finished = true;
      endMinigame(room, null);
    }, 30000);

  } else if (type === 'whack') {
    room.gameData.scores = Object.fromEntries(room.players.map(p => [p, 0]));
    payload.duration = 12000;
    clearTimeout(room.timer);
    room.timer = setTimeout(() => {
      if (room.gameData.finished) return;
      room.gameData.finished = true;
      const s = room.gameData.scores;
      const [a, b] = room.players;
      endMinigame(room, s[a] > s[b] ? a : s[b] > s[a] ? b : null, { whackScores: s });
    }, 13000);

  } else if (type === 'binary') {
    const TARGET = 5;
    room.gameData.target = TARGET;
    room.gameData.progress = Object.fromEntries(room.players.map(p => [p, 0]));
    room.gameData.questions = {};
    room.players.forEach(pid => {
      const q = makeBinaryQ();
      room.gameData.questions[pid] = q;
      io.to(pid).emit('binary-question', { ...q, qnum: 1, target: TARGET });
    });
    clearTimeout(room.timer);
    room.timer = setTimeout(() => {
      if (room.gameData.finished) return;
      room.gameData.finished = true;
      const [a, b] = room.players;
      const pa = room.gameData.progress[a], pb = room.gameData.progress[b];
      endMinigame(room, pa > pb ? a : pb > pa ? b : null);
    }, 40000);

  } else if (type === 'stroop') {
    const TARGET = 5;
    room.gameData.target = TARGET;
    room.gameData.progress = Object.fromEntries(room.players.map(p => [p, 0]));
    room.gameData.questions = {};
    room.players.forEach(pid => {
      const q = makeStroopQ();
      room.gameData.questions[pid] = q;
      io.to(pid).emit('stroop-question', { ...q, qnum: 1, target: TARGET, choices: shuffle([...STROOP_COLORS]) });
    });
    clearTimeout(room.timer);
    room.timer = setTimeout(() => {
      if (room.gameData.finished) return;
      room.gameData.finished = true;
      const [a, b] = room.players;
      const pa = room.gameData.progress[a], pb = room.gameData.progress[b];
      endMinigame(room, pa > pb ? a : pb > pa ? b : null);
    }, 40000);

  } else if (type === 'hold') {
    const target = 2000 + Math.floor(Math.random() * 4001);
    payload.target = target;
    room.gameData.target = target;
    room.gameData.results = {};
    clearTimeout(room.timer);
    room.timer = setTimeout(() => {
      if (room.gameData.finished) return;
      room.gameData.finished = true;
      const [a, b] = room.players;
      const ra = room.gameData.results[a], rb = room.gameData.results[b];
      if (!ra && !rb) { endMinigame(room, null); return; }
      if (!ra) { endMinigame(room, b); return; }
      if (!rb) { endMinigame(room, a); return; }
      endMinigame(room, ra < rb ? a : rb < ra ? b : null);
    }, 15000);

  } else if (type === 'aim') {
    room.gameData.scores = Object.fromEntries(room.players.map(p => [p, 0]));
    payload.duration = 12000;
    clearTimeout(room.timer);
    room.timer = setTimeout(() => {
      if (room.gameData.finished) return;
      room.gameData.finished = true;
      const s = room.gameData.scores;
      const [a, b] = room.players;
      endMinigame(room, s[a] > s[b] ? a : s[b] > s[a] ? b : null, { aimScores: s });
    }, 13000);

  } else if (type === 'simon') {
    const seq = makeSimonSeq(6);
    payload.sequence = seq;
    room.gameData.sequence = seq;
    clearTimeout(room.timer);
    room.timer = setTimeout(() => {
      if (room.gameData.finished) return;
      room.gameData.finished = true;
      endMinigame(room, null);
    }, 35000);

  } else if (type === 'countdown') {
    const duration = 10000;
    room.gameData.duration = duration;
    room.gameData.startTime = Date.now();
    room.gameData.stops = {};
    payload.duration = duration;
    clearTimeout(room.timer);
    room.timer = setTimeout(() => {
      if (room.gameData.finished) return;
      room.gameData.finished = true;
      const [a, b] = room.players;
      const sa = room.gameData.stops[a], sb = room.gameData.stops[b];
      if (!sa && !sb) { endMinigame(room, null); return; }
      if (!sa) { endMinigame(room, b); return; }
      if (!sb) { endMinigame(room, a); return; }
      endMinigame(room, sa < sb ? a : sb < sa ? b : null);
    }, 15000);

  } else if (type === 'pipes') {
    const puzzle = PIPE_PUZZLES[Math.floor(Math.random() * PIPE_PUZZLES.length)];
    payload.display = puzzle.display;
    room.gameData.answer = puzzle.answer;
    clearTimeout(room.timer);
    room.timer = setTimeout(() => {
      if (room.gameData.finished) return;
      room.gameData.finished = true;
      endMinigame(room, null);
    }, 25000);
  }

  io.to(room.id).emit('minigame-start', payload);

  // Emit per-player questions after the minigame-start for question-based games
  // (already emitted above for math, binary, stroop via individual io.to(pid))
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
    gameOrder: shuffle([...GAME_TYPES]).slice(0, ROUNDS_PER_MATCH),
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
    if (queue.length >= 2) {
      const pidA = queue.shift();
      const pidB = queue.shift();
      const sockA = io.sockets.sockets.get(pidA);
      const sockB = io.sockets.sockets.get(pidB);
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
      gameOrder: shuffle([...GAME_TYPES]).slice(0, ROUNDS_PER_MATCH),
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

  // ── Existing game handlers ────────────────────────────────
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
    clearTimeout(room.timer);
    const grid = room.gameData.grid;
    const memScores = {};
    room.players.forEach(pid => {
      const ans = room.gameData.answers[pid] || [];
      memScores[pid] = grid.reduce((s, v, i) => s + (v === (ans[i] || 0) ? 1 : 0), 0);
    });
    const [a, b] = room.players;
    endMinigame(room, memScores[a] > memScores[b] ? a : memScores[b] > memScores[a] ? b : null, { memScores });
  });

  // ── New game handlers ─────────────────────────────────────
  socket.on('reaction-click', () => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.gameData.type !== 'reaction' || room.gameData.finished) return;
    if (!room.gameData.signalSent) {
      // Early click — forfeit this round
      room.gameData.finished = true;
      clearTimeout(room.timer);
      const opp = room.players.find(p => p !== socket.id);
      endMinigame(room, opp);
      return;
    }
    room.gameData.finished = true;
    clearTimeout(room.timer);
    endMinigame(room, socket.id);
  });

  socket.on('math-answer', ({ answer }) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.gameData.type !== 'math' || room.gameData.finished) return;
    const q = room.gameData.questions[socket.id];
    if (!q) return;
    const correct = parseInt(answer) === q.ans;
    if (correct) {
      room.gameData.progress[socket.id]++;
      if (room.gameData.progress[socket.id] >= room.gameData.target) {
        room.gameData.finished = true;
        clearTimeout(room.timer);
        endMinigame(room, socket.id);
        return;
      }
    }
    const nextQ = makeMathQ();
    room.gameData.questions[socket.id] = nextQ;
    io.to(socket.id).emit('math-question', {
      ...nextQ,
      qnum: room.gameData.progress[socket.id] + 1,
      target: room.gameData.target,
      correct,
    });
  });

  socket.on('order-done', () => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.gameData.type !== 'order' || room.gameData.finished) return;
    room.gameData.finished = true;
    clearTimeout(room.timer);
    endMinigame(room, socket.id);
  });

  socket.on('scramble-answer', ({ answer }) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.gameData.type !== 'scramble' || room.gameData.finished) return;
    if ((answer || '').toUpperCase().trim() === room.gameData.word) {
      room.gameData.finished = true;
      clearTimeout(room.timer);
      endMinigame(room, socket.id);
    } else {
      io.to(socket.id).emit('scramble-wrong');
    }
  });

  socket.on('whack-score', score => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.gameData.type !== 'whack' || room.gameData.finished) return;
    room.gameData.scores[socket.id] = score;
  });

  socket.on('binary-answer', ({ choice }) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.gameData.type !== 'binary' || room.gameData.finished) return;
    const q = room.gameData.questions[socket.id];
    if (!q) return;
    const correct = choice === q.value;
    if (correct) {
      room.gameData.progress[socket.id]++;
      if (room.gameData.progress[socket.id] >= room.gameData.target) {
        room.gameData.finished = true;
        clearTimeout(room.timer);
        endMinigame(room, socket.id);
        return;
      }
    }
    const nextQ = makeBinaryQ();
    room.gameData.questions[socket.id] = nextQ;
    io.to(socket.id).emit('binary-question', {
      ...nextQ,
      qnum: room.gameData.progress[socket.id] + 1,
      target: room.gameData.target,
      correct,
    });
  });

  socket.on('stroop-answer', ({ choice }) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.gameData.type !== 'stroop' || room.gameData.finished) return;
    const q = room.gameData.questions[socket.id];
    if (!q) return;
    const correct = choice === q.displayColor;
    if (correct) {
      room.gameData.progress[socket.id]++;
      if (room.gameData.progress[socket.id] >= room.gameData.target) {
        room.gameData.finished = true;
        clearTimeout(room.timer);
        endMinigame(room, socket.id);
        return;
      }
    }
    const nextQ = makeStroopQ();
    room.gameData.questions[socket.id] = nextQ;
    io.to(socket.id).emit('stroop-question', {
      ...nextQ,
      qnum: room.gameData.progress[socket.id] + 1,
      target: room.gameData.target,
      choices: shuffle([...STROOP_COLORS]),
      correct,
    });
  });

  socket.on('hold-result', ({ elapsed }) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.gameData.type !== 'hold' || room.gameData.finished) return;
    const error = Math.abs(elapsed - room.gameData.target);
    room.gameData.results[socket.id] = error;
    if (Object.keys(room.gameData.results).length >= 2) {
      room.gameData.finished = true;
      clearTimeout(room.timer);
      const [a, b] = room.players;
      const ea = room.gameData.results[a], eb = room.gameData.results[b];
      endMinigame(room, ea < eb ? a : eb < ea ? b : null);
    }
  });

  socket.on('aim-score', score => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.gameData.type !== 'aim' || room.gameData.finished) return;
    room.gameData.scores[socket.id] = score;
  });

  socket.on('simon-done', () => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.gameData.type !== 'simon' || room.gameData.finished) return;
    room.gameData.finished = true;
    clearTimeout(room.timer);
    endMinigame(room, socket.id);
  });

  socket.on('countdown-stop', () => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.gameData.type !== 'countdown' || room.gameData.finished) return;
    const elapsed = Date.now() - room.gameData.startTime;
    const error = Math.abs(elapsed - room.gameData.duration);
    room.gameData.stops[socket.id] = error;
    if (Object.keys(room.gameData.stops).length >= 2) {
      room.gameData.finished = true;
      clearTimeout(room.timer);
      const [a, b] = room.players;
      const ea = room.gameData.stops[a], eb = room.gameData.stops[b];
      endMinigame(room, ea < eb ? a : eb < ea ? b : null);
    }
  });

  socket.on('pipes-answer', ({ answer }) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.gameData.type !== 'pipes' || room.gameData.finished) return;
    if ((answer || '').trim() === room.gameData.answer) {
      room.gameData.finished = true;
      clearTimeout(room.timer);
      endMinigame(room, socket.id);
    } else {
      io.to(socket.id).emit('pipes-wrong');
    }
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
