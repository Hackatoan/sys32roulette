#!/usr/bin/env node
// Translates the per-player /play room strings (i18n/room.en.json) into each
// locale via Gemini, writing i18n/room.<loc>.json. Preserves {placeholders},
// HTML tags (e.g. <em>), emoji/symbols and brand/technical terms. Structure
// never changes — keys stay identical; only values are translated.
//   Usage: GEMINI_API_KEY=... node scripts/i18n-room-translate.mjs
//
// Placeholders are protected generically: every {token} and HTML tag is swapped
// for an opaque %%N%% marker before the string goes to the model and swapped
// back afterwards. A reply is only accepted if every marker comes back exactly
// once, so a new placeholder can never be silently translated or dropped.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';
const LOCALES = ['es', 'pt-br', 'fr', 'de', 'vi', 'th'];
const LANGNAME = { es: 'Spanish', 'pt-br': 'Brazilian Portuguese', fr: 'French', de: 'German', vi: 'Vietnamese', th: 'Thai' };
const KEEP = ['Sys32 Roulette', 'System 32 Roulette', 'System32', 'Hackatoa', 'GitHub', 'macOS', 'Windows', 'Linux', 'Mac', 'PC', 'W/A/S/D', 'WASD', 'GG', 'DEADLOCK', 'Console'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// {name}-style placeholders (same shape window.t() substitutes) and HTML tags.
const TOKEN = /\{[A-Za-z0-9_]+\}|<\/?[A-Za-z][^<>]*>/g;
const MARK = /%%(\d+)%%/g;

export function protect(str) {
  const tokens = [];
  const text = String(str).replace(TOKEN, (m) => `%%${tokens.push(m) - 1}%%`);
  return { text, tokens };
}

// Returns the restored string, or null if the model dropped, duplicated or
// invented a marker (caller retries).
export function restore(text, tokens) {
  if (typeof text !== 'string') return null;
  const seen = new Array(tokens.length).fill(0);
  let bad = false;
  const out = text.replace(MARK, (m, i) => {
    i = +i;
    if (i >= tokens.length) { bad = true; return m; }
    seen[i]++;
    return tokens[i];
  });
  if (bad || seen.some((n) => n !== 1)) return null;
  return out;
}

async function translateBatch(strings, langName, code) {
  if (!strings.length) return [];
  const KEY = process.env.GEMINI_API_KEY;
  const prot = strings.map(protect);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`;
  const prompt = `Translate each string in this JSON array from English into ${langName} (locale "${code}").
Return ONLY a JSON array of the same length and order — exactly one translation per input string.
Rules:
- Natural, idiomatic for native speakers. This is a competitive hacker-themed 1v1 browser game (a "system wipe" battler). Keep the punchy, terminal/hacker tone.
- Preserve leading/trailing whitespace of each string.
- Every %%N%% marker (e.g. %%0%%, %%1%%) stands for a placeholder or HTML tag: keep each one EXACTLY, exactly once, moved to wherever it belongs in the translated sentence. Keep emoji and symbols (⚡ 💡 ✗ · — etc.).
- Do NOT translate brand/technical tokens: ${KEEP.join(', ')}.
- If a string is only a number/symbol/token, return it unchanged.
Input:
${JSON.stringify(prot.map((p) => p.text))}`;
  for (let a = 1; a <= 6; a++) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 8192, responseMimeType: 'application/json' } }) });
    const data = await res.json().catch(() => ({}));
    const txt = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    let s = data?.error?.status || res.status;
    if (txt) {
      try {
        const arr = JSON.parse(txt);
        if (Array.isArray(arr) && arr.length === strings.length) {
          const out = arr.map((t, i) => restore(t, prot[i].tokens));
          if (out.every((t) => t !== null)) return out;
          s = 'placeholder mismatch';
        }
      } catch {}
    }
    console.warn(`    batch retry ${a} (${s})`);
    await sleep(s === 'RESOURCE_EXHAUSTED' ? 20000 : 2000 * a);
  }
  throw new Error('translateBatch failed');
}

async function main() {
  if (!process.env.GEMINI_API_KEY) { console.error('GEMINI_API_KEY not set'); process.exit(1); }
  const src = JSON.parse(readFileSync(join(ROOT, 'i18n/room.en.json'), 'utf8'));

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
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
