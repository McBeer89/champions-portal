// data.js — model layer for the Champions portal.
//
// Everything that touches the network or does pure number-crunching lives
// here; there is no DOM in this module. The portal is served from the project
// root, so every dex file is fetched by absolute path (`/data/dex/...`) and
// works regardless of the current hash route.
//
// The percentage math for Smogon usage lists follows the verified
// D-normalization: every team slot carries exactly one ability, so the sum of
// ability weights approximates the total weighted team count and is the
// denominator for turning weights into percentages. Falls back to the item
// weight sum, then to raw weights when neither is available.

// Relative to the document (/portal/), NOT the domain root, so the same build
// works on the local server (127.0.0.1:8737/portal/) and on subpath hosting
// like GitHub Pages (…github.io/<repo>/portal/). '/api/owned' stays absolute:
// it only exists on the local serve.py, and its 404 elsewhere is the designed
// read-only-ownership degrade.
const DEX_BASE = '../data/dex';

let corePromise = null;
const monCache = new Map();

/** Fetch + parse JSON, throwing a readable error the UI can surface. */
async function fetchJson(path) {
  let res;
  try {
    res = await fetch(path, { cache: 'no-cache' });
  } catch (err) {
    throw new Error(`Could not reach ${path} — is the local server running? (${err.message})`);
  }
  if (!res.ok) {
    throw new Error(`${path} returned HTTP ${res.status}`);
  }
  return res.json();
}

/** Build a showdown_id -> entry lookup from an array of dex entries. */
function indexByShowdownId(list) {
  const map = new Map();
  for (const entry of list || []) {
    const id = entry && entry.showdown_id;
    if (id && !map.has(id)) map.set(id, entry);
  }
  return map;
}

/** Build a display-name -> entry lookup (in-game lists key by name). */
function indexByName(list) {
  const map = new Map();
  for (const entry of list || []) {
    const name = entry && entry.name;
    if (name && !map.has(name)) map.set(name, entry);
  }
  return map;
}

/**
 * Load the core, portal-wide data once (index + typechart + the three lookup
 * tables). Cached: repeated calls return the same promise.
 */
export function loadCore() {
  if (corePromise) return corePromise;
  corePromise = (async () => {
    const [index, typechart, moves, items, abilities] = await Promise.all([
      fetchJson(`${DEX_BASE}/portal-index.json`),
      fetchJson(`${DEX_BASE}/typechart.json`),
      fetchJson(`${DEX_BASE}/moves.json`),
      fetchJson(`${DEX_BASE}/items.json`),
      fetchJson(`${DEX_BASE}/abilities.json`),
    ]);
    // Ownership overrides come from serve.py's API. If it isn't available (e.g.
    // the portal is served with a plain static server), overrides stay null =
    // read-only: the seed roster still drives ownership, toggles just disable.
    let ownedOverrides = null;
    try {
      const res = await fetch('/api/owned', { cache: 'no-store' });
      if (res.ok) {
        const j = await res.json();
        ownedOverrides = (j && typeof j.overrides === 'object' && j.overrides) || {};
      }
    } catch {
      ownedOverrides = null;
    }
    // Reverse move index (for the Moves page). Tolerant of absence — older data
    // or a cold copy may not have it yet; the page shows an empty state.
    let movesIndex = {};
    try {
      movesIndex = await fetchJson(`${DEX_BASE}/moves-index.json`);
    } catch {
      movesIndex = {};
    }
    // Reverse ability index (for the Abilities page + overview ability filter).
    // Same tolerance as the moves index — absent on a cold/old copy.
    let abilitiesIndex = {};
    try {
      abilitiesIndex = await fetchJson(`${DEX_BASE}/abilities-index.json`);
    } catch {
      abilitiesIndex = {};
    }
    // Normalized move display-name -> showdown id, so the in-game signal's move
    // NAMES ("Fake Out") resolve to their `#/moves/<id>` page (same spirit as
    // the mon name-alias map). Keyed by normName so casing/punctuation folds.
    const moveNameToId = new Map();
    for (const [id, m] of Object.entries(movesIndex)) {
      if (m && m.name) moveNameToId.set(normName(m.name), id);
    }
    // Normalized ability display-name -> showdown id (for the overview's
    // ability typeahead, which reads a name and needs the id to filter).
    const abilityNameToId = new Map();
    for (const [id, a] of Object.entries(abilitiesIndex)) {
      if (a && a.name) abilityNameToId.set(normName(a.name), id);
    }
    const roster = index.roster || { confirmed: [], likely: [], unmatched: [] };
    // Mega forms have no page of their own — map each Mega's slugified name to
    // its base mon + form index so links like `charizard-mega-y` resolve to the
    // base page with that Mega pre-selected in the base/mega toggle.
    const megaToBase = new Map();
    for (const m of index.mons || []) {
      (m.megas || []).forEach((megaName, i) => {
        megaToBase.set(slugify(megaName), { base: m.slug, formIndex: i + 1 });
      });
    }
    return {
      index,
      typechart,
      moves: indexByShowdownId(moves),
      items: indexByShowdownId(items),
      abilities: indexByShowdownId(abilities),
      movesByName: indexByName(moves),
      itemsByName: indexByName(items),
      abilitiesByName: indexByName(abilities),
      movesIndex,
      moveNameToId,
      abilitiesIndex,
      abilityNameToId,
      sp: index.sp_system || {},
      natures: index.natures || {},
      freshness: index.freshness || null,
      monBySlug: new Map((index.mons || []).map((m) => [m.slug, m])),
      megaToBase,
      nameAlias: buildNameAliasMap(index.mons || []),
      ownedOverrides,
      ownedSeed: new Set([...(roster.confirmed || []), ...(roster.likely || [])]),
    };
  })();
  return corePromise;
}

