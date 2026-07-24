// Committed regression guard + audit for variant-name link resolution
// (portal form-links pass). The in-game (championsbattledata) and Showdown
// signals name variant forms with conventions that diverge from our dex slugs
// (regional adjective prefix vs suffix, gender words vs -F/-M, "Forme" words,
// "Mr." punctuation). buildNameAliasMap() reconciles them; this test proves
// every name that appears in a LINK position resolves, and that the only
// leftovers are Pokémon genuinely absent from the dex.
//
// Run from the project root:
//
//     node portal/js/namealias.test.mjs
//
import { readFileSync, readdirSync } from 'node:fs';
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

// Mirror app.js monLinkSlug() exactly.
function resolve(name) {
  const s = slugify(name);
  if (validSlugs.has(s)) return s;
  if (megaSlugs.has(s)) return s;
  return alias.get(normName(name)) || null;
}

let failures = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`ok   ${label}`);
  else { failures += 1; console.error(`FAIL ${label}: got ${a}, want ${e}`); }
}

// --- 1. The variant names the PM saw as dead text now resolve --------------
const RESOLVES = {
  'Alolan Ninetales': 'ninetales-alola',
  'Galarian Slowking': 'slowking-galar',
  'Hisuian Avalugg': 'avalugg-hisui',
  'Hisuian Decidueye': 'decidueye-hisui',
  'Hisuian Typhlosion': 'typhlosion-hisui',
  'Hisuian Zoroark': 'zoroark-hisui',
  'Paldean Tauros Aqua Breed': 'tauros-paldea-aqua',
  'Basculegion Male': 'basculegion',       // gender word → base
  'Basculegion-F': 'basculegion-female',   // Showdown -F → -female
  'Meowstic-F': 'meowstic-female',
  'Meowstic-M': 'meowstic',
  'Aegislash Shield Forme': 'aegislash',   // base's default forme → base
  'Lycanroc Dusk Form': 'lycanroc-dusk',   // alt forme → -dusk (NOT base)
  'Mr. Rime': 'mrrime',                    // punctuation-folded to the slug
};
for (const [name, want] of Object.entries(RESOLVES)) check(name, resolve(name), want);

// --- 2. Generated aliases must NOT shadow a base mon's real name -----------
check('base "Ninetales" still → ninetales', resolve('Ninetales'), 'ninetales');
check('base "Tauros" still → tauros', resolve('Tauros'), 'tauros');
check('base "Basculegion" still → basculegion', resolve('Basculegion'), 'basculegion');
check('Mega path intact (Charizard-Mega-Y)', resolve('Charizard-Mega-Y'), 'charizard-mega-y');

// --- 3. Legitimately-absent forms stay unresolved (plain text) -------------
check('Floette-Eternal absent → null', resolve('Floette-Eternal'), null);
check('Meowstic-F-Mega absent → null', resolve('Meowstic-F-Mega'), null);

// --- 4. Full sweep: every name in a link position across the dataset -------
const names = new Set();
for (const f of readdirSync(join(DEX, 'pokemon'))) {
  if (!f.endsWith('.json')) continue;
  const d = readJson(join(DEX, 'pokemon', f));
  const u = d.usage || {};
  for (const cut of Object.values((u.by_cutoff) || {})) {
    for (const e of cut.top_teammates || []) if (e.key) names.add(e.key);
    for (const e of cut.top_counters || []) if (e.key) names.add(e.key);
  }
  const bd = d.battle_data || {};
  if (bd.present) for (const e of bd.top_teammates || []) if (e.name) names.add(e.name);
}
const unresolved = [...names].filter((n) => !resolve(n)).sort();
const resolvedCount = names.size - unresolved.length;
console.log(`\naudit: ${names.size} distinct link-position names — ` +
  `${resolvedCount} resolve, ${unresolved.length} unresolved`);
console.log(`audit: unresolved = ${JSON.stringify(unresolved)}`);
// The only acceptable leftovers are the two forms not present in the dex.
check('sweep leftovers are only the two absent forms', unresolved,
  ['Floette-Eternal', 'Meowstic-F-Mega']);

if (failures) {
  console.error(`\nnamealias.test.mjs: ${failures} failure(s)`);
  process.exit(1);
}
console.log('\nnamealias.test.mjs: all checks pass');
