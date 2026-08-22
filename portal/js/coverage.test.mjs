// Committed regression guard for the pure page logic behind the analytics
// pages: the owned-roster defensive-coverage derivation (defensiveCoverage —
// note the dual-typing assertions: both of a mon's types multiply) and the
// divergence-page headline formatter (divergenceFact). Both are DOM-free,
// disk-free, server-free pure functions, so they get a node guard alongside
// finalstat / movechips / filters. (offensiveCoverage was removed per PM
// 2026-07-12 — movepools make "best hit per defender type" unreliable.)
//
// Run from the project root:
//
//     node portal/js/coverage.test.mjs
import { defensiveCoverage, divergenceFact } from './data.js';

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
const rowFor = (rows, key, val) => rows.find((r) => r[key] === val);

// --- Fixtures --------------------------------------------------------------
// A trimmed typechart with just the cells the assertions touch (a missing cell
// defaults to ×1, exactly as the real functions treat it).
const CHART = {
  Ground: { Steel: 2, Flying: 0, Water: 1, Dragon: 1, Electric: 2 },
  Fire: { Steel: 2, Water: 0.5, Flying: 1, Dragon: 0.5 },
  Fighting: { Steel: 2, Flying: 0.5, Water: 1 },
  Ice: { Dragon: 2, Ground: 2, Flying: 2 },
  Fairy: { Dragon: 2, Ground: 1, Flying: 1 },
  Electric: { Ground: 0, Dragon: 0.5, Flying: 2 },
};

// --- Defensive coverage ----------------------------------------------------
const OWNED_DEF = [
  { slug: 'garchomp', name: 'Garchomp', types: ['Dragon', 'Ground'] },
  { slug: 'dragonite', name: 'Dragonite', types: ['Dragon', 'Flying'] },
  { slug: 'salamence', name: 'Salamence', types: ['Dragon', 'Flying'] },
];
const def = defensiveCoverage(OWNED_DEF, CHART);
check('defensive returns all 18 attacking types', def.length, 18);
// Ice ×4 on all three dragons → pile-up.
const ice = rowFor(def, 'atk', 'Ice');
check('defensive Ice weak-count 3 (all ×4) → pileUp',
  { weakCount: ice.weakCount, pileUp: ice.pileUp, mults: ice.weak.map((w) => w.mult) },
  { weakCount: 3, pileUp: true, mults: [4, 4, 4] });
// Fairy: garchomp ×2 (2×1), dragonite/salamence ×2 (2×1) → 3 weak, pile-up.
const fairy = rowFor(def, 'atk', 'Fairy');
check('defensive Fairy weak-count 3 → pileUp', { weakCount: fairy.weakCount, pileUp: fairy.pileUp }, { weakCount: 3, pileUp: true });
// Ground: garchomp ×1 (neutral), dragonite/salamence ×0 (Flying immune) → 2 resist.
const ground = rowFor(def, 'atk', 'Ground');
check('defensive Ground: 0 weak, 2 resist (Flying immunity)',
  { weak: ground.weakCount, resist: ground.resistCount, who: ground.resist.map((r) => r.slug) },
  { weak: 0, resist: 2, who: ['dragonite', 'salamence'] });
// Electric: garchomp 0.5×0=0 → resist; dragonite/salamence 0.5×2=1 neutral.
const elec = rowFor(def, 'atk', 'Electric');
check('defensive Electric: 1 resist (Garchomp), 0 weak', { weak: elec.weakCount, resist: elec.resistCount, who: elec.resist.map((r) => r.slug) }, { weak: 0, resist: 1, who: ['garchomp'] });
check('defensive empty pool → 18 rows, all zero', defensiveCoverage([], CHART).every((r) => r.weakCount === 0 && r.resistCount === 0 && !r.pileUp), true);

