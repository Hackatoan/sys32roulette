#!/usr/bin/env node
// Translates the per-player /play room strings (i18n/room.en.json) into each
// locale via Gemini, writing i18n/room.<loc>.json. Preserves {placeholders},
// HTML tags (e.g. <em>), emoji/symbols and brand/technical terms. Structure
// never changes — keys stay identical; only values are translated.
//   Usage:
//     GEMINI_API_KEY=... node scripts/i18n-room-translate.mjs
//         translate only keys missing from i18n/room.<loc>.json (or whose
//         {placeholders}/tags no longer match English); existing translations,
//         including hand fixes, are kept verbatim. Keys removed from
//         room.en.json are dropped.
//     node scripts/i18n-room-translate.mjs --offline
//         (default when no key is set) check every locale has every key with
//         matching placeholders; writes nothing, exits 1 on any miss.
//     add --all to re-translate every key from scratch (the old behaviour).
//
// room.<loc>.json is the committed translation cache and the source of truth:
// to fix a translation, edit it there and run i18n-room-build.mjs.
//
// Placeholders are protected generically: every {token} and HTML tag is swapped
// for an opaque %%N%% marker before the string goes to the model and swapped
// back afterwards. A reply is only accepted if every marker comes back exactly
// once, so a new placeholder can never be silently translated or dropped.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
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

const tokenSig = (str) => protect(str).tokens.slice().sort().join('\u0000');

async function main() {
  const ARGS = new Set(process.argv.slice(2));
  for (const a of ARGS) if (!['--offline', '--all'].includes(a)) { console.error(`unknown arg ${a}`); process.exit(2); }
  const ALL = ARGS.has('--all');
  const OFFLINE = ARGS.has('--offline') || !process.env.GEMINI_API_KEY;
  if (OFFLINE && ALL) { console.error('--all needs GEMINI_API_KEY'); process.exit(1); }
  if (OFFLINE) console.log(`offline mode${process.env.GEMINI_API_KEY ? '' : ' (GEMINI_API_KEY not set)'}: checking i18n/room.*.json only`);
  const src = JSON.parse(readFileSync(join(ROOT, 'i18n/room.en.json'), 'utf8'));

  const sections = ['static', 'runtime'];
  let totalMiss = 0;
  for (const loc of LOCALES) {
    const file = join(ROOT, `i18n/room.${loc}.json`);
    const prev = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
    const out = { _meta: { generatedFrom: 'room.en.json', locale: loc, note: 'Translation cache. Edit to fix a translation; scripts/i18n-room-translate.mjs keeps existing entries and only fills missing keys.' } };
    const misses = [];
    for (const sec of sections) {
      out[sec] = {};
      for (const k of Object.keys(src[sec])) {
        const have = prev[sec] && prev[sec][k];
        if (!ALL && typeof have === 'string' && tokenSig(have) === tokenSig(src[sec][k])) out[sec][k] = have;
        else misses.push([sec, k]);
      }
    }
    totalMiss += misses.length;
    if (OFFLINE) {
      if (misses.length) console.log(`${loc.padEnd(5)} missing/stale: ${misses.map(([s, k]) => `${s}.${k}`).join(', ')}`);
      else console.log(`${loc.padEnd(5)} ok`);
      continue;
    }
    for (let i = 0; i < misses.length; i += 12) {
      const part = misses.slice(i, i + 12);
      const tr = await translateBatch(part.map(([s, k]) => src[s][k]), LANGNAME[loc], loc);
      part.forEach(([s, k], n) => { out[s][k] = tr[n]; });
    }
    // Re-assemble in English key order so diffs stay minimal.
    for (const sec of sections) out[sec] = Object.fromEntries(Object.keys(src[sec]).map((k) => [k, out[sec][k]]));
    const next = JSON.stringify(out, null, 2) + '\n';
    const before = existsSync(file) ? readFileSync(file, 'utf8') : '';
    if (next !== before) writeFileSync(file, next);
    console.log(`${loc.padEnd(5)} -> i18n/room.${loc}.json (${misses.length} translated${next === before ? ', unchanged' : ''})`);
    if (misses.length) await sleep(1000);
  }
  if (OFFLINE && totalMiss) { console.error(`${totalMiss} missing/stale room strings — add them to i18n/room.<loc>.json or run with GEMINI_API_KEY`); process.exit(1); }
  console.log('Done. Now run: node scripts/i18n-room-build.mjs');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
