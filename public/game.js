'use strict';
const socket = io();

let myId = null;
let myRoomCode = null;
let gs = { scores: {}, players: [], round: 0, totalRounds: 5 };
let queueTimerInterval = null;

// ── OS detection ──────────────────────────────────────────
function detectOS() {
  const ua = navigator.userAgent;
  if (/Mac OS X|Macintosh/i.test(ua)) return 'mac';
  if (/Win/i.test(ua)) return 'win';
  return 'linux';
}

// ── Screen routing ────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function hideMinigames() {
  document.querySelectorAll('.minigame').forEach(m => m.classList.add('hidden'));
}

// ── Score helpers ─────────────────────────────────────────
function myScore() { return gs.scores[myId] || 0; }
function oppId() { return gs.players.find(p => p !== myId); }
function oppScore() { return gs.scores[oppId()] || 0; }

function updateHUD() {
  document.getElementById('sc-you').textContent = myScore();
  document.getElementById('sc-opp').textContent = oppScore();
}

// ── Queue ─────────────────────────────────────────────────
function doQuickPlay() {
  showScreen('s-queue');
  document.getElementById('queue-status-text').textContent = 'Searching for a target...';
  let elapsed = 0;
  clearInterval(queueTimerInterval);
  queueTimerInterval = setInterval(() => {
    elapsed++;
    document.getElementById('queue-timer').textContent = elapsed + 's';
  }, 1000);
  socket.emit('queue-join');
}

function leaveQueue() {
  clearInterval(queueTimerInterval);
  socket.emit('queue-leave');
  showScreen('s-menu');
}

socket.on('queue-status', ({ position, total }) => {
  const el = document.getElementById('queue-status-text');
  if (el) el.textContent = position === 1
    ? 'Waiting for an opponent...'
    : `In queue — #${position} of ${total}`;
});

// ── Room management ───────────────────────────────────────
function doCreateRoom() {
  showScreen('s-create');
  socket.emit('create-room');
}

function showJoin() {
  document.getElementById('join-error').textContent = '';
  document.getElementById('code-input').value = '';
  showScreen('s-join');
}

function doJoinRoom() {
  const code = document.getElementById('code-input').value.trim().toUpperCase();
  if (code.length < 4) {
    document.getElementById('join-error').textContent = 'Enter a valid room code';
    return;
  }
  socket.emit('join-room', code);
}

function copyCode() {
  navigator.clipboard.writeText(myRoomCode).catch(() => {});
  flashCopy('Code copied!');
}
function copyLink() {
  navigator.clipboard.writeText(`${location.origin}/play?join=${myRoomCode}`).catch(() => {});
  flashCopy('Link copied!');
}
function flashCopy(msg) {
  const el = document.querySelector('.hint-text');
  if (!el) return;
  el.textContent = msg;
  setTimeout(() => { el.textContent = 'Share the code with your opponent to start'; }, 2000);
}

// ── Socket events ─────────────────────────────────────────
socket.on('room-created', code => {
  myRoomCode = code;
  document.getElementById('room-code-display').textContent = code;
});

socket.on('join-error', msg => {
  document.getElementById('join-error').textContent = msg;
});

socket.on('game-init', ({ yourId, players, gameOrder }) => {
  clearInterval(queueTimerInterval);
  myId = yourId;
  gs.players = players;
  gs.scores = Object.fromEntries(players.map(p => [p, 0]));
  gs.gameOrder = gameOrder;
  gs.totalRounds = gameOrder.length;
  document.getElementById('round-total').textContent = gs.totalRounds;
  runCountdown(3);
});

const GAME_BADGE_LABELS = {
  typing:    '⌨ COMMAND INJECTION',
  click:     '🖱 BUFFER OVERFLOW',
  memory:    '🧠 MEMORY DUMP',
  reaction:  '⚡ KERNEL PANIC',
  math:      '∑ HASH COLLISION',
  order:     '↕ STACK SORT',
  scramble:  '? BUFFER DECODE',
  whack:     '💀 PROCESS KILL',
  binary:    '01 BIT FLIP',
  stroop:    '◈ MEMORY CORRUPTION',
  hold:      '⏱ PRECISION TIMING',
  aim:       '◎ TARGET LOCK',
  simon:     '↑ INTERRUPT VECTOR',
  countdown: '⏰ RACE CONDITION',
  pipes:     '| PIPE REDIRECT',
};

