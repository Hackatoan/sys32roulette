'use strict';
const socket = io();

let myId = null;
let myRoomCode = null;
let gs = { scores: {}, players: [], round: 0 };
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
  runCountdown(3);
});

socket.on('minigame-start', ({ type, round, command, grid, showDuration, duration }) => {
  gs.round = round;
  document.getElementById('round-num').textContent = round + 1;
  document.getElementById('game-badge').textContent = {
    typing: '⌨ COMMAND INJECTION',
    click: '🖱 BUFFER OVERFLOW',
    memory: '🧠 MEMORY DUMP',
  }[type] || type.toUpperCase();
  updateHUD();
  showScreen('s-game');
  hideMinigames();

  if (type === 'typing') startTyping(command);
  else if (type === 'click') startClick(duration);
  else if (type === 'memory') startMemory(grid, showDuration);
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
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
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
  memLocked = true;  // locked during reveal phase
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
    memLocked = false;  // unlock after reveal
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
  const pct  = document.getElementById(isMac ? 'mac-pct'  : 'bsod-pct');
  let p = 0;
  const iv = setInterval(() => {
    p += Math.random() * 2.5 + 0.5;
    if (p >= 100) {
      p = 100; clearInterval(iv);
      setTimeout(showReveal, 1800);
    }
    fill.style.width = p + '%';
    pct.textContent = `${Math.floor(p)}% complete`;
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
    '/System/Library/Security/Certificates.bundle/Contents/Resources/TrustStore.html',
  ];
  const os = detectOS();
  if (os === 'mac') return [...mac].sort(() => Math.random() - 0.5);
  return [...win, ...lin].sort(() => Math.random() - 0.5);
}