// --- Ownership (server-persisted, shared across devices) ------------------

/** True when serve.py's ownership API is reachable (toggles are editable). */
export function ownedIsWritable(core) {
  return core.ownedOverrides !== null;
}

/**
 * Whether the PM owns *slug*: an explicit server override wins; otherwise fall
 * back to the roster seed (confirmed or likely, both collapsed to one boolean).
 */
export function effectiveOwned(core, slug) {
  const ov = core.ownedOverrides;
  if (ov && Object.prototype.hasOwnProperty.call(ov, slug)) return ov[slug];
  return core.ownedSeed.has(slug);
}

/** Optimistically set the local override (no-op in read-only mode). */
export function setOwnedLocal(core, slug, owned) {
  if (core.ownedOverrides) core.ownedOverrides[slug] = owned;
}

/** Persist an ownership change; returns the server's authoritative map. */
export async function postOwned(slug, owned) {
  const res = await fetch('/api/owned', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, owned }),
  });
  if (!res.ok) throw new Error(`server rejected the change (HTTP ${res.status})`);
  const j = await res.json();
  return (j && j.overrides) || {};
}

/** Fetch one Pokémon's self-contained file; returns null if it can't load. */
export async function getMon(slug) {
  if (monCache.has(slug)) return monCache.get(slug);
  let mon = null;
  try {
    mon = await fetchJson(`${DEX_BASE}/pokemon/${slug}.json`);
  } catch {
    mon = null;
  }
  monCache.set(slug, mon);
  return mon;
}

/**
 * Fetch an arbitrary dex JSON file by name (e.g. "game-info.json"), lazily.
 * Returns null instead of throwing when the file is absent/unreadable, so a
 * page can render a friendly "not built yet" state rather than error-looping.
 */
export async function getDexJson(name) {
  try {
    return await fetchJson(`${DEX_BASE}/${name}`);
  } catch {
    return null;
  }
}

// --- Lookups (showdown_id -> display name + tooltip) ----------------------

/** Tooltip text for a dex entry: the game's own official_desc when the pipeline
 *  has added it, else the short effect summary, else the full description.
 *  Defensive about official_desc — works whether or not the field exists. */
export function describeEntry(entry) {
  if (!entry) return '';
  return entry.official_desc || entry.pkmn_shortDesc || entry.description || '';
}

function describe(entry) {
  return describeEntry(entry);
}

/**
 * VP-cost caption for an item entry: "1,000 VP", or "Mega Stone — 2,000 VP" for
 * a Mega Stone. Empty when the item has no listed price (starter/free items) so
 * callers can append it conditionally without a stray separator.
 */
export function itemCostText(entry) {
  const price = entry && Number(entry.vp_price);
  if (!price) return '';
  const vp = `${price.toLocaleString('en-US')} VP`;
  return entry.mega_stone_for ? `Mega Stone — ${vp}` : vp;
}

export function moveInfo(core, showdownId) {
  const e = core.moves.get(showdownId);
  return { name: e ? e.name : titleize(showdownId), desc: describe(e), type: e && e.type, category: e && e.category };
}

export function itemInfo(core, showdownId) {
  const e = core.items.get(showdownId);
  return { name: e ? e.name : titleize(showdownId), desc: describe(e), cost: itemCostText(e) };
}

