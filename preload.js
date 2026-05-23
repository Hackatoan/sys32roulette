'use strict';
const { ipcRenderer } = require('electron');

// Watch for the lose screen becoming active, then notify the main process.
// Runs in the renderer for every page load (including the remote game URL).
window.addEventListener('DOMContentLoaded', () => {
  function attachObserver() {
    const loseScreen = document.getElementById('s-lose');
    if (!loseScreen) {
      setTimeout(attachObserver, 400);
      return;
    }

    let fired = false;
    const observer = new MutationObserver(() => {
      if (!fired && loseScreen.classList.contains('active')) {
        fired = true;
        ipcRenderer.invoke('player-lost').catch(() => {});
      }
    });
    observer.observe(loseScreen, { attributes: true, attributeFilter: ['class'] });
  }

  attachObserver();
});
