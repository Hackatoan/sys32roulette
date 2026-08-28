#!/usr/bin/env node
// Translates the per-player /play room strings (i18n/room.en.json) into each
// locale via Gemini, writing i18n/room.<loc>.json. Preserves {placeholders},
// <em> tags, emoji/symbols and brand/technical terms. Structure never changes —
// keys stay identical; only values are translated.
//   Usage: GEMINI_API_KEY=... node scripts/i18n-room-translate.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KEY = process.env.GEMINI_API_KEY;
if (!KEY) { console.error('GEMINI_API_KEY not set'); process.exit(1); }
const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';
const LOCALES = ['es', 'pt-br', 'fr', 'de', 'vi', 'th'];
const LANGNAME = { es: 'Spanish', 'pt-br': 'Brazilian Portuguese', fr: 'French', de: 'German', vi: 'Vietnamese', th: 'Thai' };
const KEEP = ['Sys32 Roulette', 'System 32 Roulette', 'System32', 'Hackatoa', 'GitHub', 'macOS', 'Windows', 'Linux', 'Mac', 'PC', 'W/A/S/D', 'WASD', 'GG', 'DEADLOCK', 'Console'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const src = JSON.parse(readFileSync(join(ROOT, 'i18n/room.en.json'), 'utf8'));

async function translateBatch(strings, langName, code) {
  if (!strings.length) return [];
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`;
  const prompt = `Translate each string in this JSON array from English into ${langName} (locale "${code}").
Return ONLY a JSON array of the same length and order — exactly one translation per input string.
Rules:
- Natural, idiomatic for native speakers. This is a competitive hacker-themed 1v1 browser game (a "system wipe" battler). Keep the punchy, terminal/hacker tone.
- Preserve leading/trailing whitespace of each string.
- Keep ALL of these EXACTLY, untranslated: {name} {sym} {label} {sec} {pct} {position} {total} placeholder tokens, any <em>...</em> HTML tags, emoji, and symbols (⚡ 💡 ✗ · — etc.).
- Do NOT translate brand/technical tokens: ${KEEP.join(', ')}.
- If a string is only a number/symbol/token, return it unchanged.
Input:
${JSON.stringify(strings)}`;
  for (let a = 1; a <= 6; a++) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 8192, responseMimeType: 'application/json' } }) });
    const data = await res.json().catch(() => ({}));
    const txt = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (txt) { try { const arr = JSON.parse(txt); if (Array.isArray(arr) && arr.length === strings.length) return arr; } catch {} }
    const s = data?.error?.status || res.status;
    console.warn(`    batch retry ${a} (${s})`);
    await sleep(s === 'RESOURCE_EXHAUSTED' ? 20000 : 2000 * a);
  }
  throw new Error('translateBatch failed');
}

const sections = ['static', 'runtime'];
for (const loc of LOCALES) {
  const out = { _meta: { generatedFrom: 'room.en.json', locale: loc, note: 'Gemini-generated. Do not hand-edit; regenerate via scripts/i18n-room-translate.mjs.' } };
  for (const sec of sections) {
    const keys = Object.keys(src[sec]);
    const vals = keys.map((k) => src[sec][k]);
    const tr = [];
    for (let i = 0; i < vals.length; i += 12) {
      const part = await translateBatch(vals.slice(i, i + 12), LANGNAME[loc], loc);
      tr.push(...part);
    }
    out[sec] = {};
    keys.forEach((k, i) => { out[sec][k] = tr[i]; });
  }
  writeFileSync(join(ROOT, `i18n/room.${loc}.json`), JSON.stringify(out, null, 2) + '\n');
  console.log(`${loc.padEnd(5)} -> i18n/room.${loc}.json`);
  await sleep(1000);
}
console.log('Done. Now run: node scripts/i18n-room-build.mjs');