export function abilityInfo(core, showdownId) {
  const e = core.abilities.get(showdownId);
  return { name: e ? e.name : titleize(showdownId), desc: describe(e) };
}

/** Best-effort prettifier for a Showdown id with no lookup match. */
export function titleize(id) {
  if (!id) return '';
  return String(id).replace(/(^|[^a-z])([a-z])/g, (_, p, c) => p + c.toUpperCase());
}

// --- Usage percentage math ------------------------------------------------

function sumWeights(list) {
  return (list || []).reduce((acc, e) => acc + (Number(e.weight) || 0), 0);
}

/**
 * Denominator for turning weights into percentages within a cutoff block.
 * Prefers the ability-weight sum, falls back to items, else signals that the
 * caller should show raw weights.
 */
export function usageDenominator(block) {
  if (!block) return { d: null, mode: 'weights' };
  const ab = sumWeights(block.top_abilities);
  if (ab > 0) return { d: ab, mode: 'normalized' };
  const it = sumWeights(block.top_items);
  if (it > 0) return { d: it, mode: 'normalized' };
  return { d: null, mode: 'weights' };
}

/** Attach a `pct` (0-100, 1dp, clamped) to each {key, weight} entry. */
export function withPct(entries, d, limit) {
  const out = (entries || []).map((e) => ({
    key: e.key,
    weight: e.weight,
    pct: d ? Math.min(100, (100 * e.weight) / d) : null,
  }));
  return typeof limit === 'number' ? out.slice(0, limit) : out;
}

// --- Spreads --------------------------------------------------------------

/**
 * Parse a Smogon spread key ("Careful:32/0/14/0/20/0") into a nature plus an
 * SP object keyed by byteOrder (defaults hp/atk/def/spa/spd/spe).
 */
export function parseSpreadKey(key, byteOrder) {
  const order = byteOrder && byteOrder.length === 6
    ? byteOrder : ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
  const [nature, nums] = String(key).split(':');
  const parts = (nums || '').split('/').map((n) => parseInt(n, 10) || 0);
  const sp = {};
  order.forEach((stat, i) => { sp[stat] = parts[i] || 0; });
  return { nature, sp };
}

/** VP cost of an SP spread = total SP * vp_per_sp. */
export function vpCost(sp, vpPerSp) {
  const total = Object.values(sp || {}).reduce((a, v) => a + (Number(v) || 0), 0);
  return total * (Number(vpPerSp) || 0);
}

/** Format an SP object into the canonical HP/Atk/Def/SpA/SpD/Spe slash string. */
export function spString(sp, byteOrder) {
  const order = byteOrder && byteOrder.length === 6
    ? byteOrder : ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
  return order.map((k) => sp[k] ?? 0).join('/');
}

// --- Natures --------------------------------------------------------------

const STAT_LABEL_TO_KEY = {
  'HP': 'hp', 'Attack': 'atk', 'Defense': 'def',
  'Sp. Atk': 'spa', 'Sp. Def': 'spd', 'Speed': 'spe',
};

/** Map a battle_data stat label ("Sp. Def") to a canonical stat key. */
export function statLabelToKey(label) {
  return STAT_LABEL_TO_KEY[label] || null;
}

/**
 * Resolve a nature's boosted/lowered stat keys. Prefers the emitted nature
 * table; cross-checks against battle_data-supplied stat_up/stat_down and warns
 * (to console) on any mismatch so a bad table is caught, not silently trusted.
 */
export function natureArrows(core, name, statUp, statDown) {
  const table = core.natures[name];
  let up = table ? table.up : null;
  let down = table ? table.down : null;
  const bdUp = statLabelToKey(statUp);
  const bdDown = statLabelToKey(statDown);
  if (table && (statUp || statDown)) {
    if ((bdUp || null) !== (up || null) || (bdDown || null) !== (down || null)) {
      console.warn(`Nature mismatch for ${name}: table ${up}/${down} vs battle-data ${bdUp}/${bdDown}`);
    }
  }
  if (up == null && down == null && (bdUp || bdDown)) { up = bdUp; down = bdDown; }
  return { up, down };
}

// --- Lv50 final stats -----------------------------------------------------
// Confirmed Champions Lv50 formula (Bulbapedia "Stat point", corroborated by
// gamecards.gg / champdex.com / champsdex.com / rotomlabs.net, and reverse-
// verified 9/9 against championsbattledata.com/api/metadata Lv50 baselines —
// see docs/data-supplements.md). SP is INSIDE the nature multiplier, with a
// single floor and no intermediate rounding:
//   HP_final   = base + sp + 75                         (HP is never nature-modified)
//   Stat_final = floor((base + sp + 20) * align)        align = 1.1 up / 0.9 down / 1.0 neutral
// NOTE: sp-system.json's "1 SP = +1 stat" is the NEUTRAL-case training-cost
// descriptor only; a +nature stat gains ~1.1 per SP in the displayed value.

