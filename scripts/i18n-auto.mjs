#!/usr/bin/env node
// Reusable auto-localizer for content-heavy static pages.
// Translates visible text nodes + SEO meta/attrs IN PLACE, protecting
// <script>/<style>/<code>/<pre> and never touching tags, ids, classes or scripts.
// Injects hreflang + a language switcher, fixes relative asset paths for
// /<locale>/ subdirs, and writes a hreflang sitemap. Config: i18n.config.json.
//
// Translations live in a committed cache, i18n/pages/<locale>.json, keyed by the
// exact English segment. Cached segments are reused verbatim; only segments
// missing from the cache are sent to Gemini. The cache is the source of truth
// for locale pages: to fix a translation, edit the cache (or hand-edit the
// locale page and re-run --seed) — a later run will keep it.
//   Usage:
//     GEMINI_API_KEY=... node scripts/i18n-auto.mjs  translate cache misses, rebuild pages
//     node scripts/i18n-auto.mjs --offline           rebuild purely from cache (default when
//                                                    no key is set); fails on any miss
//     node scripts/i18n-auto.mjs --seed              harvest the checked-in locale pages into
//                                                    the cache (aligned against the CURRENT
//                                                    English source — run before editing it)
//     add --prune to drop cache entries no current English segment uses
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(readFileSync(join(ROOT, 'i18n.config.json'), 'utf8'));
const ARGS = new Set(process.argv.slice(2));
const SEED = ARGS.has('--seed');
const PRUNE = ARGS.has('--prune');
const KEY = process.env.GEMINI_API_KEY;
const OFFLINE = SEED || ARGS.has('--offline') || !KEY;
for (const a of ARGS) if (!['--seed', '--offline', '--prune'].includes(a)) { console.error(`unknown arg ${a}`); process.exit(2); }
if (OFFLINE && !SEED) console.log(`offline mode${KEY ? '' : ' (GEMINI_API_KEY not set)'}: building from i18n/pages/*.json only`);
const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';
const ORIGIN = cfg.origin;
const LOCALES = cfg.locales;
const HREFLANG = { en: 'en', 'pt-br': 'pt-BR', es: 'es', fr: 'fr', de: 'de', vi: 'vi', th: 'th' };
const LABEL = { en: 'EN', es: 'ES', 'pt-br': 'PT', fr: 'FR', de: 'DE', vi: 'VI', th: 'TH' };
const LANGNAME = { es: 'Spanish', 'pt-br': 'Brazilian Portuguese', fr: 'French', de: 'German', vi: 'Vietnamese', th: 'Thai' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PROTECT = /<(script|style|code|pre)\b[\s\S]*?<\/\1>/gi;   // never translate these
const hasLetter = (s) => /[A-Za-z]/.test(s);
const protect = (html) => { const blocks = []; const out = html.replace(PROTECT, (m) => `%%${blocks.push(m) - 1}%%`); return { out, blocks }; };
const restore = (html, blocks) => html.replace(/%%(\d+)%%/g, (m, i) => blocks[+i]);

const markers = (str) => (str.match(/%%\d+%%/g) || []).sort().join(',');

async function translateBatch(strings, langName, code) {
  if (!strings.length) return [];
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`;
  const prompt = `Translate each string in this JSON array from English into ${langName} (locale "${code}").
Return ONLY a JSON array of the same length and order — exactly one translation per input string.
Rules:
- Natural, idiomatic for native speakers. This is a video-game website.
- Preserve leading/trailing whitespace of each string.
- Keep emoji, symbols (↓ ⬇ · — ✕ etc.), HTML entities (&nbsp; &amp; …) and any %%N%% tokens EXACTLY.
- Do NOT translate brand/proper names or technical tokens: ${(cfg.keepTerms || []).join(', ')}.
- If a string is only a number/symbol/token, return it unchanged.
Input:
${JSON.stringify(strings)}`;
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
          // %%N%% stands in for a whole <script>/<style>/<code>/<pre> block —
          // a reply that drops or alters one would delete that block.
          if (arr.every((t, i) => typeof t === 'string' && markers(t) === markers(strings[i]))) return arr;
          s = 'token mismatch';
        }
      } catch {}
    }
    console.warn(`    batch retry ${a} (${s})`);
    await sleep(s === 'RESOURCE_EXHAUSTED' ? 20000 : 2000 * a);
  }
  throw new Error('translateBatch failed');
}

// collect unique translatable English strings from a page
function collect(html) {
  const { out } = protect(html);
  const set = new Set();
  out.replace(/>([^<>]+)</g, (m, t) => { if (hasLetter(t)) set.add(t); return m; });
  const tm = out.match(/<title>([^<]+)<\/title>/i); if (tm && hasLetter(tm[1])) set.add(tm[1]);
  out.replace(/<meta\s+name="(?:description|keywords|twitter:title|twitter:description)"\s+content="([^"]*)"/gi, (m, c) => { if (hasLetter(c)) set.add(c); return m; });
  out.replace(/<meta\s+property="(?:og:title|og:description)"\s+content="([^"]*)"/gi, (m, c) => { if (hasLetter(c)) set.add(c); return m; });
  out.replace(/(?:placeholder|alt|aria-label)="([^"]*)"/gi, (m, v) => { if (hasLetter(v)) set.add(v); return m; });
  return [...set];
}

// apply value->translation map back to the page
function apply(html, map) {
  const { out, blocks } = protect(html);
  const tr = (v) => (map.has(v) && map.get(v) != null ? map.get(v) : v);
  // Attribute values are double-quoted: a translation that introduces a bare "
  // (e.g. 'dangerous' -> "peligroso") would end the attribute early.
  const trAttr = (v) => tr(v).replace(/"/g, '&quot;');
  let s = out
    .replace(/>([^<>]+)</g, (m, t) => (hasLetter(t) ? `>${tr(t)}<` : m))
    .replace(/<title>([^<]+)<\/title>/i, (m, t) => (hasLetter(t) ? `<title>${tr(t)}</title>` : m))
    .replace(/(<meta\s+name="(?:description|keywords|twitter:title|twitter:description)"\s+content=")([^"]*)(")/gi, (m, p, c, q) => `${p}${trAttr(c)}${q}`)
    .replace(/(<meta\s+property="(?:og:title|og:description)"\s+content=")([^"]*)(")/gi, (m, p, c, q) => `${p}${trAttr(c)}${q}`)
    .replace(/((?:placeholder|alt|aria-label)=")([^"]*)(")/gi, (m, p, v, q) => (hasLetter(v) ? `${p}${trAttr(v)}${q}` : m));
  return restore(s, blocks);
}

const pageUrl = (page, l) => `${ORIGIN}${l === 'en' ? '' : '/' + l}${page.urlPath}`;
const hreflangBlock = (page) => {
  const links = LOCALES.map((l) => `  <link rel="alternate" hreflang="${HREFLANG[l]}" href="${pageUrl(page, l)}" />`);
  links.push(`  <link rel="alternate" hreflang="x-default" href="${pageUrl(page, 'en')}" />`);
  return `\n  <!-- i18n:hreflang:start -->\n${links.join('\n')}\n  <!-- i18n:hreflang:end -->`;
};
const switcher = (page, cur) => {
  const items = LOCALES.map((l) => {
    const a = l === cur; const path = l === 'en' ? (page.urlPath || '/') : `/${l}${page.urlPath}`;
    return `<a href="${path}" hreflang="${HREFLANG[l]}"${a ? ' aria-current="true"' : ''} style="${a ? 'color:#fff;font-weight:700;' : 'color:#8a8;'}text-decoration:none;">${LABEL[l]}</a>`;
  });
  return `\n<!-- i18n:switcher:start -->\n<div id="lang-switch" style="position:relative;display:flex;justify-content:flex-end;padding:6px 10px;z-index:99999;font-family:system-ui,-apple-system,sans-serif"><button id="lang-btn" type="button" aria-label="Language" aria-haspopup="true" style="display:flex;align-items:center;justify-content:center;width:34px;height:34px;padding:0;background:rgba(6,10,6,.92);border:1px solid #1a3d1a;border-radius:999px;color:#8a8;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.5)"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><line x1="3" y1="12" x2="21" y2="12"/><ellipse cx="12" cy="12" rx="4" ry="9"/></svg></button><div id="lang-pop" role="menu" style="display:none;position:absolute;top:calc(100% + 8px);right:0;flex-direction:column;gap:8px;background:rgba(6,10,6,.95);border:1px solid #1a3d1a;border-radius:10px;padding:9px 12px;box-shadow:0 4px 16px rgba(0,0,0,.6);font-size:12px;white-space:nowrap">${items.join('\n  ')}</div></div>\n<script>(function(){var b=document.getElementById('lang-btn'),p=document.getElementById('lang-pop');if(!b||!p)return;var d=p.querySelector('a:not([aria-current])');if(d&&d.style&&d.style.color)b.style.color=d.style.color;b.addEventListener('click',function(e){e.stopPropagation();p.style.display=p.style.display==='flex'?'none':'flex';});p.addEventListener('click',function(e){e.stopPropagation();});document.addEventListener('click',function(){p.style.display='none';});})();</script>\n<!-- i18n:switcher:end -->`;
};
// Strip everything inject() adds — including the hk_lang setter, which sits
// outside the hreflang markers; leaving it behind made it pile up one copy per
// run (and leak the English setter into every locale page).
const strip = (h) => h
  .replace(/\s*<!-- i18n:hreflang:start -->[\s\S]*?<!-- i18n:hreflang:end -->/g, '')
  .replace(/\s*<script>try\{localStorage\.setItem\('hk_lang',"[^"]*"\)\}catch\(e\)\{\}<\/script>/g, '')
  .replace(/\s*<!-- i18n:switcher:start -->[\s\S]*?<!-- i18n:switcher:end -->/g, '');
const inject = (html, page, cur) => html
  .replace('</head>', `${hreflangBlock(page)}\n  <script>try{localStorage.setItem('hk_lang',${JSON.stringify(cur)})}catch(e){}</script>\n</head>`)
  .replace(/(<body[^>]*>)/, `$1${switcher(page, cur)}`);

const tagCount = (h) => (h.match(/<[a-zA-Z!\/][^>]*>/g) || []).length;
const idList = (h) => JSON.stringify([...h.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));

// Only write when content actually changed, and remember which URLs changed so
// sitemap <lastmod> moves only for those (a no-op run must not churn it).
const changedUrls = new Set();
const writeIfChanged = (path, content, url) => {
  if (existsSync(path) && readFileSync(path, 'utf8') === content) return;
  writeFileSync(path, content);
  changedUrls.add(url);
};

// ---- translation cache ----
// i18n/pages/<loc>.json = { segments: { "<English>": "<translation>" },
//                           pages: { "<file>": { "<English>": "<translation>" } } }
// `pages` holds per-page overrides for the rare segment that is deliberately
// translated differently on one page; it wins over `segments`.
const CACHE_DIR = join(ROOT, 'i18n/pages');
const cachePath = (loc) => join(CACHE_DIR, `${loc}.json`);
const loadCache = (loc) => {
  const c = existsSync(cachePath(loc)) ? JSON.parse(readFileSync(cachePath(loc), 'utf8')) : {};
  return { segments: c.segments || {}, pages: c.pages || {} };
};
const sortObj = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
const saveCache = (loc, c) => {
  const pages = {};
  for (const f of Object.keys(c.pages).sort()) if (Object.keys(c.pages[f]).length) pages[f] = sortObj(c.pages[f]);
  const json = JSON.stringify({ segments: sortObj(c.segments), pages }, null, 2) + '\n';
  mkdirSync(CACHE_DIR, { recursive: true });
  if (!existsSync(cachePath(loc)) || readFileSync(cachePath(loc), 'utf8') !== json) writeFileSync(cachePath(loc), json);
};
const lookup = (c, file, v) => c.pages[file]?.[v] ?? c.segments[v];

// Segment slots in the same order/shape apply() rewrites them. The <title> pass
// is covered by the text-node pass. Attribute values are stored unescaped
// (apply() re-escapes " to &quot;, so the round trip is exact).
const SLOTS = [
  ['text', />([^<>]+)</g],
  ['attr', /<meta\s+name="(?:description|keywords|twitter:title|twitter:description)"\s+content="([^"]*)"/gi],
  ['attr', /<meta\s+property="(?:og:title|og:description)"\s+content="([^"]*)"/gi],
  ['attr', /(?:placeholder|alt|aria-label)="([^"]*)"/gi],
];
// Align a checked-in locale page with its English source, slot by slot.
function harvest(src, locHtml, label) {
  const a = protect(src).out, b = protect(strip(locHtml)).out;
  const map = new Map();
  for (const [kind, rx] of SLOTS) {
    const en = [...a.matchAll(rx)].map((m) => m[1]), lo = [...b.matchAll(rx)].map((m) => m[1]);
    if (en.length !== lo.length) throw new Error(`${label}: ${kind} slot count ${en.length} (en) vs ${lo.length} — page out of sync with English source; cannot seed`);
    en.forEach((v, i) => {
      if (!hasLetter(v)) return;
      const t = kind === 'attr' ? lo[i].replace(/&quot;/g, '"') : lo[i];
      if (markers(t) !== markers(v)) throw new Error(`${label}: protected-block markers differ for ${JSON.stringify(v)}`);
      if (map.has(v) && map.get(v) !== t) throw new Error(`${label}: ${JSON.stringify(v)} translated two ways on one page (${JSON.stringify(map.get(v))} / ${JSON.stringify(t)}) — unify them first`);
      map.set(v, t);
    });
  }
  return map;
}

const outPathFor = (page, loc) => (page.file === cfg.rootFile ? join(ROOT, `public/${loc}/index.html`) : join(ROOT, `public/${loc}/${page.file}`));

// ---- run ----
const bases = {};
for (const page of cfg.pages) bases[page.file] = strip(readFileSync(join(ROOT, 'public', page.file), 'utf8'));
const NON_EN = LOCALES.filter((l) => l !== 'en');

if (SEED) {
  for (const loc of NON_EN) {
    const cache = loadCache(loc);
    const per = cfg.pages.filter((p) => existsSync(outPathFor(p, loc)))
      .map((p) => [p.file, harvest(bases[p.file], readFileSync(outPathFor(p, loc), 'utf8'), `${loc}/${p.file}`)]);
    const seen = new Set(per.flatMap(([, m]) => [...m.keys()]));
    for (const k of seen) { delete cache.segments[k]; for (const f in cache.pages) delete cache.pages[f][k]; }
    // first page (config order) sets the shared value; later pages that differ get an override
    for (const [file, m] of per) for (const [k, t] of m) {
      if (!(k in cache.segments)) cache.segments[k] = t;
      else if (cache.segments[k] !== t) (cache.pages[file] ||= {})[k] = t;
    }
    saveCache(loc, cache);
    const ov = Object.values(cache.pages).reduce((n, o) => n + Object.keys(o).length, 0);
    console.log(`seed  ${loc.padEnd(5)} -> ${Object.keys(cache.segments).length} segment(s), ${ov} page override(s)`);
  }
}

// Build everything in memory first; nothing is written if any segment is missing.
const writes = [];
for (const page of cfg.pages) writes.push([join(ROOT, 'public', page.file), inject(bases[page.file], page, 'en'), pageUrl(page, 'en')]);

let drift = 0;
const missing = [];
for (const loc of NON_EN) {
  const cache = loadCache(loc);
  const used = { segments: new Set(), pages: {} };
  let fresh = 0;
  for (const page of cfg.pages) {
    const src = bases[page.file];
    const uniq = collect(src);
    for (const v of uniq) {
      const t = lookup(cache, page.file, v);
      if (t != null && (typeof t !== 'string' || markers(t) !== markers(v)))
        throw new Error(`i18n/pages/${loc}.json: bad entry for ${JSON.stringify(v)} (protected-block markers must match the English)`);
    }
    for (const v of uniq) {
      if (cache.pages[page.file]?.[v] != null) (used.pages[page.file] ||= new Set()).add(v);
      else used.segments.add(v);
    }
    const miss = uniq.filter((v) => lookup(cache, page.file, v) == null);
    if (miss.length && OFFLINE) { for (const v of miss) missing.push(`${loc}/${page.file}: ${JSON.stringify(v)}`); continue; }
    for (let i = 0; i < miss.length; i += 12) {
      const part = await translateBatch(miss.slice(i, i + 12), LANGNAME[loc], loc);
      part.forEach((t, j) => { cache.segments[miss[i + j]] = t; });
      fresh += part.length;
      saveCache(loc, cache); // persist as we go — a crash mid-run must not waste paid calls
    }
    const map = new Map(uniq.map((v) => [v, lookup(cache, page.file, v)]));
    let out = apply(src, map);
    out = out.replace(/<html lang="en">/i, `<html lang="${loc}">`);
    out = out.replace(/\b(href|src)="(?!https?:|\/|#|data:|mailto:)([^"]+)"/g, (m, a, p) => `${a}="/${p}"`);
    // self-referential canonical + og:url for the localized page (both attr orders)
    const locUrl = pageUrl(page, loc);
    out = out.replace(/(<link\b[^>]*\brel="canonical"[^>]*\bhref=")[^"]*(")/i, `$1${locUrl}$2`)
             .replace(/(<link\b[^>]*\bhref=")[^"]*("[^>]*\brel="canonical")/i, `$1${locUrl}$2`)
             .replace(/(<meta\b[^>]*\bproperty="og:url"[^>]*\bcontent=")[^"]*(")/i, `$1${locUrl}$2`);
    // keep internal links in-locale (e.g. /play -> /<loc>/game.html)
    for (const [from, to] of Object.entries(cfg.internalLinks || {}))
      out = out.split(`href="${from}"`).join(`href="/${loc}${to}"`);
    if (tagCount(out) !== tagCount(src) || idList(out) !== idList(src)) { console.warn(`  ⚠ ${loc}/${page.file}: STRUCTURE DRIFT`); drift++; }
    writes.push([outPathFor(page, loc), inject(out, page, loc), locUrl]);
  }
  const stale = Object.keys(cache.segments).filter((k) => !used.segments.has(k)).length
    + Object.entries(cache.pages).reduce((n, [f, o]) => n + Object.keys(o).filter((k) => !used.pages[f]?.has(k)).length, 0);
  if (PRUNE && !missing.length) {
    for (const k of Object.keys(cache.segments)) if (!used.segments.has(k)) delete cache.segments[k];
    for (const [f, o] of Object.entries(cache.pages)) for (const k of Object.keys(o)) if (!used.pages[f]?.has(k)) delete o[k];
  }
  if (!OFFLINE || PRUNE) saveCache(loc, cache);
  console.log(`${loc.padEnd(5)} -> ${cfg.pages.length} page(s), ${fresh} newly translated${stale ? `, ${stale} unused cache entr${stale === 1 ? 'y' : 'ies'}${PRUNE ? ' pruned' : ' (--prune to drop)'}` : ''}`);
  if (fresh) await sleep(1200);
}

if (missing.length) {
  console.error(`\n✖ ${missing.length} segment(s) missing from i18n/pages/*.json — nothing written:\n  ${missing.join('\n  ')}`);
  console.error('Run with GEMINI_API_KEY set (without --offline) to translate them, or add them to the cache by hand.');
  process.exit(1);
}
for (const [path, content, url] of writes) { mkdirSync(dirname(path), { recursive: true }); writeIfChanged(path, content, url); }
console.log('en    -> hreflang + switcher injected into source pages');

const today = new Date().toISOString().slice(0, 10);
const sitemapPath = join(ROOT, 'public/sitemap.xml');
const prevLastmod = new Map();
if (existsSync(sitemapPath))
  for (const m of readFileSync(sitemapPath, 'utf8').matchAll(/<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g)) prevLastmod.set(m[1], m[2]);
const lastmod = (url) => (!changedUrls.has(url) && prevLastmod.get(url)) || today;
const urls = cfg.pages.flatMap((page) => LOCALES.map((l) => {
  const alts = LOCALES.map((x) => `    <xhtml:link rel="alternate" hreflang="${HREFLANG[x]}" href="${pageUrl(page, x)}"/>`).join('\n')
    + `\n    <xhtml:link rel="alternate" hreflang="x-default" href="${pageUrl(page, 'en')}"/>`;
  return `  <url>\n    <loc>${pageUrl(page, l)}</loc>\n    <lastmod>${lastmod(pageUrl(page, l))}</lastmod>\n${alts}\n  </url>`;
})).join('\n');
writeFileSync(sitemapPath, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls}\n</urlset>\n`);
console.log(`sitemap -> public/sitemap.xml\n${drift ? drift + ' page(s) drifted — inspect!' : 'Done. No structure drift.'}`);
