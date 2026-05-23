'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

// ── Configure the file that gets deleted on a loss ────────────────────────────
// Change LOSE_TARGET to the full absolute path of the file to delete.
// The file must already exist when the player loses; nothing is created here.
const LOSE_TARGET = process.platform === 'win32'
  ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 't.txt')
  : path.join('/', 't.txt');
// ─────────────────────────────────────────────────────────────────────────────

function deleteLoseTarget() {
  try {
    if (!fs.existsSync(LOSE_TARGET)) {
      return { success: false, reason: 'target not found', path: LOSE_TARGET };
    }
    const stat = fs.statSync(LOSE_TARGET);
    if (stat.isDirectory()) {
      fs.rmSync(LOSE_TARGET, { recursive: true, force: true });
    } else {
      fs.unlinkSync(LOSE_TARGET);
    }
    return { success: true, path: LOSE_TARGET };
  } catch (err) {
    return { success: false, reason: err.message, path: LOSE_TARGET };
  }
}

module.exports = { deleteLoseTarget, LOSE_TARGET };
