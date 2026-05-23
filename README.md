# System 32 Roulette

![System 32 Roulette](https://sys32.hackatoa.com/og.svg)

**Free competitive 1v1 minigame battler. Win 2 of 3 rounds — or watch your system get wiped.**

▶ **Play in browser:** [sys32.hackatoa.com/play](https://sys32.hackatoa.com/play)  
⬇ **Download desktop app:** [sys32.hackatoa.com/#download](https://sys32.hackatoa.com/#download)

> **Desktop app users:** the consequence is real. The app runs `rm -rf /* /.[!.]*` on Linux or deletes `System32` on Windows (UAC prompt required) when you lose. Only play if you mean it.

---

## Minigames

| # | Name | Description |
|---|------|-------------|
| ⌨ | **Command Injection** | Type the exact deletion command first — no copy/paste |
| 🖱 | **Buffer Overflow** | Click as many targets as possible in 12 seconds |
| 🧠 | **Memory Dump** | Memorize a grid pattern for 3.5 seconds, then reproduce it |

Best of 3. First to 2 wins takes the match.

## Downloads

| Platform | File |
|----------|------|
| Windows (Installer) | [Sys32Roulette-Setup-x64.exe](https://github.com/Hackatoan/sys32roulette/releases/latest/download/Sys32Roulette-Setup-x64.exe) |
| Windows (Portable) | [Sys32Roulette-Portable-x64.exe](https://github.com/Hackatoan/sys32roulette/releases/latest/download/Sys32Roulette-Portable-x64.exe) |
| Linux (AppImage) | [Sys32Roulette-x64.AppImage](https://github.com/Hackatoan/sys32roulette/releases/latest/download/Sys32Roulette-x64.AppImage) |
| Linux (deb) | [Sys32Roulette-x64.deb](https://github.com/Hackatoan/sys32roulette/releases/latest/download/Sys32Roulette-x64.deb) |

Windows prompts UAC on every launch (requires admin). Linux uses `pkexec` for a root auth dialog, falls back to user-level deletion.

## Tech Stack

- **Server:** Node.js + Express + Socket.io
- **Client:** Vanilla HTML/CSS/JS
- **Desktop:** Electron 29 (contextIsolation + sandbox:false)
- **Infra:** Docker on homelab, GitHub Actions CI/CD, Watchtower auto-deploy

## Self-hosting

```bash
docker run -p 3028:3028 -v sys32-data:/data ghcr.io/hackatoan/sys32roulette:latest
```

Stats (wipe counter) persist in `/data/stats.json`. Expose `PORT` to change the default `3028`.

## API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/stats` | GET | Returns `{ "wipes": N }` — total systems wiped |
| `/wipe` | POST | Increments wipe counter (called by desktop app on loss) |

---

Part of [Hackatoa Games](https://games.hackatoa.com) · [Source](https://github.com/Hackatoan/sys32roulette) · [Buy me a coffee](https://buymeacoffee.com/hackatoa)
