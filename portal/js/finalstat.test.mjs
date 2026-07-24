// Committed regression guard for the Lv50 stat math (portal-v1.3.1 review W1).
// This is the highest-stakes code in the portal — wrong numbers silently
// mislead teambuilding — so it gets a node-runnable test in the repo, not
// just the scratch-dir browser harness.
//
// Run from the project root:
//
//     node portal/js/finalstat.test.mjs
//
// Formula (researcher-confirmed, see docs/data-supplements.md):
//     HP    = base + sp + 75                       (never nature-modified)
//     other = floor((base + sp + 20) * align)      align = 1.1 / 0.9 / 1.0
import { finalStat, finalStats, finalBst } from './data.js';

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

// Canonical vector 1 — Incineroar, Careful (+SpD -SpA), 32/0/14/0/20/0.
const INCIN = { hp: 95, atk: 115, def: 90, spa: 80, spd: 90, spe: 60 };
const incinFinals = finalStats(
  INCIN, { hp: 32, atk: 0, def: 14, spa: 0, spd: 20, spe: 0 }, 'spd', 'spa');
check('Incineroar Careful 32/0/14/0/20/0', incinFinals,
  { hp: 202, atk: 135, def: 124, spa: 90, spd: 143, spe: 80 });
check('Incineroar final BST', finalBst(incinFinals), 774);

// Canonical vector 2 — Garchomp, Jolly (+Spe -SpA), 2/32/0/0/0/32.
const CHOMP = { hp: 108, atk: 130, def: 95, spa: 80, spd: 85, spe: 102 };
const chompFinals = finalStats(
  CHOMP, { hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 }, 'spe', 'spa');
check('Garchomp Jolly 2/32/0/0/0/32', chompFinals,
  { hp: 185, atk: 182, def: 115, spa: 90, spd: 105, spe: 169 });
check('Garchomp final BST', finalBst(chompFinals), 846);

// Edges.
check('0-SP neutral stat = base + 20', finalStat('atk', 60, 0, null, null), 80);
check('HP ignores nature even if a nature names it',
  finalStat('hp', 95, 32, 'hp', 'spa'), 202);
// The discriminator: SP inside the multiplier gives 143; the rejected
// flat-+1-after-nature model would give 141.
check('SP is inside the nature multiplier (143, not 141)',
  finalStat('spd', 90, 20, 'spd', 'spa'), 143);

const noSp = finalStats(INCIN, undefined, null, null);
check('undefined spread is NaN-free (base-only calc)',
  Object.values(noSp).every(Number.isInteger), true);

if (failures) {
  console.error(`finalstat.test.mjs: ${failures} failure(s)`);
  process.exit(1);
}
console.log('finalstat.test.mjs: all checks pass');