socket.on('minigame-start', ({ type, round, of, command, grid, showDuration, duration, nums, scrambled, target, sequence, display }) => {
  gs.round = round;
  document.getElementById('round-num').textContent = round + 1;
  document.getElementById('round-total').textContent = of;
  document.getElementById('game-badge').textContent = GAME_BADGE_LABELS[type] || type.toUpperCase();
  updateHUD();
  showScreen('s-game');
  hideMinigames();

  if (type === 'typing')     startTyping(command);
  else if (type === 'click')     startClick(duration);
  else if (type === 'memory')    startMemory(grid, showDuration);
  else if (type === 'reaction')  startReaction();
  else if (type === 'math')      startMath();
  else if (type === 'order')     startOrder(nums);
  else if (type === 'scramble')  startScramble(scrambled);
  else if (type === 'whack')     startWhack(duration);
  else if (type === 'binary')    startBinary();
  else if (type === 'stroop')    startStroop();
  else if (type === 'hold')      startHold(target);
  else if (type === 'aim')       startAim(duration);
  else if (type === 'simon')     startSimon(sequence);
  else if (type === 'countdown') startCountdown(duration);
  else if (type === 'pipes')     startPipes(display);
});

socket.on('minigame-result', ({ winner, scores }) => {
  Object.assign(gs.scores, scores);
  showRoundResult(winner);
});

socket.on('game-over', ({ winner, scores }) => {
  Object.assign(gs.scores, scores);
  if (winner === null) showScreen('s-draw');
  else if (winner === myId) showWin();
  else showLose();
});

socket.on('opponent-left', () => showScreen('s-left'));

// ── Countdown ─────────────────────────────────────────────
function runCountdown(from) {
  showScreen('s-countdown');
  let n = from;
  const el = document.getElementById('countdown-num');
  function tick() {
    el.textContent = n;
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = 'cdpulse 1s ease-out';
    if (n <= 0) return;
    n--;
    setTimeout(tick, 1000);
  }
  tick();
}

// ── TYPING GAME ───────────────────────────────────────────
let typingTarget = '';
let typingDone = false;

function startTyping(cmd) {
  typingTarget = cmd;
  typingDone = false;

  const tgt = document.getElementById('typing-target');
  const ovl = document.getElementById('typing-overlay');
  const inp = document.getElementById('typing-input');
  const sts = document.getElementById('typing-status');

  tgt.textContent = cmd;
  ovl.innerHTML = '';
  inp.value = '';
  inp.disabled = false;
  sts.textContent = 'Opponent is typing...';

  document.getElementById('mg-typing').classList.remove('hidden');
  setTimeout(() => inp.focus(), 80);

  ['paste', 'copy', 'cut'].forEach(e => inp.addEventListener(e, ev => ev.preventDefault()));
  inp.addEventListener('contextmenu', e => e.preventDefault());

  inp.oninput = () => {
    if (typingDone) return;
    const typed = inp.value;
    let html = '';
    for (let i = 0; i < cmd.length; i++) {
      const ch = esc(cmd[i]);
      if (i < typed.length) {
        html += typed[i] === cmd[i]
          ? `<span class="c-ok">${ch}</span>`
          : `<span class="c-err">${ch}</span>`;
      } else {
        html += `<span class="c-dim">${ch}</span>`;
      }
    }
    ovl.innerHTML = html;

    if (typed === cmd) {
      typingDone = true;
      inp.disabled = true;
      sts.textContent = 'SUBMITTED — waiting for result...';
      socket.emit('typing-done');
    }
  };
}

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── CLICK GAME ────────────────────────────────────────────
let clickActive = false;
let clickCount = 0;
let clickTimer = null;
let clickCells = [];

function startClick(duration) {
  clickCount = 0;
  clickActive = true;
  document.getElementById('click-count').textContent = 0;
  document.getElementById('mg-click').classList.remove('hidden');

  const grid = document.getElementById('click-grid');
  grid.innerHTML = '';
  clickCells = [];

  const ROWS = 4, COLS = 6;
  for (let i = 0; i < ROWS * COLS; i++) {
    const cell = document.createElement('div');
    cell.className = 'cc';
    cell.addEventListener('click', () => {
      if (!clickActive || !cell.classList.contains('lit')) return;
      cell.classList.remove('lit');
      clickCount++;
      document.getElementById('click-count').textContent = clickCount;
      socket.emit('click-score', clickCount);
      spawnClickTarget();
    });
    clickCells.push(cell);
    grid.appendChild(cell);
  }

  spawnClickTarget();
  spawnClickTarget();
  spawnClickTarget();

  const fill = document.getElementById('click-fill');
  const start = Date.now();
  const barInterval = setInterval(() => {
    const pct = Math.max(0, 100 - ((Date.now() - start) / duration) * 100);
    fill.style.width = pct + '%';
    if (pct <= 0) clearInterval(barInterval);
  }, 80);

  clearTimeout(clickTimer);
  clickTimer = setTimeout(() => {
    clickActive = false;
    clickCells.forEach(c => { c.classList.remove('lit'); c.style.cursor = 'default'; });
    socket.emit('click-score', clickCount);
  }, duration);
}

function spawnClickTarget() {
  if (!clickActive) return;
  const inactive = clickCells.filter(c => !c.classList.contains('lit'));
  if (!inactive.length) return;
  inactive[Math.floor(Math.random() * inactive.length)].classList.add('lit');
}

