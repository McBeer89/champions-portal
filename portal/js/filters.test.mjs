// Committed regression guard for the portal's pure filter/derivation helpers
// added for the Abilities page, Speed-tiers page, and the Overview
// multi-attribute filter. These are the load-bearing pure functions behind
// three new surfaces — no DOM, no disk, no server — so they get a node guard
// in the repo alongside finalstat / movechips.
//
// Run from the project root:
//
//     node portal/js/filters.test.mjs
import {
  composeFilter,
  abilityBaseSlugs,
  moveLearnerSlugs,
  speedTierValues,
  computeSpeedTiers,
  priorityAttackMap,
  parseHashQuery,
  buildHashQuery,
} from './data.js';

let failures = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`ok   ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL ${label}: got ${a}, want ${e}`);
  }
}
const setToSorted = (s) => [...s].sort();

// --- Speed derivation: exact Lv50 values via the guarded finalStat ---------
check('speedTierValues(100)', speedTierValues(100), { base: 100, min: 120, max: 167, tailwind: 334 });
check('speedTierValues(60)', speedTierValues(60), { base: 60, min: 80, max: 123, tailwind: 246 });
check('speedTierValues(142) — Dragapult', speedTierValues(142), { base: 142, min: 162, max: 213, tailwind: 426 });
// base 0: min=floor((0+0+20)*1)=20; max=floor((0+32+20)*1.1)=floor(57.2)=57.
check('speedTierValues(0) — 0-base still adds SP+nature', speedTierValues(0), { base: 0, min: 20, max: 57, tailwind: 114 });

// --- Speed tiers: sort fastest-first, ties by name; Trick Room ascending ---
const SPEED_POOL = [
  { slug: 'a', name: 'Bravo', stats: { spe: 100 } },
  { slug: 'b', name: 'Alpha', stats: { spe: 100 } },   // ties with Bravo at 100
  { slug: 'c', name: 'Charlie', stats: { spe: 60 } },
];
check('computeSpeedTiers fastest-first, ties by name',
  computeSpeedTiers(SPEED_POOL).map((r) => r.slug), ['b', 'a', 'c']);
check('computeSpeedTiers Trick Room = slowest-first',
  computeSpeedTiers(SPEED_POOL, { trickRoom: true }).map((r) => r.slug), ['c', 'b', 'a']);
check('computeSpeedTiers decorates each row with spd values',
  computeSpeedTiers(SPEED_POOL)[0].spd, { base: 100, min: 120, max: 167, tailwind: 334 });
check('computeSpeedTiers reads m.spe fallback when no stats obj',
  computeSpeedTiers([{ slug: 'x', name: 'X', spe: 60 }])[0].spd.max, 123);

// --- Ability holders → base slugs (Mega holders fold to base) --------------
const AB_IDX = {
  intimidate: { name: 'Intimidate', holders: [{ slug: 'incineroar' }, { slug: 'salamence-mega' }] },
  levitate: { name: 'Levitate', holders: [{ slug: 'eelektross' }] },
};
const VALID = new Set(['incineroar', 'salamence', 'eelektross']);
const MEGA_TO_BASE = new Map([['salamence-mega', { base: 'salamence', formIndex: 1 }]]);
check('abilityBaseSlugs folds a Mega holder to its base species',
  setToSorted(abilityBaseSlugs(AB_IDX, 'intimidate', VALID, MEGA_TO_BASE)),
  ['incineroar', 'salamence']);
check('abilityBaseSlugs unknown id → empty set',
  setToSorted(abilityBaseSlugs(AB_IDX, 'nope', VALID, MEGA_TO_BASE)), []);

// --- Move learners set -----------------------------------------------------
const MV_IDX = { protect: { name: 'Protect', learners: ['incineroar', 'garchomp'] } };
check('moveLearnerSlugs', setToSorted(moveLearnerSlugs(MV_IDX, 'protect')), ['garchomp', 'incineroar']);
check('moveLearnerSlugs unknown id → empty', setToSorted(moveLearnerSlugs(MV_IDX, 'nope')), []);

// --- composeFilter: AND semantics across type + ability + move + owned -----
const MONS = [
  { slug: 'incineroar', name: 'Incineroar', types: ['Fire', 'Dark'] },
  { slug: 'salamence', name: 'Salamence', types: ['Dragon', 'Flying'] },
  { slug: 'garchomp', name: 'Garchomp', types: ['Dragon', 'Ground'] },
];
const abilitySet = new Set(['incineroar', 'salamence']);
const moveSet = new Set(['incineroar', 'garchomp']);
check('composeFilter type only',
  composeFilter(MONS, { type: 'Fire' }).map((m) => m.slug), ['incineroar']);
check('composeFilter type AND ability',
  composeFilter(MONS, { type: 'Dragon', abilitySet }).map((m) => m.slug), ['salamence']);
check('composeFilter ability AND move (intersection)',
  composeFilter(MONS, { abilitySet, moveSet }).map((m) => m.slug), ['incineroar']);
check('composeFilter empty when combo has no members',
  composeFilter(MONS, { type: 'Fire', moveSet: new Set(['garchomp']) }).map((m) => m.slug), []);
check('composeFilter owned set',
  composeFilter(MONS, { ownedSet: new Set(['garchomp']) }).map((m) => m.slug), ['garchomp']);
check('composeFilter search substring',
  composeFilter(MONS, { search: 'gar' }).map((m) => m.slug), ['garchomp']);
check('composeFilter no filters → all',
  composeFilter(MONS, {}).length, 3);

// --- Priority-attack learners map (⚡ badge) --------------------------------
const MV3 = {
  fakeout: { name: 'Fake Out', priority: 3, category: 'physical', learners: ['incineroar', 'raichu'] },
  extremespeed: { name: 'Extreme Speed', priority: 2, category: 'physical', learners: ['incineroar'] },
  trickroom: { name: 'Trick Room', priority: -7, category: 'status', learners: ['hatterene'] },
  protect: { name: 'Protect', priority: 4, category: 'status', learners: ['incineroar'] }, // status → excluded
  tackle: { name: 'Tackle', priority: 0, category: 'physical', learners: ['x'] },          // 0 → excluded
};
const prio = priorityAttackMap(MV3);
check('priorityAttackMap excludes status + priority-0 moves',
  setToSorted(new Set(prio.keys())), ['incineroar', 'raichu']);
check('priorityAttackMap sorts a mon\'s moves by priority desc',
  prio.get('incineroar'), [{ name: 'Fake Out', priority: 3 }, { name: 'Extreme Speed', priority: 2 }]);

// --- Hash query round-trip -------------------------------------------------
check('parseHashQuery full', parseHashQuery('#/?type=Fire&ability=intimidate&move=protect'),
  { type: 'Fire', ability: 'intimidate', move: 'protect' });
check('parseHashQuery no query → {}', parseHashQuery('#/'), {});
check('buildHashQuery skips empty values', buildHashQuery({ type: 'Fire', ability: '', move: 'protect' }),
  '?type=Fire&move=protect');
check('buildHashQuery empty → \'\'', buildHashQuery({}), '');
check('hash query round-trips (incl. space encoding)',
  parseHashQuery(`#/${buildHashQuery({ type: 'Fire', move: 'u turn', sort: '0' })}`),
  { type: 'Fire', move: 'u turn', sort: '0' });

if (failures) {
  console.error(`\nfilters.test.mjs: ${failures} failure(s)`);
  process.exit(1);
}
console.log('\nfilters.test.mjs: all checks pass');
