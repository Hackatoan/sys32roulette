# System 32 Roulette

![System 32 Roulette](https://sys32.hackatoa.com/og.svg)

Competitive multiplayer minigame battler. Win 2 of 3 rapid rounds — or watch your opponent's "system get deleted." (it's fake, relax)

**▶ Play at [sys32.hackatoa.com/play](https://sys32.hackatoa.com/play)**  
**📣 About at [sys32.hackatoa.com](https://sys32.hackatoa.com)**

## Minigames

- **⌨ Command Injection** — type the deletion command exactly, first to finish wins
- **🖱 Buffer Overflow** — click as many targets as possible in 12 seconds
- **🧠 Memory Dump** — memorize a pattern, reproduce it from memory

## The Consequence

Loser gets a fake terminal scrolling system file deletions → BSOD → "jk lol". Dramatic. Harmless.

## Tech Stack

- Node.js + Express + Socket.io
- Vanilla HTML/CSS/JS
- Docker + GitHub Actions CI/CD

## Self-hosting

```bash
docker run -p 3028:3028 ghcr.io/hackatoan/sys32roulette:latest
```

---

Part of [Hackatoa Games](https://games.hackatoa.com) · [Buy me a coffee](https://buymeacoffee.com/hackatoa)