// ── MEMORY GAME ───────────────────────────────────────────
let memCorrect = [];
let memSelected = [];
let memLocked = false;
let memCells = [];

function startMemory(grid, showDuration) {
  memCorrect = grid;
  memSelected = new Array(grid.length).fill(0);
  memLocked = true;
  memCells = [];

  const gridEl = document.getElementById('mem-grid');
  const submitBtn = document.getElementById('mem-submit');
  const label = document.getElementById('mem-label');
  const fill = document.getElementById('mem-fill');

  gridEl.innerHTML = '';
  submitBtn.classList.add('hidden');
  submitBtn.disabled = false;
  submitBtn.textContent = 'SUBMIT ANSWER';
  label.textContent = 'MEMORIZE THE PATTERN';

  fill.style.transition = `width ${showDuration}ms linear`;
  fill.style.width = '100%';
  setTimeout(() => { fill.style.width = '0%'; }, 20);

  document.getElementById('mg-memory').classList.remove('hidden');

  grid.forEach((val, i) => {
    const cell = document.createElement('div');
    cell.className = 'mc' + (val ? ' lit' : '');
    cell.addEventListener('click', () => {
      if (memLocked) return;
      cell.classList.toggle('sel');
      memSelected[i] = cell.classList.contains('sel') ? 1 : 0;
    });
    memCells.push(cell);
    gridEl.appendChild(cell);
  });

  setTimeout(() => {
    memCells.forEach(c => c.classList.remove('lit'));
    label.textContent = 'REPRODUCE THE PATTERN — CLICK TO MARK CELLS';
    submitBtn.classList.remove('hidden');
    memLocked = false;
  }, showDuration);
}

function submitMemory() {
  if (memLocked) return;
  memLocked = true;
  const btn = document.getElementById('mem-submit');
  btn.disabled = true;
  btn.textContent = 'SUBMITTED...';
  socket.emit('memory-submit', memSelected);
}

// ── REACTION GAME ─────────────────────────────────────────
let reactionDone = false;
let reactionSignalFired = false;

function startReaction() {
  reactionDone = false;
  reactionSignalFired = false;

  const btn = document.getElementById('reaction-btn');
  const status = document.getElementById('reaction-status');
  const result = document.getElementById('reaction-result');

  btn.className = 'reaction-btn reaction-wait';
  btn.disabled = false;
  status.textContent = 'STANDBY — WAIT FOR THE SIGNAL';
  result.textContent = '';
  document.getElementById('mg-reaction').classList.remove('hidden');
}

socket.on('reaction-go', () => {
  reactionSignalFired = true;
  const btn = document.getElementById('reaction-btn');
  const status = document.getElementById('reaction-status');
  if (btn) {
    btn.className = 'reaction-btn reaction-go';
    status.textContent = '⚡ CLICK NOW!';
  }
});

function doReactionClick() {
  if (reactionDone) return;
  reactionDone = true;
  document.getElementById('reaction-btn').disabled = true;
  document.getElementById('reaction-result').textContent = reactionSignalFired
    ? 'Clicked! Waiting...'
    : 'Too early! Submitting...';
  socket.emit('reaction-click');
}

// ── MATH GAME ─────────────────────────────────────────────
function startMath() {
  document.getElementById('mg-math').classList.remove('hidden');
  document.getElementById('math-progress').textContent = '0 / 5';
  document.getElementById('math-problem').textContent = '...';
  document.getElementById('math-feedback').textContent = '';
  const inp = document.getElementById('math-input');
  inp.value = '';
  inp.disabled = false;
  inp.onkeydown = e => { if (e.key === 'Enter') submitMath(); };
}

socket.on('math-question', ({ a, op, b, qnum, target, correct }) => {
  document.getElementById('math-problem').textContent = `${a} ${op} ${b} = ?`;
  document.getElementById('math-progress').textContent = `${qnum - 1} / ${target}`;
  const inp = document.getElementById('math-input');
  inp.value = '';
  inp.disabled = false;
  setTimeout(() => inp.focus(), 30);

  if (correct !== undefined) {
    const fb = document.getElementById('math-feedback');
    fb.textContent = correct ? '✓ CORRECT' : '✗ WRONG';
    fb.className = 'quiz-feedback ' + (correct ? 'fb-ok' : 'fb-err');
    setTimeout(() => { fb.textContent = ''; fb.className = 'quiz-feedback'; }, 700);
  }
});

function submitMath() {
  const inp = document.getElementById('math-input');
  const val = inp.value.trim();
  if (!val) return;
  inp.disabled = true;
  socket.emit('math-answer', { answer: val });
}

// ── ORDER GAME ────────────────────────────────────────────
let orderTarget = 1;
let orderMax = 9;

