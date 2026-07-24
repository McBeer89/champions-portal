// Committed regression guard for moveChips() — the pure function that turns a
// move's structured @pkmn fields (flags / secondary / self / recoil / drain /
// multihit / willCrit) into compact Moves-page tags. Priority is shown
// separately on the page, so it is deliberately never chipped here.
//
// Fixtures are real, trimmed shapes lifted from data/dex/moves.json (the
// structured fields come from @pkmn and are stable), so this is a true unit
// test of the ordering + wording — no DOM, no disk, no server.
//
// Run from the project root:
//
//     node portal/js/movechips.test.mjs
import { moveChips } from './data.js';

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

// --- A dozen+ real moves, one per interesting branch ----------------------
const FIRE_PUNCH = { flags: { contact: 1, punch: 1, protect: 1, mirror: 1 }, secondary: { chance: 10, status: 'brn' } };
check('Fire Punch — contact/punch + burn', moveChips(FIRE_PUNCH), ['contact', 'punch', '10% burn']);

const ROCK_SLIDE = { flags: { protect: 1, mirror: 1 }, secondary: { chance: 30, volatileStatus: 'flinch' } };
check('Rock Slide — flinch only (no contact)', moveChips(ROCK_SLIDE), ['30% flinch']);

const DRAIN_PUNCH = { flags: { contact: 1, punch: 1, heal: 1 }, drain: [1, 2] };
check('Drain Punch — contact/punch + 50% drain', moveChips(DRAIN_PUNCH), ['contact', 'punch', '50% drain']);

const ICICLE_SPEAR = { flags: { protect: 1, mirror: 1 }, multihit: [2, 5] };
check('Icicle Spear — hits 2–5', moveChips(ICICLE_SPEAR), ['hits 2–5']);

const BRAVE_BIRD = { flags: { contact: 1, distance: 1 }, recoil: [33, 100] };
check('Brave Bird — contact + 33% recoil', moveChips(BRAVE_BIRD), ['contact', '33% recoil']);

const CLOSE_COMBAT = { flags: { contact: 1 }, self: { boosts: { def: -1, spd: -1 } } };
check('Close Combat — self drop grouped', moveChips(CLOSE_COMBAT), ['contact', '-1 Def/SpD self']);

const FAKE_OUT = { flags: { contact: 1 }, secondary: { chance: 100, volatileStatus: 'flinch' }, priority: 3 };
check('Fake Out — 100% flinch, priority NOT chipped', moveChips(FAKE_OUT), ['contact', '100% flinch']);

const ICY_WIND = { flags: { wind: 1 }, secondary: { chance: 100, boosts: { spe: -1 } } };
check('Icy Wind — wind + 100% -1 Spe', moveChips(ICY_WIND), ['wind', '100% -1 Spe']);

const POWER_UP_PUNCH = { flags: { contact: 1, punch: 1 }, secondary: { chance: 100, self: { boosts: { atk: 1 } } } };
check('Power-Up Punch — self boost via secondary', moveChips(POWER_UP_PUNCH), ['contact', 'punch', '100% +1 Atk self']);

const FLARE_BLITZ = { flags: { contact: 1 }, secondary: { chance: 10, status: 'brn' }, recoil: [33, 100] };
check('Flare Blitz — burn then recoil', moveChips(FLARE_BLITZ), ['contact', '10% burn', '33% recoil']);

const STORM_THROW = { flags: { contact: 1 }, willCrit: true };
check('Storm Throw — always crits', moveChips(STORM_THROW), ['contact', 'always crits']);

const SWORDS_DANCE = { flags: { snatch: 1, dance: 1 } };
check('Swords Dance — dance flag only', moveChips(SWORDS_DANCE), ['dance']);

const TAKE_DOWN = { flags: { contact: 1 }, recoil: [1, 4] };
check('Take Down — 25% recoil', moveChips(TAKE_DOWN), ['contact', '25% recoil']);

const BOOMBURST = { flags: { sound: 1, bypasssub: 1 } };
check('Boomburst — sound flag', moveChips(BOOMBURST), ['sound']);

const BONEMERANG = { flags: { protect: 1, mirror: 1 }, multihit: 2 };
check('Bonemerang — fixed hits 2×', moveChips(BONEMERANG), ['hits 2×']);

const POPULATION_BOMB = { flags: { contact: 1, slicing: 1 }, multihit: 10 };
check('Population Bomb — slicing + hits 10×', moveChips(POPULATION_BOMB), ['contact', 'slicing', 'hits 10×']);

// --- Ordering probe: secondary status comes before multihit ---------------
const COMBINED = { flags: { contact: 1 }, secondary: { chance: 10, status: 'brn' }, multihit: [2, 5], recoil: [1, 4], drain: [1, 2], willCrit: true };
check('ordering: flags → secondary → multihit → recoil → drain → crit',
  moveChips(COMBINED),
  ['contact', '10% burn', 'hits 2–5', '25% recoil', '50% drain', 'always crits']);

// --- Edges: empty / partial / engine-only-flags → no chips ----------------
check('null move → []', moveChips(null), []);
check('empty object → []', moveChips({}), []);
check('engine-only flags → []', moveChips({ flags: { protect: 1, mirror: 1, metronome: 1 } }), []);
check('status-only move (no fields) → []', moveChips({ flags: {}, category: 'status' }), []);

if (failures) {
  console.error(`\nmovechips.test.mjs: ${failures} failure(s)`);
  process.exit(1);
}
console.log('\nmovechips.test.mjs: all checks pass');