const FINAL_STAT_KEYS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];

/** One stat's Lv50 value under the given SP + nature up/down keys. */
export function finalStat(statKey, base, sp, upKey, downKey) {
  const b = Number(base) || 0;
  const s = Number(sp) || 0;
  if (statKey === 'hp') return b + s + 75;  // HP: never nature-modified
  const align = statKey === upKey ? 1.1 : statKey === downKey ? 0.9 : 1.0;
  return Math.floor((b + s + 20) * align);
}

/** All six Lv50 finals for a base-stats object + SP spread + nature keys. */
export function finalStats(stats, sp, upKey, downKey) {
  const out = {};
  for (const k of FINAL_STAT_KEYS) {
    out[k] = finalStat(k, (stats && stats[k]) || 0, (sp && sp[k]) || 0, upKey, downKey);
  }
  return out;
}

/** Sum of the six Lv50 finals (final BST). */
export function finalBst(finals) {
  return FINAL_STAT_KEYS.reduce((a, k) => a + (Number(finals[k]) || 0), 0);
}

// --- Speed tiers ----------------------------------------------------------
// Derived Lv50 Speed values for the Speed-tiers page. Uses the guarded
// finalStat() (never re-derives the formula): min = neutral nature + 0 SP,
// max = +Spe nature + full 32 SP, plus the doubled Tailwind value. Pure and
// string-free, so it is node-testable in isolation.

/** Base Speed -> {base, min, max, tailwind} Lv50 speed values. */
export function speedTierValues(baseSpe) {
  const base = Number(baseSpe) || 0;
  const min = finalStat('spe', base, 0, null, null);       // neutral, 0 SP
  const max = finalStat('spe', base, 32, 'spe', null);     // +Spe nature, 32 SP
  return { base, min, max, tailwind: max * 2 };
}

/**
 * Decorate + sort a pool of mons into speed-tier rows. Sorted fastest-first
 * by default; `trickRoom` flips to slowest-first (ascending). All four speed
 * columns are monotonic in base Speed, so ties are exactly same-base-Speed
 * mons — the page groups them visually. Ties break by name for a stable order.
 */
export function computeSpeedTiers(mons, opts = {}) {
  const trickRoom = !!opts.trickRoom;
  const rows = (mons || []).map((m) => {
    const base = (m.stats && typeof m.stats.spe === 'number')
      ? m.stats.spe : (typeof m.spe === 'number' ? m.spe : 0);
    return { ...m, spd: speedTierValues(base) };
  });
  rows.sort((a, b) => {
    const d = trickRoom ? a.spd.base - b.spd.base : b.spd.base - a.spd.base;
    if (d !== 0) return d;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });
  return rows;
}

// --- Priority-attack learners (⚡ badge) ----------------------------------

/**
 * slug -> [{name, priority}] for every mon that can LEARN a priority attack
 * (priority > 0, non-status), read from the reverse moves-index. Cheap — no
 * per-mon fetch, unlike the Stats page's battle-data hydration. Each mon's
 * list is sorted by priority desc so the badge tooltip leads with the highest.
 */
export function priorityAttackMap(movesIndex) {
  const map = new Map();
  for (const id of Object.keys(movesIndex || {})) {
    const mv = movesIndex[id];
    if (!mv || (mv.priority || 0) <= 0 || !mv.category || mv.category === 'status') continue;
    for (const slug of mv.learners || []) {
      if (!map.has(slug)) map.set(slug, []);
      map.get(slug).push({ name: mv.name, priority: mv.priority });
    }
  }
  for (const list of map.values()) {
    list.sort((a, b) => (b.priority - a.priority) || String(a.name).localeCompare(String(b.name)));
  }
  return map;
}

// --- Overview compose-filter (type AND ability AND move) ------------------

/**
 * Base mon slugs that hold a given ability, resolving Mega holders back to
 * their base species so the overview (which lists base mons) matches a mon
 * whose Mega has the ability. `validSlugs` and `megaToBase` are the core's
 * `monBySlug` + `megaToBase` maps (both expose `.has`/`.get`). Pure — takes
 * plain maps, so it is node-testable.
 */