function startOrder(nums) {
  orderTarget = 1;
  orderMax = nums.length;

  document.getElementById('order-next-num').textContent = '1';
  const grid = document.getElementById('order-grid');
  grid.innerHTML = '';
  document.getElementById('mg-order').classList.remove('hidden');

  nums.forEach(n => {
    const cell = document.createElement('div');
    cell.className = 'oc';
    cell.textContent = n;
    cell.dataset.num = n;
    cell.addEventListener('click', () => {
      if (parseInt(cell.dataset.num) === orderTarget) {
        cell.classList.add('oc-done');
        cell.style.pointerEvents = 'none';
        orderTarget++;
        document.getElementById('order-next-num').textContent = orderTarget <= orderMax ? orderTarget : '✓';
        if (orderTarget > orderMax) socket.emit('order-done');
      } else {
        cell.classList.add('oc-wrong');
        setTimeout(() => cell.classList.remove('oc-wrong'), 300);
      }
    });
    grid.appendChild(cell);
  });
}

// ── SCRAMBLE GAME ─────────────────────────────────────────
function startScramble(scrambled) {
  document.getElementById('scramble-word').textContent = scrambled;
  document.getElementById('scramble-feedback').textContent = '';
  document.getElementById('scramble-feedback').className = 'quiz-feedback';
  const inp = document.getElementById('scramble-input');
  inp.value = '';
  inp.disabled = false;
  inp.onkeydown = e => { if (e.key === 'Enter') submitScramble(); };
  document.getElementById('mg-scramble').classList.remove('hidden');
  setTimeout(() => inp.focus(), 80);
}

socket.on('scramble-wrong', () => {
  const fb = document.getElementById('scramble-feedback');
  fb.textContent = '✗ INCORRECT';
  fb.className = 'quiz-feedback fb-err';
  const inp = document.getElementById('scramble-input');
  inp.value = '';
  setTimeout(() => { fb.textContent = ''; fb.className = 'quiz-feedback'; inp.focus(); }, 800);
});

function submitScramble() {
  const val = document.getElementById('scramble-input').value.trim();
  if (!val) return;
  socket.emit('scramble-answer', { answer: val });
}

// ── WHACK GAME ────────────────────────────────────────────
const PROCESSES = [
  'svchost.exe', 'malware.exe', 'ransomware.exe', 'virus.exe',
  'keylogger.exe', 'rootkit.exe', 'trojan.exe', 'spyware.exe',
  'adware.exe', 'backdoor.exe', 'exploit.exe', 'miner.exe',
  'botnet.exe', 'worm.exe', 'dropper.exe',
];
let whackActive = false;
let whackCount = 0;
let whackTimer = null;
let whackSpawnInterval = null;

function startWhack(duration) {
  whackCount = 0;
  whackActive = true;
  document.getElementById('whack-count').textContent = 0;
  document.getElementById('mg-whack').classList.remove('hidden');

  const arena = document.getElementById('whack-arena');
  arena.innerHTML = '';

  const fill = document.getElementById('whack-fill');
  const start = Date.now();
  const barInterval = setInterval(() => {
    const pct = Math.max(0, 100 - ((Date.now() - start) / duration) * 100);
    fill.style.width = pct + '%';
    if (pct <= 0) clearInterval(barInterval);
  }, 80);

  for (let i = 0; i < 3; i++) spawnProcess(arena);
  clearInterval(whackSpawnInterval);
  whackSpawnInterval = setInterval(() => {
    if (!whackActive) { clearInterval(whackSpawnInterval); return; }
    spawnProcess(arena);
  }, 700);

  clearTimeout(whackTimer);
  whackTimer = setTimeout(() => {
    whackActive = false;
    clearInterval(whackSpawnInterval);
    arena.innerHTML = '';
    socket.emit('whack-score', whackCount);
  }, duration);
}

function spawnProcess(arena) {
  if (!whackActive) return;
  const el = document.createElement('div');
  el.className = 'process-pill';
  el.textContent = PROCESSES[Math.floor(Math.random() * PROCESSES.length)];
  const w = arena.offsetWidth || 400;
  const h = arena.offsetHeight || 200;
  el.style.left = Math.max(0, Math.random() * (w - 160)) + 'px';
  el.style.top = Math.max(0, Math.random() * (h - 36)) + 'px';

  const life = 1800 + Math.random() * 2000;
  const timeout = setTimeout(() => { if (el.parentNode) el.remove(); }, life);

  el.addEventListener('click', () => {
    if (!whackActive) return;
    clearTimeout(timeout);
    el.remove();
    whackCount++;
    document.getElementById('whack-count').textContent = whackCount;
    socket.emit('whack-score', whackCount);
  });

  arena.appendChild(el);
}

// ── BINARY GAME ───────────────────────────────────────────
function startBinary() {
  document.getElementById('mg-binary').classList.remove('hidden');
  document.getElementById('binary-progress').textContent = '0 / 5';
  document.getElementById('binary-value').textContent = '...';
  document.getElementById('binary-choices').innerHTML = '';
  document.getElementById('binary-feedback').textContent = '';
}

