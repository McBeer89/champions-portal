// Committed regression guard for TOURNAMENT mon-name/slug link resolution.
//
// The Tournaments page (#/tournaments) links every mon in a standings row or a
// team card to its dex page. Resolution (app.js `tournamentMonSlug`) prefers the
// scraped VR sprite slug, then falls back to display-name resolution via the
// same alias map the rest of the portal uses (app.js `monLinkSlug`). This test
// mirrors that logic EXACTLY and proves, against the real scraped
// data/dex/tournaments.json, that every mon reference resolves — except the
// handful of forms genuinely absent from the dex, which must stay plain text.
//
// Run from the project root:
//
//     node portal/js/tournaments.test.mjs
//
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildNameAliasMap, normName, slugify } from './data.js';

const DEX = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'dex');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf-8'));

const index = readJson(join(DEX, 'portal-index.json'));
const mons = index.mons || [];
const validSlugs = new Set(mons.map((m) => m.slug));
const megaSlugs = new Set();
for (const m of mons) for (const mn of m.megas || []) megaSlugs.add(slugify(mn));
const alias = buildNameAliasMap(mons);

// Mirror app.js monLinkSlug() exactly (display-name → slug, alias fallback).
function monLinkSlug(name) {
  const s = slugify(name);
  if (validSlugs.has(s)) return s;
  if (megaSlugs.has(s)) return s;
  return alias.get(normName(name)) || null;
}

// Mirror app.js tournamentMonSlug() exactly (scraped slug first, then name).
function resolve(mon) {
  const slug = mon && mon.slug;
  if (slug && (validSlugs.has(slug) || megaSlugs.has(slug))) return slug;
  return monLinkSlug((mon && mon.name) || '');
}

let failures = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`ok   ${label}`);
  else { failures += 1; console.error(`FAIL ${label}: got ${a}, want ${e}`); }
}

// --- 1. Fixed resolution cases (independent of the live scrape) ------------
check('mega by scraped slug', resolve({ name: 'Charizard Mega Y', slug: 'charizard-mega-y' }),
  'charizard-mega-y');
check('base by scraped slug', resolve({ name: 'Incineroar', slug: 'incineroar' }), 'incineroar');
check('regional by scraped slug', resolve({ name: 'Ninetales Alola', slug: 'ninetales-alola' }),
  'ninetales-alola');
// Slug absent but the display name still resolves via slugify/alias.
check('name fallback when slug missing', resolve({ name: 'Kommo O', slug: null }), 'kommo-o');
check('name fallback for a mega', resolve({ name: 'Gengar-Mega', slug: '' }), 'gengar-mega');
// A form genuinely absent from the dex stays unlinked (plain text).
check('dex-absent form → null', resolve({ name: 'Floette Eternal', slug: 'floette-eternal' }), null);

// --- 2. Full sweep over the real scraped tournaments.json ------------------
const TP = join(DEX, 'tournaments.json');
if (!existsSync(TP)) {
  console.log('\ntournaments.json not built — skipping the live sweep (run '
    + 'scripts/pull_tournaments.py to enable it).');
} else {
  const data = readJson(TP);
  const refs = new Map();  // slug|name key → {mon, count}
  const addMon = (m) => { if (m && m.name) refs.set(`${m.slug}|${m.name}`, m); };
  for (const ev of data.events || []) {
    for (const s of ev.standings || []) for (const m of s.team || []) addMon(m);
  }
  for (const t of data.teams || []) for (const m of t.mons || []) addMon(m);

  const unresolved = [...refs.values()].filter((m) => !resolve(m))
    .map((m) => m.name).sort();
  const distinctUnresolved = [...new Set(unresolved)];
  console.log(`\naudit: ${refs.size} distinct tournament mon references — `
    + `${refs.size - unresolved.length} resolve, ${unresolved.length} unresolved`);
  console.log(`audit: unresolved names = ${JSON.stringify(distinctUnresolved)}`);

  // The only acceptable leftovers are cosmetic/transfer forms absent from the
  // dex — never a real, linkable Pokémon. Guard the KNOWN-absent allowlist.
  const ALLOWED_ABSENT = new Set([
    'Floette-Eternal', 'Floette Eternal',
    'Maushold-Four', 'Maushold Four',
    'Vivillon-High-Plains', 'Vivillon High Plains',
  ]);
  const unexpected = distinctUnresolved.filter((n) => !ALLOWED_ABSENT.has(n));
  check('no unexpected unresolved tournament mons', unexpected, []);
}

if (failures) {
  console.error(`\ntournaments.test.mjs: ${failures} failure(s)`);
  process.exit(1);
}
console.log('\ntournaments.test.mjs: all checks pass');