export function abilityBaseSlugs(abilitiesIndex, abilityId, validSlugs, megaToBase) {
  const out = new Set();
  const entry = abilitiesIndex && abilitiesIndex[abilityId];
  if (!entry) return out;
  for (const h of entry.holders || []) {
    const slug = h && h.slug;
    if (!slug) continue;
    if (validSlugs && validSlugs.has(slug)) out.add(slug);
    else if (megaToBase && megaToBase.has(slug)) out.add(megaToBase.get(slug).base);
  }
  return out;
}

/** Set of base slugs that learn a given move (moves-index learners are already
 *  base slugs). Empty set when the id is absent. */
export function moveLearnerSlugs(movesIndex, moveId) {
  const entry = movesIndex && movesIndex[moveId];
  return new Set((entry && entry.learners) || []);
}

/**
 * Compose the overview filters with AND semantics. Each filter is optional:
 * a null `abilitySet`/`moveSet`/`ownedSet` means "don't constrain on this".
 * Pure (no DOM, no core) so the intersection logic is node-testable — callers
 * resolve the slug sets from core and pass them in.
 */
export function composeFilter(mons, opts = {}) {
  const q = (opts.search || '').trim().toLowerCase();
  const { type, abilitySet, moveSet, ownedSet } = opts;
  return (mons || []).filter((m) => {
    if (q && !(m.name || '').toLowerCase().includes(q)) return false;
    if (type && !(m.types || []).includes(type)) return false;
    if (abilitySet && !abilitySet.has(m.slug)) return false;
    if (moveSet && !moveSet.has(m.slug)) return false;
    if (ownedSet && !ownedSet.has(m.slug)) return false;
    return true;
  });
}

// --- Hash query (shareable filtered views) --------------------------------

/**
 * Parse the `?a=b&c=d` query tail of a hash string into a plain object. Safe
 * on a hash with no query (returns {}). Values are URI-decoded. Pure.
 */
export function parseHashQuery(hash) {
  const s = String(hash || '');
  const i = s.indexOf('?');
  const out = {};
  if (i < 0) return out;
  for (const pair of s.slice(i + 1).split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const k = eq < 0 ? pair : pair.slice(0, eq);
    const v = eq < 0 ? '' : pair.slice(eq + 1);
    if (k) {
      try { out[decodeURIComponent(k)] = decodeURIComponent(v); }
      catch { out[k] = v; }
    }
  }
  return out;
}

/** Build a `?a=b&c=d` query tail from an object, skipping empty values.
 *  Returns '' when nothing is set (so the base hash stays clean). Pure. */