socket.on('binary-question', ({ binary, choices, qnum, target, correct }) => {
  document.getElementById('binary-progress').textContent = `${qnum - 1} / ${target}`;
  document.getElementById('binary-value').textContent = binary;

  const choicesEl = document.getElementById('binary-choices');
  choicesEl.innerHTML = '';
  choices.forEach(c => {
    const btn = document.createElement('button');
    btn.className = 'btn btn-secondary binary-btn';
    btn.textContent = c;
    btn.onclick = () => {
      choicesEl.querySelectorAll('button').forEach(b => b.disabled = true);
      socket.emit('binary-answer', { choice: c });
    };
    choicesEl.appendChild(btn);
  });

  if (correct !== undefined) {
    const fb = document.getElementById('binary-feedback');
    fb.textContent = correct ? '✓ CORRECT' : '✗ WRONG';
    fb.className = 'quiz-feedback ' + (correct ? 'fb-ok' : 'fb-err');
    setTimeout(() => { fb.textContent = ''; fb.className = 'quiz-feedback'; }, 500);
  }
});

// ── STROOP GAME ───────────────────────────────────────────
const STROOP_CSS = { RED: '#ff2442', GREEN: '#39ff14', BLUE: '#4499ff', YELLOW: '#ffd700' };

function startStroop() {
  document.getElementById('mg-stroop').classList.remove('hidden');
  document.getElementById('stroop-progress').textContent = '0 / 5';
  document.getElementById('stroop-word').textContent = '...';
  document.getElementById('stroop-choices').innerHTML = '';
  document.getElementById('stroop-feedback').textContent = '';
}

socket.on('stroop-question', ({ word, displayColor, choices, qnum, target, correct }) => {
  document.getElementById('stroop-progress').textContent = `${qnum - 1} / ${target}`;
  const wordEl = document.getElementById('stroop-word');
  wordEl.textContent = word;
  wordEl.style.color = STROOP_CSS[displayColor];

  const choicesEl = document.getElementById('stroop-choices');
  choicesEl.innerHTML = '';
  choices.forEach(c => {
    const btn = document.createElement('button');
    btn.className = 'stroop-btn';
    btn.style.background = STROOP_CSS[c];
    btn.title = c;
    btn.onclick = () => {
      choicesEl.querySelectorAll('button').forEach(b => b.disabled = true);
      socket.emit('stroop-answer', { choice: c });
    };
    choicesEl.appendChild(btn);
  });

  if (correct !== undefined) {
    const fb = document.getElementById('stroop-feedback');
    fb.textContent = correct ? '✓' : '✗';
    fb.className = 'quiz-feedback ' + (correct ? 'fb-ok' : 'fb-err');
    setTimeout(() => { fb.textContent = ''; fb.className = 'quiz-feedback'; }, 350);
  }
});

// ── HOLD GAME ─────────────────────────────────────────────
let holdStartTime = null;
let holdTarget = 0;
let holdSubmitted = false;
let holdElapsedInterval = null;

function startHold(target) {
  holdTarget = target;
  holdStartTime = null;
  holdSubmitted = false;
  clearInterval(holdElapsedInterval);

  const btn = document.getElementById('hold-btn');
  btn.disabled = false;
  btn.classList.remove('hold-active');
  document.getElementById('hold-target-display').textContent = (target / 1000).toFixed(1) + 's';
  document.getElementById('hold-elapsed').textContent = '';
  document.getElementById('hold-status').textContent = '';
  document.getElementById('mg-hold').classList.remove('hidden');
}

function holdStart(e) {
  e.preventDefault();
  if (holdSubmitted || holdStartTime) return;
  holdStartTime = Date.now();
  document.getElementById('hold-btn').classList.add('hold-active');
  clearInterval(holdElapsedInterval);
  holdElapsedInterval = setInterval(() => {
    if (holdStartTime) {
      document.getElementById('hold-elapsed').textContent =
        ((Date.now() - holdStartTime) / 1000).toFixed(1) + 's';
    }
  }, 50);
}

function holdEnd(e) {
  e.preventDefault();
  if (!holdStartTime || holdSubmitted) return;
  clearInterval(holdElapsedInterval);
  const elapsed = Date.now() - holdStartTime;
  holdStartTime = null;
  holdSubmitted = true;
  const btn = document.getElementById('hold-btn');
  btn.disabled = true;
  btn.classList.remove('hold-active');
  document.getElementById('hold-elapsed').textContent = (elapsed / 1000).toFixed(2) + 's';
  document.getElementById('hold-status').textContent = `Held ${(elapsed / 1000).toFixed(2)}s — waiting...`;
  socket.emit('hold-result', { elapsed });
}

// ── AIM GAME ──────────────────────────────────────────────
let aimActive = false;
let aimCount = 0;
let aimTimer = null;