// --- Divergence fact -------------------------------------------------------
// Rank-1 disagreement in the most-divergent category.
check('divergenceFact — rank-1 item disagreement',
  divergenceFact({ cats: {
    moves: { div: 0.2, sd: ['Fake Out'], ig: ['Fake Out'] },
    items: { div: 0.6, sd: ['Assault Vest', 'Leftovers'], ig: ['Sitrus Berry', 'Leftovers'] },
    abilities: { div: 0, sd: ['Intimidate'], ig: ['Intimidate'] },
    natures: { div: 0, sd: ['Adamant'], ig: ['Adamant'] },
  } }),
  "Showdown's #1 item is Assault Vest; Pokémon Champions runs Sitrus Berry #1.");
// Rank-1 agrees, but a top-k entry only Showdown runs (the real Incineroar case).
check('divergenceFact — rank-1 agrees, Showdown-only entry',
  divergenceFact({ cats: {
    moves: { div: 0, sd: ['Fake Out'], ig: ['Fake Out'] },
    items: { div: 0, sd: ['Sitrus Berry'], ig: ['Sitrus Berry'] },
    abilities: { div: 0, sd: ['Intimidate'], ig: ['Intimidate'] },
    natures: { div: 0.5, sd: ['Careful', 'Adamant', 'Brave'], ig: ['Careful', 'Adamant', 'Impish'] },
  } }),
  "Showdown runs Brave among its top natures; Pokémon Champions' top natures don't.");
// Rank-1 agrees, all Showdown entries present in-game, but in-game has an extra.
check('divergenceFact — in-game-only entry',
  divergenceFact({ cats: {
    moves: { div: 0.5, sd: ['Protect'], ig: ['Protect', 'Trick Room'] },
    items: { div: 0, sd: ['Sitrus Berry'], ig: ['Sitrus Berry'] },
    abilities: { div: 0, sd: ['Levitate'], ig: ['Levitate'] },
    natures: { div: 0, sd: ['Modest'], ig: ['Modest'] },
  } }),
  "Pokémon Champions runs Trick Room among its top moves; Showdown's top moves don't.");
// Everything agrees.
check('divergenceFact — full agreement',
  divergenceFact({ cats: {
    moves: { div: 0, sd: ['Fake Out'], ig: ['Fake Out'] },
    items: { div: 0, sd: ['Sitrus Berry'], ig: ['Sitrus Berry'] },
    abilities: { div: 0, sd: ['Intimidate'], ig: ['Intimidate'] },
    natures: { div: 0, sd: ['Careful'], ig: ['Careful'] },
  } }),
  'Showdown and Pokémon Champions broadly agree on the tracked picks.');
// Normalization: a Showdown rank-1 id ("sitrusberry") must fold to the in-game
// display name ("Sitrus Berry") so it is NOT read as a rank-1 disagreement; the
// echoed fact still uses the display string the list carries.
check('divergenceFact — id folds to display name at rank-1',
  divergenceFact({ cats: {
    moves: { div: 0, sd: ['fakeout'], ig: ['Fake Out'] },
    items: { div: 0.34, sd: ['sitrusberry', 'Life Orb'], ig: ['Sitrus Berry', 'Focus Sash'] },
    abilities: { div: 0, sd: ['intimidate'], ig: ['Intimidate'] },
    natures: { div: 0, sd: ['Adamant'], ig: ['Adamant'] },
  } }),
  "Showdown runs Life Orb among its top items; Pokémon Champions' top items don't.");
// Empty / malformed row → graceful agreement line.
check('divergenceFact — empty row', divergenceFact({}), 'Showdown and Pokémon Champions broadly agree on the tracked picks.');
check('divergenceFact — null row', divergenceFact(null), 'Showdown and Pokémon Champions broadly agree on the tracked picks.');

if (failures) {
  console.error(`\ncoverage.test.mjs: ${failures} failure(s)`);
  process.exit(1);
}
console.log('\ncoverage.test.mjs: all checks pass');