export function buildHashQuery(params) {
  const parts = [];
  for (const [k, v] of Object.entries(params || {})) {
    if (v == null || v === '') continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

// --- Type matchups --------------------------------------------------------

const ATTACKING_TYPES = [
  'Normal', 'Fire', 'Water', 'Electric', 'Grass', 'Ice', 'Fighting', 'Poison',
  'Ground', 'Flying', 'Psychic', 'Bug', 'Rock', 'Ghost', 'Dragon', 'Dark',
  'Steel', 'Fairy',
];

/**
 * Defensive multipliers for a Pokémon's typing. Returns grouped buckets keyed
 * by multiplier (4, 2, 0.5, 0.25, 0); neutral (x1) is intentionally omitted.
 */
export function defensiveMatchups(core, types) {
  const chart = core.typechart || {};
  const groups = { 4: [], 2: [], 0.5: [], 0.25: [], 0: [] };
  for (const atk of ATTACKING_TYPES) {
    const row = chart[atk] || {};
    let mult = 1;
    for (const def of types) {
      const v = row[def];
      mult *= (typeof v === 'number' ? v : 1);
    }
    if (mult === 1) continue;
    if (groups[mult]) groups[mult].push(atk);
  }
  return groups;
}

// --- Roster coverage (owned-only defensive type grid) ---------------------
// Pure derivation for the #/coverage page. Takes plain data — the owned index
// rows ({slug,name,types}) and the typechart — so it never fetches per-mon
// files and is node-testable in isolation (see coverage.test.mjs). A missing
// chart cell defaults to ×1. (An offensive-coverage grid shipped briefly and
// was removed per PM 2026-07-12: movepools cover types a mon is weak to, so
// "best hit per defender type" isn't a reliable quantity.)

/** typechart[attackType][defendType], defaulting a missing cell to 1. */
function typeMult(typechart, attackType, defendType) {
  const row = (typechart || {})[attackType] || {};
  const v = row[defendType];
  return typeof v === 'number' ? v : 1;
}

/**
 * Defensive coverage over an owned pool. For each of the 18 attacking types, the
 * owned mons that are weak (×2/×4) vs those that resist/are immune (×0.5/×0.25/×0),
 * computed from each mon's typing via the chart. `pileUp` flags 3+ owned mons
 * sharing a weakness. Returns one row per attacking type.
 */
export function defensiveCoverage(ownedMons, typechart) {
  return ATTACKING_TYPES.map((atk) => {
    const weak = [];
    const resist = [];
    for (const mon of ownedMons || []) {
      let mult = 1;
      for (const t of mon.types || []) mult *= typeMult(typechart, atk, t);
      if (mult > 1) weak.push({ slug: mon.slug, name: mon.name, mult });
      else if (mult < 1) resist.push({ slug: mon.slug, name: mon.name, mult });
    }
    return {
      atk, weak, resist,
      weakCount: weak.length, resistCount: resist.length,
      pileUp: weak.length >= 3,
    };
  });
}

// --- Divergence fact (headline for the #/divergence page) -----------------
// Pure string formatting over a divergence-index row (built by
// build_portal_index.py). Picks the most-divergent category and phrases the
// single clearest concrete disagreement; node-tested (coverage.test.mjs) with
// plain fixture rows, no lookups.

const DIVERGENCE_ORDER = ['moves', 'items', 'abilities', 'natures'];
const DIVERGENCE_LABEL = {
  moves: { one: 'move', many: 'moves' },
  items: { one: 'item', many: 'items' },
  abilities: { one: 'ability', many: 'abilities' },
  natures: { one: 'nature', many: 'natures' },
};

/**
 * The single most divergent concrete fact for a divergence row, human-readable.
 * Prefers a rank-1 disagreement in the most-divergent category ("Showdown's #1
 * item is X; in-game runs Y #1"); if the #1 picks agree, names a concrete top-k
 * entry only one side runs. Returns an agreement line when nothing diverges.
 */
export function divergenceFact(row) {
  const cats = (row && row.cats) || {};
  let best = null;
  for (const c of DIVERGENCE_ORDER) {
    const cat = cats[c];
    if (!cat) continue;
    if (!best || (cat.div || 0) > (best.cat.div || 0)) best = { c, cat };
  }
  if (!best || (best.cat.div || 0) <= 0) {
    return 'Showdown and Pokémon Champions broadly agree on the tracked picks.';
  }
  const { c, cat } = best;
  const lab = DIVERGENCE_LABEL[c] || { one: c, many: c };
  const sd = cat.sd || [];
  const ig = cat.ig || [];
  if (sd[0] && ig[0] && normName(sd[0]) !== normName(ig[0])) {
    return `Showdown's #1 ${lab.one} is ${sd[0]}; Pokémon Champions runs ${ig[0]} #1.`;
  }
  const igKeys = new Set(ig.map(normName));
  const sdOnly = sd.find((x) => !igKeys.has(normName(x)));
  if (sdOnly) {
    return `Showdown runs ${sdOnly} among its top ${lab.many}; Pokémon Champions' top ${lab.many} don't.`;
  }
  const sdKeys = new Set(sd.map(normName));
  const igOnly = ig.find((x) => !sdKeys.has(normName(x)));
  if (igOnly) {
    return `Pokémon Champions runs ${igOnly} among its top ${lab.many}; Showdown's top ${lab.many} don't.`;
  }
  return 'Showdown and Pokémon Champions broadly agree on the tracked picks.';
}

// --- Delta badge ----------------------------------------------------------

/**
 * Classify a mon's ladder-vs-casual usage shift.
 *  ratio >= 1.25 & top-usage >= 2%  -> "top-ladder pick"
 *  ratio <= 0.75 & casual-usage >= 2% -> "casual favorite"
 */
export function deltaBadge(usage0, usage1760) {
  if (typeof usage0 !== 'number' || typeof usage1760 !== 'number' || usage0 <= 0) {
    return null;
  }
  const r = usage1760 / usage0;
  if (r >= 1.25 && usage1760 >= 0.02) {
    return { kind: 'top', label: '▲ top-ladder pick' };
  }
  if (r <= 0.75 && usage0 >= 0.02) {
    return { kind: 'casual', label: '▽ casual favorite' };
  }
  return null;
}

// --- Move effect chips ----------------------------------------------------
// Compact, human-readable tags summarising a move's structured @pkmn fields
// (flags + secondary / self / recoil / drain / multihit / willCrit) for the
// Moves page. Pure and string-only, so it is node-testable in isolation (see
// movechips.test.mjs). Priority is shown separately on the page — deliberately
// not repeated here.

// Physical-property flags worth surfacing — they drive abilities/items a player
// reasons about (Iron Fist, Rocky Helmet, Bulletproof, Wind Rider, Sharpness,
// Mega Launcher, Dancer, Safety Goggles). Engine-only flags
// (protect/mirror/metronome/reflectable/...) are intentionally omitted. The
// array order fixes the chip order.
const MOVE_FLAG_CHIPS = [
  ['contact', 'contact'], ['punch', 'punch'], ['sound', 'sound'],
  ['bite', 'bite'], ['slicing', 'slicing'], ['pulse', 'pulse'],
  ['bullet', 'bullet'], ['wind', 'wind'], ['dance', 'dance'],
  ['powder', 'powder'],
];

const STATUS_WORD = {
  brn: 'burn', par: 'paralyze', psn: 'poison', tox: 'badly poison',
  slp: 'sleep', frz: 'freeze',
};
const VOLATILE_WORD = { flinch: 'flinch', confusion: 'confuse' };
const CHIP_STAT = {
  hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe',
  accuracy: 'Acc', evasion: 'Eva',
};

/** Format a boosts object into "-1 Spe" / "-1 Def/SpD" / "+1 Atk", grouping
 *  stats that share the same delta so multi-stat drops read compactly. */
function formatBoosts(boosts) {
  const byDelta = new Map();
  for (const [stat, delta] of Object.entries(boosts || {})) {
    if (!delta) continue;
    if (!byDelta.has(delta)) byDelta.set(delta, []);
    byDelta.get(delta).push(CHIP_STAT[stat] || stat);
  }
  const parts = [];
  for (const [delta, stats] of byDelta) {
    parts.push(`${delta > 0 ? '+' : ''}${delta} ${stats.join('/')}`);
  }
  return parts.join(' ');
}

/** A [num, den] ratio as a whole-number percent ([1,2]→50, [33,100]→33). */
function fractionToPct(pair) {
  if (!Array.isArray(pair) || pair.length < 2 || !pair[1]) return null;
  return Math.round((100 * pair[0]) / pair[1]);
}

/**
 * Compact effect chips for a move, as an array of short strings — e.g. Fire
 * Punch → ["contact", "punch", "10% burn"]. Reads only the structured fields;
 * safe on a partial/empty move object (returns []).
 */
export function moveChips(move) {
  if (!move || typeof move !== 'object') return [];
  const chips = [];

  const flags = move.flags || {};
  for (const [key, label] of MOVE_FLAG_CHIPS) {
    if (flags[key]) chips.push(label);
  }

  const sec = move.secondary;
  if (sec && typeof sec === 'object') {
    const chance = typeof sec.chance === 'number' ? `${sec.chance}% ` : '';
    if (sec.status) chips.push(`${chance}${STATUS_WORD[sec.status] || sec.status}`);
    if (sec.volatileStatus) {
      chips.push(`${chance}${VOLATILE_WORD[sec.volatileStatus] || sec.volatileStatus}`);
    }
    if (sec.boosts) {
      const b = formatBoosts(sec.boosts);
      if (b) chips.push(`${chance}${b}`);
    }
    if (sec.self && sec.self.boosts) {
      const b = formatBoosts(sec.self.boosts);
      if (b) chips.push(`${chance}${b} self`);
    }
  }

  // Guaranteed self boosts (usually drawbacks: Close Combat → -1 Def/SpD).
  if (move.self && move.self.boosts) {
    const b = formatBoosts(move.self.boosts);
    if (b) chips.push(`${b} self`);
  }

  const mh = move.multihit;
  if (Array.isArray(mh) && mh.length === 2) chips.push(`hits ${mh[0]}–${mh[1]}`);
  else if (typeof mh === 'number' && mh > 1) chips.push(`hits ${mh}×`);

  const recoil = fractionToPct(move.recoil);
  if (recoil != null) chips.push(`${recoil}% recoil`);
  const drain = fractionToPct(move.drain);
  if (drain != null) chips.push(`${drain}% drain`);

  if (move.willCrit) chips.push('always crits');
  return chips;
}

// --- Formatting -----------------------------------------------------------

export function formatPct(value, dp = 1) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  return `${value.toFixed(dp)}%`;
}

export function fractionPct(value01, dp = 1) {
  if (typeof value01 !== 'number' || Number.isNaN(value01)) return '—';
  return `${(value01 * 100).toFixed(dp)}%`;
}

export function formatInt(n) {
  if (typeof n !== 'number' || Number.isNaN(n)) return '—';
  return n.toLocaleString('en-US');
}

/** Slugify a display name the same way the build script does. */
export function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/[—–]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const REGION_ADJ = { alola: 'alolan', hisui: 'hisuian', galar: 'galarian', paldea: 'paldean' };

/**
 * Aggressive name key: lowercase, strip everything but [a-z0-9]. So the game's
 * in-game name ("Alolan Ninetales"), Showdown's name ("Ninetales-Alola"), and
 * our slug ("ninetales-alola") all collapse toward the same shape and can be
 * matched against one another. Also folds "Mr. Rime" → "mrrime" (our slug).
 */
export function normName(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Build a normalized name → slug alias map so variant display names used in
 * link positions (in-game + Showdown teammates/counters) resolve to our dex
 * slugs, which follow different naming conventions: regional ADJECTIVE prefix
 * ("Alolan Ninetales") vs our SUFFIX slug (`ninetales-alola`); gender WORDS
 * / Showdown `-F`/`-M` vs our `-female`; "Forme" words vs bare slugs; "Mr."
 * punctuation. Data-driven from the index rows (`slug`, Showdown `name`,
 * `form` text) — no hand-listed spot fixes.
 *
 * Keys are {@link normName}-normalized. A mon's own exact name/slug (Pass 1)
 * always wins over any generated alias (Pass 2), so an alias can never shadow
 * another Pokémon's real name.
 */
export function buildNameAliasMap(mons) {
  const valid = new Set(mons.map((m) => m.slug));
  const alias = new Map();
  const putHard = (key, slug) => { if (key) alias.set(key, slug); };
  const putSoft = (key, slug) => { if (key && !alias.has(key)) alias.set(key, slug); };

  // Pass 1 — exact names win: each mon's own Showdown name and its slug.
  for (const m of mons) {
    putHard(normName(m.name), m.slug);
    putHard(normName(m.slug), m.slug);
  }

  // Pass 2 — generated variant aliases (never overwrite a Pass-1 exact name).
  for (const m of mons) {
    const slug = m.slug;
    const tokens = slug.split('-');
    const stem = normName(tokens[0]);                          // species stem, "ninetales"
    const showdownStem = normName(String(m.name).split('-')[0]); // "Lycanroc" etc

    // Regional forms: slug carries the region as a SUFFIX token; the in-game
    // name uses an adjective PREFIX ("Alolan Ninetales", "Paldean Tauros Aqua
    // Breed"). Register the prefix form(s).
    const regionIdx = tokens.findIndex((t) => REGION_ADJ[t]);
    if (regionIdx > 0) {
      const adj = REGION_ADJ[tokens[regionIdx]];
      const base = tokens.slice(0, regionIdx).join('');        // "tauros"
      const breed = tokens.slice(regionIdx + 1).join('');      // "aqua" or ""
      putSoft(normName(adj + base + breed), slug);             // alolanninetales / paldeantaurosaqua
      if (breed) putSoft(normName(adj + base + breed + 'breed'), slug); // paldeantaurosaquabreed
    }

    // Gender pairs: `<base>-female` ↔ the base (male) mon. In-game says
    // "<Base> Female"/"<Base> Male"; Showdown says "<Base>-F"/"<Base>-M".
    if (tokens[tokens.length - 1] === 'female') {
      const maleSlug = tokens.slice(0, -1).join('-');          // "basculegion"
      putSoft(stem + 'f', slug);                               // basculegionf → -female
      putSoft(stem + 'female', slug);
      if (valid.has(maleSlug)) {
        putSoft(stem + 'm', maleSlug);                         // basculegionm → base
        putSoft(stem + 'male', maleSlug);                      // basculegionmale → base
      }
    }

    // Forme words: the in-game name appends the form label to the species
    // ("Aegislash Shield Forme", "Lycanroc Dusk Form"). form_text routes it to
    // the RIGHT slug — a base's default forme (Aegislash→base) vs an alt forme
    // (Lycanroc-Dusk→-dusk) — which a slug-only rule can't tell apart.
    if (m.form) {
      const f = normName(m.form);                              // "shieldforme" / "duskform"
      putSoft(showdownStem + f, slug);
      if (f.endsWith('forme')) putSoft(showdownStem + f.slice(0, -1), slug); // …form
      else if (f.endsWith('form')) putSoft(showdownStem + f + 'e', slug);    // …forme
    }
  }
  return alias;
}