function startAim(duration) {
  aimActive = true;
  aimCount = 0;
  document.getElementById('aim-count').textContent = 0;
  document.getElementById('mg-aim').classList.remove('hidden');

  const arena = document.getElementById('aim-arena');
  const target = document.getElementById('aim-target');
  target.style.display = 'flex';
  moveAimTarget(arena, target);

  target.onclick = () => {
    if (!aimActive) return;
    aimCount++;
    document.getElementById('aim-count').textContent = aimCount;
    socket.emit('aim-score', aimCount);
    moveAimTarget(arena, target);
  };

  const fill = document.getElementById('aim-fill');
  const start = Date.now();
  const barInterval = setInterval(() => {
    const pct = Math.max(0, 100 - ((Date.now() - start) / duration) * 100);
    fill.style.width = pct + '%';
    if (pct <= 0) clearInterval(barInterval);
  }, 80);

  clearTimeout(aimTimer);
  aimTimer = setTimeout(() => {
    aimActive = false;
    target.style.display = 'none';
    socket.emit('aim-score', aimCount);
  }, duration);
}

function moveAimTarget(arena, target) {
  const size = 52;
  const w = arena.offsetWidth || 400;
  const h = arena.offsetHeight || 250;
  target.style.left = Math.max(0, Math.random() * (w - size)) + 'px';
  target.style.top = Math.max(0, Math.random() * (h - size)) + 'px';
}

// ── SIMON GAME ────────────────────────────────────────────
let simonSeq = [];
let simonUserSeq = [];
let simonActive = false;

function startSimon(sequence) {
  simonSeq = sequence;
  simonUserSeq = [];
  simonActive = false;

  document.getElementById('mg-simon').classList.remove('hidden');
  document.getElementById('simon-progress').textContent = '0 / ' + sequence.length;
  document.querySelectorAll('.simon-key').forEach(b => b.disabled = true);

  const chips = document.getElementById('simon-chips');
  chips.innerHTML = sequence.map(k => `<span class="simon-chip">${k}</span>`).join('');
  document.getElementById('simon-label').textContent = 'MEMORIZE THE SEQUENCE';

  let i = 0;
  const allChips = chips.querySelectorAll('.simon-chip');
  const iv = setInterval(() => {
    if (i > 0) allChips[i - 1].classList.remove('simon-chip-active');
    if (i >= sequence.length) {
      clearInterval(iv);
      setTimeout(() => {
        allChips.forEach(c => { c.textContent = '?'; c.classList.remove('simon-chip-active'); });
        document.getElementById('simon-label').textContent = 'REPEAT THE SEQUENCE — USE W/A/S/D';
        document.querySelectorAll('.simon-key').forEach(b => b.disabled = false);
        simonActive = true;
      }, 400);
      return;
    }
    allChips[i].classList.add('simon-chip-active');
    i++;
  }, 700);
}

function simonPress(key) {
  if (!simonActive) return;
  simonUserSeq.push(key);
  const idx = simonUserSeq.length - 1;
  const allChips = document.getElementById('simon-chips').querySelectorAll('.simon-chip');

  const btn = document.getElementById('sk-' + key);
  if (btn) {
    btn.classList.add('simon-key-flash');
    setTimeout(() => btn.classList.remove('simon-key-flash'), 150);
  }

  if (simonUserSeq[idx] !== simonSeq[idx]) {
    if (allChips[idx]) {
      allChips[idx].textContent = '✗';
      allChips[idx].classList.add('simon-chip-wrong');
    }
    simonUserSeq = [];
    document.getElementById('simon-progress').textContent = '0 / ' + simonSeq.length;
    setTimeout(() => {
      allChips.forEach(c => {
        c.textContent = '?';
        c.classList.remove('simon-chip-wrong', 'simon-chip-ok');
      });
    }, 500);
    return;
  }

  if (allChips[idx]) {
    allChips[idx].textContent = key;
    allChips[idx].classList.add('simon-chip-ok');
  }
  document.getElementById('simon-progress').textContent = simonUserSeq.length + ' / ' + simonSeq.length;

  if (simonUserSeq.length >= simonSeq.length) {
    simonActive = false;
    document.querySelectorAll('.simon-key').forEach(b => b.disabled = true);
    socket.emit('simon-done');
  }
}

document.addEventListener('keydown', e => {
  const k = e.key.toUpperCase();
  if (['W', 'A', 'S', 'D'].includes(k) && simonActive) {
    e.preventDefault();
    simonPress(k);
  }
});

// ── COUNTDOWN GAME ────────────────────────────────────────
let countdownInterval = null;
let countdownStopped = false;
let countdownLocalStart = null;
let countdownDuration = 10000;

function startCountdown(duration) {
  countdownDuration = duration;
  countdownStopped = false;
  countdownLocalStart = Date.now();

  document.getElementById('countdown-stop-btn').disabled = false;
  document.getElementById('countdown-stop-result').textContent = '';
  document.getElementById('countdown-race-timer').textContent = (duration / 1000).toFixed(3);
  document.getElementById('mg-countdown').classList.remove('hidden');

  clearInterval(countdownInterval);
  countdownInterval = setInterval(() => {
    const elapsed = Date.now() - countdownLocalStart;
    const remaining = Math.max(0, duration - elapsed);
    document.getElementById('countdown-race-timer').textContent = (remaining / 1000).toFixed(3);
    if (remaining <= 0) {
      clearInterval(countdownInterval);
      if (!countdownStopped) doCountdownStop();
    }
  }, 16);
}

function doCountdownStop() {
  if (countdownStopped) return;
  countdownStopped = true;
  clearInterval(countdownInterval);
  document.getElementById('countdown-stop-btn').disabled = true;
  const timerEl = document.getElementById('countdown-race-timer');
  document.getElementById('countdown-stop-result').textContent =
    `Stopped at ${timerEl.textContent}s — waiting...`;
  socket.emit('countdown-stop');
}

// ── PIPES GAME ────────────────────────────────────────────
function startPipes(display) {
  document.getElementById('pipes-display').textContent = display;
  document.getElementById('pipes-feedback').textContent = '';
  document.getElementById('pipes-feedback').className = 'quiz-feedback';
  const inp = document.getElementById('pipes-input');
  inp.value = '';
  inp.disabled = false;
  inp.onkeydown = e => { if (e.key === 'Enter') submitPipes(); };
  document.getElementById('mg-pipes').classList.remove('hidden');
  setTimeout(() => inp.focus(), 80);
}

socket.on('pipes-wrong', () => {
  const fb = document.getElementById('pipes-feedback');
  fb.textContent = '✗ INCORRECT';
  fb.className = 'quiz-feedback fb-err';
  const inp = document.getElementById('pipes-input');
  inp.value = '';
  setTimeout(() => { fb.textContent = ''; fb.className = 'quiz-feedback'; inp.focus(); }, 800);
});

function submitPipes() {
  const val = document.getElementById('pipes-input').value.trim();
  if (!val) return;
  socket.emit('pipes-answer', { answer: val });
}

// ── Round result ──────────────────────────────────────────
function showRoundResult(winner) {
  const titleEl = document.getElementById('rr-title');
  const subEl = document.getElementById('rr-sub');
  const tallyEl = document.getElementById('rr-tally');

  if (winner === myId) {
    titleEl.textContent = 'ROUND WON';
    titleEl.className = 'round-result-title rr-win';
    subEl.textContent = "Your opponent's defenses are crumbling.";
  } else if (!winner) {
    titleEl.textContent = 'DRAW';
    titleEl.className = 'round-result-title rr-draw';
    subEl.textContent = 'Evenly matched. Fight harder.';
  } else {
    titleEl.textContent = 'ROUND LOST';
    titleEl.className = 'round-result-title rr-lose';
    subEl.textContent = 'Your system vulnerabilities are showing.';
  }

  tallyEl.innerHTML = `<span style="color:var(--green)">YOU ${myScore()}</span>&nbsp;&nbsp;·&nbsp;&nbsp;<span style="color:var(--red)">OPP ${oppScore()}</span>`;
  showScreen('s-round');
}

// ── Win screen ────────────────────────────────────────────
function showWin() {
  showScreen('s-win');
  const term = document.getElementById('win-terminal');
  term.innerHTML = '';
  const lines = fakeFiles().slice(0, 24);
  let i = 0;
  const iv = setInterval(() => {
    if (i >= lines.length) { clearInterval(iv); return; }
    const d = document.createElement('div');
    d.textContent = lines[i++];
    term.appendChild(d);
    term.scrollTop = term.scrollHeight;
  }, 50);
}

// ── Lose screen ───────────────────────────────────────────
function showLose() {
  showScreen('s-lose');
  document.getElementById('lose-phase1').style.display = 'flex';
  document.getElementById('lose-phase2').classList.add('hidden');
  document.getElementById('lose-phase2-mac').classList.add('hidden');
  document.getElementById('lose-phase3').classList.add('hidden');

  const body = document.getElementById('lose-body');
  body.innerHTML = '';

  const os = detectOS();
  const lines = os === 'mac' ? [
    '$ sudo rm -rf /System /Library /usr /private',
    '> Scanning volume integrity...',
    '> STATUS: CRITICAL — PURGE SEQUENCE INITIATED',
    '> ',
    ...fakeFiles().map(f => `> Removing: ${f}    [████████] done`),
    '> ',
    '> /System/Library/dyld/dyld_shared_cache_arm64e  [████████] done',
    '> /private/var/db/dslocal/nodes/Default/         [████████] done',
    '> /Users/admin/Library/Keychains/               [████████] done',
    '> ',
    '> launchd: unrecoverable error — process table corrupt',
    '> IOKit: kernel extension load failed',
    '> panic(cpu 0 caller 0xffffff8000): SYS32_ROULETTE_GAME_LOSS',
  ] : [
    '> FATAL ERROR DETECTED IN PROCESS fatal.exe',
    '> Scanning system integrity...',
    '> STATUS: CRITICAL — INITIATING CLEANUP PROTOCOL',
    '> ',
    ...fakeFiles().map(f => `> Deleting: ${f}    [████████] 100%`),
    '> ',
    '> /etc/passwd                         [████████] 100%',
    '> /etc/shadow                         [████████] 100%',
    '> /bin/bash                           [████████] 100%',
    '> /usr/bin/python3                    [████████] 100%',
    '> /lib/x86_64-linux-gnu/libc.so.6    [████████] 100%',
    '> ',
    '> ALL SYSTEM FILES REMOVED',
    '> Terminating display driver...',
    '> Kernel panic — not syncing: VFS: Unable to mount root fs',
  ];

  let i = 0;
  function next() {
    if (i >= lines.length) { setTimeout(showBSOD, 600); return; }
    const d = document.createElement('div');
    d.textContent = lines[i++];
    body.appendChild(d);
    body.scrollTop = body.scrollHeight;
    setTimeout(next, i < 4 ? 380 : 28);
  }
  next();
}

function showBSOD() {
  document.getElementById('lose-phase1').style.display = 'none';
  const isMac = detectOS() === 'mac';
  const phase2Id = isMac ? 'lose-phase2-mac' : 'lose-phase2';
  document.getElementById(phase2Id).classList.remove('hidden');

  const fill = document.getElementById(isMac ? 'mac-fill' : 'bsod-fill');
  const pct = document.getElementById(isMac ? 'mac-pct' : 'bsod-pct');
  let p = 0;
  const iv = setInterval(() => {
    p += Math.random() * 2.5 + 0.5;
    if (p >= 100) {
      p = 100; clearInterval(iv);
      setTimeout(showReveal, 1800);
    }
    fill.style.width = p + '%';
    pct.textContent = isMac
      ? `Collecting panic info... ${Math.floor(p)}%`
      : `${Math.floor(p)}% complete`;
  }, 80);
}

function showReveal() {
  document.getElementById('lose-phase2').classList.add('hidden');
  document.getElementById('lose-phase2-mac').classList.add('hidden');
  document.getElementById('lose-phase3').classList.remove('hidden');
}

// ── Fake file list ────────────────────────────────────────
function fakeFiles() {
  const win = [
    'C:\\Windows\\System32\\ntdll.dll',
    'C:\\Windows\\System32\\kernel32.dll',
    'C:\\Windows\\System32\\user32.dll',
    'C:\\Windows\\System32\\gdi32.dll',
    'C:\\Windows\\System32\\advapi32.dll',
    'C:\\Windows\\System32\\shell32.dll',
    'C:\\Windows\\System32\\wininet.dll',
    'C:\\Windows\\System32\\msvcrt.dll',
    'C:\\Windows\\System32\\explorer.exe',
    'C:\\Windows\\System32\\lsass.exe',
    'C:\\Windows\\System32\\svchost.exe',
    'C:\\Windows\\System32\\winlogon.exe',
    'C:\\Windows\\System32\\csrss.exe',
  ];
  const lin = [
    '/bin/sh', '/bin/ls', '/bin/cat', '/bin/rm',
    '/usr/bin/python3', '/usr/lib/systemd/systemd',
    '/lib/libc.so.6', '/lib/libm.so.6',
    '/etc/hosts', '/etc/hostname', '/proc/self/exe',
  ];
  const mac = [
    '/System/Library/dyld/dyld_shared_cache_arm64e',
    '/System/Library/Frameworks/AppKit.framework/Versions/C/AppKit',
    '/System/Library/Frameworks/Foundation.framework/Versions/C/Foundation',
    '/System/Library/CoreServices/Finder.app/Contents/MacOS/Finder',
    '/System/Library/CoreServices/WindowServer',
    '/System/Library/CoreServices/SystemUIServer.app/Contents/MacOS/SystemUIServer',
    '/System/Library/Extensions/IOKit.kext/Contents/MacOS/IOKit',
    '/System/Library/LaunchDaemons/com.apple.security.syspolicy.plist',
    '/usr/lib/dyld',
    '/usr/bin/sudo',
    '/Applications/Safari.app/Contents/MacOS/Safari',
    '/Applications/System Preferences.app/Contents/MacOS/System Preferences',
    '/private/var/db/dslocal/nodes/Default/users/admin.plist',
    '/Users/admin/Library/Keychains/login.keychain-db',
    '/System/Volumes/Data/private/var/db/.AppleSetupDone',
  ];
  const os = detectOS();
  if (os === 'mac') return [...mac].sort(() => Math.random() - 0.5);
  return [...win, ...lin].sort(() => Math.random() - 0.5);
}
