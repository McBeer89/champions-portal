// app.js — router + view assembly for the Champions portal.
//
// Hash routes: #/ (overview, with optional ?type=&ability=&move=&owned=&sort=
// filter query), #/mon/<slug> (detail), #/stats, #/moves, #/abilities,
// #/trends, #/about, and the "More ▾" pages #/speed (Speed tiers), #/pairs,
// #/divergence, #/coverage, #/tournaments (community results + notable teams),
// #/new (New in Champions), and #/ranks (Ranks & VP). Pulls model data from
// data.js, composes widgets from render.js.

import * as D from './data.js';
import * as R from './render.js';
import { describeEntry } from './data.js';

const { el, clear } = R;

const TYPES = [
  'Normal', 'Fire', 'Water', 'Electric', 'Grass', 'Ice', 'Fighting', 'Poison',
  'Ground', 'Flying', 'Psychic', 'Bug', 'Rock', 'Ghost', 'Dragon', 'Dark',
  'Steel', 'Fairy',
];

let CORE = null;
const appRoot = () => document.getElementById('app');

// --- Boot + routing -------------------------------------------------------

async function boot() {
  R.initTooltips();
  initTheme();
  const main = clear(appRoot());
  main.append(el('p', { class: 'loading', text: 'Loading dex…' }));
  try {
    CORE = await D.loadCore();
  } catch (err) {
    renderError(err);
    return;
  }
  window.addEventListener('hashchange', route);
  route();
}

function route() {
  const hash = location.hash || '#/';
  // Split off a `?query` tail (used by the overview's shareable filters) before
  // parsing the path — existing routes carry no query, so they're unaffected.
  const qIndex = hash.indexOf('?');
  const pathHash = qIndex >= 0 ? hash.slice(0, qIndex) : hash;
  const parts = pathHash.replace(/^#\/?/, '').split('/');
  const head = parts[0];
  setActiveNav(head);
  const main = clear(appRoot());
  if (head === 'mon' && parts[1]) {
    const raw = decodeURIComponent(parts[1]);
    const mega = CORE.megaToBase.get(raw);   // charizard-mega-y → base + form idx
    if (mega) renderDetail(main, mega.base, mega.formIndex);
    else renderDetail(main, raw, 0);
  } else if (head === 'stats') renderStats(main);
  else if (head === 'speed') renderSpeed(main);
  else if (head === 'moves') renderMoves(main, parts[1] ? decodeURIComponent(parts[1]) : null);
  else if (head === 'abilities') renderAbilities(main, parts[1] ? decodeURIComponent(parts[1]) : null);
  else if (head === 'trends') renderTrends(main);
  else if (head === 'pairs') renderPairs(main);
  else if (head === 'divergence') renderDivergence(main);
  else if (head === 'coverage') renderCoverage(main);
  else if (head === 'tournaments') renderTournaments(main);
  else if (head === 'new') renderNewInChampions(main);
  else if (head === 'ranks') renderRanksVp(main);
  else if (head === 'about') renderAbout(main);
  else renderOverview(main, D.parseHashQuery(hash));
  window.scrollTo(0, 0);
}

// --- Theme (Auto / Dark / Light) ------------------------------------------

const THEMES = ['auto', 'dark', 'light'];
const THEME_FACE = { auto: '◐ Auto', dark: '☾ Dark', light: '☀ Light' };

function currentTheme() {
  try {
    const t = localStorage.getItem('portal-theme');
    return THEMES.includes(t) ? t : 'auto';
  } catch { return 'auto'; }
}

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

/** Wire the nav Theme button: cycles Auto → Dark → Light, persisted per device. */
function initTheme() {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  let theme = currentTheme();
  const paint = () => {
    applyTheme(theme);
    clear(btn).append(THEME_FACE[theme]);
    btn.setAttribute('aria-label', `Theme: ${theme}. Click to cycle Auto, Dark, Light.`);
    btn.title = `Theme: ${theme} — click to cycle Auto / Dark / Light`;
  };
  paint();
  btn.addEventListener('click', () => {
    theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    try { localStorage.setItem('portal-theme', theme); } catch { /* storage blocked */ }
    paint();
    // Re-render the current view so the JS-computed stat-bar ramp (read from
    // CSS custom properties at render time) flips immediately with the theme.
    if (CORE) route();
  });
}

function setActiveNav(head) {
  // Every nav link (both rows) carries data-route; one pass highlights the
  // active page.
  document.querySelectorAll('nav a[data-route]').forEach((a) => {
    a.classList.toggle('active', a.dataset.route === (head || ''));
  });
}

function renderError(err) {
  const main = clear(appRoot());
  main.append(
    el('div', { class: 'notice error' },
      el('h2', { text: 'No Champions data yet' }),
      el('p', { text: 'The dex data hasn\'t been built on this machine.' }),
      el('p', {}, 'If this is a fresh copy, close this tab and run ',
        el('b', { text: 'serve.cmd' }),
        ' with an internet connection — the first launch downloads the data '
        + '(a few minutes), then the portal opens automatically.'),
      el('p', { class: 'muted', text: 'If the data should already be here, make sure the local server (serve.cmd) is still running, then refresh.' }),
      el('p', { class: 'muted small', text: `(details: ${err.message})` }),
    ),
  );
}

// --- Shared bits ----------------------------------------------------------

function backLink() {
  return el('a', { class: 'back-link', href: '#/' }, '← All Pokémon');
}

/** A segmented button control. `options` = [{value,label}]. */
function segmented(options, value, onChange) {
  const group = el('div', { class: 'segmented', role: 'tablist' });
  let current = value;  // track the live selection so returning to the initial
  options.forEach((opt) => {                              // option still fires.
    const btn = el('button', {
      class: `seg ${opt.value === current ? 'active' : ''}`,
      type: 'button',
    }, opt.label);
    btn.addEventListener('click', () => {
      if (opt.value === current) return;
      current = opt.value;
      group.querySelectorAll('.seg').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      onChange(opt.value);
    });
    group.append(btn);
  });
  return group;
}

function typeBadges(types) {
  return el('span', { class: 'type-badges' }, (types || []).map((t) => R.typeBadge(t)));
}

/** A brief, auto-dismissing bottom toast for non-blocking notices. */
function notify(msg) {
  let host = document.getElementById('toast-host');
  if (!host) { host = el('div', { id: 'toast-host' }); document.body.append(host); }
  const t = el('div', { class: 'toast', role: 'status' }, msg);
  host.append(t);
  setTimeout(() => { t.classList.add('hide'); setTimeout(() => t.remove(), 300); }, 3500);
}

/**
 * Ownership control for a slug. Editable (a real toggle button) when serve.py's
 * API is reachable; a static indicator otherwise (read-only). `opts.labeled`
 * renders the wordier detail-header variant. Optimistic update with revert +
 * toast on server failure. Click never bubbles to a row navigation.
 */
function ownedControl(slug, opts = {}) {
  const writable = D.ownedIsWritable(CORE);
  const wrap = el('span', { class: 'own-wrap' });
  const face = (on) => (opts.labeled
    ? (on ? '✓ I have this' : '○ Not in my roster')
    : (on ? '✓' : '○'));

  const render = () => {
    clear(wrap);
    const on = D.effectiveOwned(CORE, slug);
    if (!writable) {
      const ind = el('span', { class: `owned ${on ? 'yes' : 'no'} ${opts.labeled ? 'labeled' : ''}` },
        face(on));
      R.tip(ind, `${on ? 'You have this' : 'Not owned'} — read-only; serve with serve.cmd to edit`);
      wrap.append(ind);
      return;
    }
    const btn = el('button', {
      type: 'button',
      class: `own-toggle ${on ? 'on' : ''} ${opts.labeled ? 'labeled' : ''}`,
      'aria-pressed': String(on),
      'aria-label': on ? 'Owned — click to unmark' : 'Not owned — click to mark',
    }, face(on));
    R.tip(btn, on ? 'You have this — click to unmark' : 'Click to mark as owned (saved automatically)');
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const next = !D.effectiveOwned(CORE, slug);
      D.setOwnedLocal(CORE, slug, next);   // optimistic
      render();
      if (opts.onChange) opts.onChange();
      try {
        CORE.ownedOverrides = await D.postOwned(slug, next);
        render();
      } catch (err) {
        D.setOwnedLocal(CORE, slug, !next);  // revert
        render();
        if (opts.onChange) opts.onChange();
        notify(err.message || 'Could not save — is the portal served with serve.cmd?');
      }
    });
    wrap.append(btn);
  };
  render();
  return wrap;
}

// --- Overview -------------------------------------------------------------

function renderOverview(main, query = {}) {
  const gen = CORE.index.generated_from || {};
  const abIdx = CORE.abilitiesIndex || {};
  const mvIdx = CORE.movesIndex || {};

  // Hydrate state from the shareable ?query so a filtered link reopens the same
  // view; unknown ids/values fall back to "unset". Search stays out of the URL
  // (it's a live text filter) — the composable attributes + owned + sort persist.
  const state = {
    search: '',
    type: TYPES.includes(query.type) ? query.type : '',
    abilityId: abIdx[query.ability] ? query.ability : '',
    moveId: mvIdx[query.move] ? query.move : '',
    owned: query.owned === 'have' ? 'have' : 'all',
    cutoff: ['0', '1760', 'dex'].includes(query.sort) ? query.sort : '1760',
  };

  const search = el('input', {
    type: 'search', class: 'ctrl', placeholder: 'Search name…', 'aria-label': 'Search name',
  });
  search.addEventListener('input', () => { state.search = search.value.trim().toLowerCase(); refresh(); });

  const typeSel = el('select', { class: 'ctrl', 'aria-label': 'Filter by type' },
    el('option', { value: '', text: 'Any type' }),
    TYPES.map((t) => el('option', { value: t, text: t })));
  typeSel.value = state.type;
  typeSel.addEventListener('change', () => { state.type = typeSel.value; refresh(); });

  // Ability + move filters compose with type (AND). Native <datalist> typeahead
  // — zero-dependency and comfortable with the 200/561-entry option lists. The
  // user picks/types a display name; we resolve it to an id via the name maps.
  const abilityNames = Object.values(abIdx).map((a) => a.name).filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  const moveNames = Object.values(mvIdx).map((m) => m.name).filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  const abilityList = el('datalist', { id: 'ability-filter-options' },
    abilityNames.map((n) => el('option', { value: n })));
  const moveList = el('datalist', { id: 'move-filter-options' },
    moveNames.map((n) => el('option', { value: n })));

  const abilityInput = el('input', {
    type: 'search', class: 'ctrl', list: 'ability-filter-options',
    placeholder: 'Has ability…', 'aria-label': 'Filter by ability',
  });
  if (state.abilityId && abIdx[state.abilityId]) abilityInput.value = abIdx[state.abilityId].name;
  abilityInput.addEventListener('change', () => {
    const v = abilityInput.value.trim();
    state.abilityId = v ? (CORE.abilityNameToId.get(D.normName(v)) || '') : '';
    refresh();
  });

  const moveInput = el('input', {
    type: 'search', class: 'ctrl', list: 'move-filter-options',
    placeholder: 'Learns move…', 'aria-label': 'Filter by move learned',
  });
  if (state.moveId && mvIdx[state.moveId]) moveInput.value = mvIdx[state.moveId].name;
  moveInput.addEventListener('change', () => {
    const v = moveInput.value.trim();
    state.moveId = v ? (CORE.moveNameToId.get(D.normName(v)) || '') : '';
    refresh();
  });

  const ownedSel = el('select', { class: 'ctrl', 'aria-label': 'Filter by owned' },
    el('option', { value: 'all', text: 'All Pokémon' }),
    el('option', { value: 'have', text: 'I have it' }));
  ownedSel.value = state.owned;
  ownedSel.addEventListener('change', () => { state.owned = ownedSel.value; refresh(); });

  const cutoff = segmented(
    [{ value: '0', label: 'All players ⓪' }, { value: '1760', label: 'Top ladder ①⑦⑥⓪' },
      { value: 'dex', label: 'Dex #' }],
    state.cutoff, (v) => { state.cutoff = v; refresh(); });

  const chipsHost = el('div', { class: 'filter-chips' });
  const tableHost = el('div', { class: 'table-host' });
  const count = el('p', { class: 'result-count' });

  main.append(
    el('div', { class: 'controls' },
      search, typeSel, abilityInput, moveInput, ownedSel,
      el('label', { class: 'ctrl-label' }, 'Sort by ', cutoff),
      abilityList, moveList),
    el('p', { class: 'overview-meta' },
      `${D.formatInt(gen.battles)} battles · ${gen.month || '—'} · ${gen.format || '—'}`),
    chipsHost, count, tableHost,
  );

  const clearType = () => { state.type = ''; typeSel.value = ''; refresh(); };
  const clearAbility = () => { state.abilityId = ''; abilityInput.value = ''; refresh(); };
  const clearMove = () => { state.moveId = ''; moveInput.value = ''; refresh(); };
  const clearOwned = () => { state.owned = 'all'; ownedSel.value = 'all'; refresh(); };

  function drawChips() {
    clear(chipsHost);
    const chips = [];
    if (state.type) chips.push(filterChip('Type', state.type, clearType));
    if (state.abilityId && abIdx[state.abilityId]) {
      chips.push(filterChip('Ability', abIdx[state.abilityId].name, clearAbility));
    }
    if (state.moveId && mvIdx[state.moveId]) {
      chips.push(filterChip('Learns', mvIdx[state.moveId].name, clearMove));
    }
    if (state.owned === 'have') chips.push(filterChip('Owned', 'I have it', clearOwned));
    if (chips.length) {
      // Native .append() doesn't flatten arrays (unlike el's appendChildren),
      // so spread the chip nodes in.
      chipsHost.append(el('span', { class: 'filter-chips-label muted small', text: 'Filters: ' }), ...chips);
    }
  }

  function refresh() {
    const abilitySet = state.abilityId
      ? D.abilityBaseSlugs(abIdx, state.abilityId, CORE.monBySlug, CORE.megaToBase) : null;
    const moveSet = state.moveId ? D.moveLearnerSlugs(mvIdx, state.moveId) : null;
    const ownedSet = state.owned === 'have'
      ? new Set(CORE.index.mons.filter((m) => D.effectiveOwned(CORE, m.slug)).map((m) => m.slug))
      : null;
    const rows = D.composeFilter(CORE.index.mons, {
      search: state.search, type: state.type, abilitySet, moveSet, ownedSet,
    });
    count.textContent = `${rows.length} of ${CORE.index.mons.length} Pokémon`;
    drawChips();
    clear(tableHost);
    tableHost.append(rows.length ? buildOverviewTable(rows, state) : emptyFilterState(state, abIdx, mvIdx));
    syncOverviewUrl(state);
  }
  refresh();
}

/** A removable active-filter chip. Clicking it clears that one filter. */
function filterChip(label, value, onRemove) {
  const btn = el('button', {
    type: 'button', class: 'filter-chip', 'aria-label': `Remove ${label} filter: ${value}`,
  },
  el('span', { class: 'filter-chip-key', text: `${label}: ` }),
  el('span', { text: value }),
  el('span', { class: 'filter-chip-x', text: '✕' }));
  btn.addEventListener('click', onRemove);
  return btn;
}

/** Empty-result message that names the exact filter combination in force. */
function emptyFilterState(state, abIdx, mvIdx) {
  const bits = [];
  if (state.type) bits.push(`${state.type} type`);
  if (state.abilityId && abIdx[state.abilityId]) bits.push(abIdx[state.abilityId].name);
  if (state.moveId && mvIdx[state.moveId]) bits.push(`learns ${mvIdx[state.moveId].name}`);
  if (state.owned === 'have') bits.push('in your roster');
  if (state.search) bits.push(`name contains “${state.search}”`);
  const combo = bits.length ? bits.join(' + ') : 'the current filters';
  return el('p', { class: 'muted empty-filter', text: `No Pokémon match ${combo}.` });
}

/** Reflect the composable filters into the hash query (shareable / reloadable)
 *  without triggering a re-render — replaceState doesn't fire hashchange. */
function syncOverviewUrl(state) {
  const q = D.buildHashQuery({
    type: state.type,
    ability: state.abilityId,
    move: state.moveId,
    owned: state.owned === 'have' ? 'have' : '',
    sort: state.cutoff !== '1760' ? state.cutoff : '',
  });
  try { history.replaceState(null, '', `#/${q}`); } catch { /* history blocked */ }
}

function buildOverviewTable(rows, state) {
  const dexMode = state.cutoff === 'dex';
  const usageKey = state.cutoff === '0' ? 'usage0' : 'usage1760';
  // Usage rank by the selected cutoff — shown in the # column in usage modes.
  const ranked = rows.filter((m) => typeof m[usageKey] === 'number')
    .sort((a, b) => b[usageKey] - a[usageKey]);
  const rankOf = new Map(ranked.map((m, i) => [m.slug, i + 1]));
  const decorated = rows.map((m) => ({
    ...m,
    rank: rankOf.get(m.slug) ?? null,
    ratio: (typeof m.usage0 === 'number' && m.usage0 > 0 && typeof m.usage1760 === 'number')
      ? m.usage1760 / m.usage0 : null,
  }));

  const columns = [
    {
      key: 'num', label: '#', numeric: true,
      tip: dexMode ? 'National Pokédex number' : 'Usage rank at the selected cutoff',
      // Sorting the # column ascending gives dex order (dex mode) or usage order
      // (usage modes: rank 1 = highest usage). Missing values sink to the bottom.
      sortVal: (r) => (dexMode ? r.dex : r.rank),
      cell: (r) => { const v = dexMode ? r.dex : r.rank; return v == null ? '—' : String(v); },
    },
    {
      key: 'sprite', label: '', sortVal: (r) => r.name,
      cell: (r) => R.sprite(r.image_url, r.name, r.types, 24),
    },
    {
      key: 'name', label: 'Pokémon', sortVal: (r) => r.name,
      cell: (r) => el('span', { class: 'mon-cell' },
        el('span', { class: 'mon-name', text: r.name }), typeBadges(r.types)),
    },
    { key: 'usage0', label: 'All ⓪', numeric: true, tip: 'Usage among all ranked players', cell: (r) => D.fractionPct(r.usage0) },
    { key: 'usage1760', label: 'Top ①⑦⑥⓪', numeric: true, tip: 'Usage among players rated 1760+ — the serious end of the ladder', cell: (r) => D.fractionPct(r.usage1760) },
    {
      key: 'ratio', label: 'Shift', sortVal: (r) => r.ratio,
      tip: 'How usage shifts between the general ladder and top-rated players — ▲ means top players use it more, ▽ means it\'s mostly a casual pick',
      cell: (r) => {
        const b = D.deltaBadge(r.usage0, r.usage1760);
        return b ? el('span', { class: `delta ${b.kind}` }, b.label) : document.createTextNode('');
      },
    },
    {
      key: 'owned', label: 'Have',
      tip: 'Click to mark whether you own this Pokémon — saved automatically',
      sortVal: (r) => (D.effectiveOwned(CORE, r.slug) ? 1 : 0),
      cell: (r) => ownedControl(r.slug),
    },
  ];

  return R.sortableTable(columns, decorated, {
    sortKey: 'num', sortDir: 'asc', className: 'overview-table',
    onRowClick: (r) => { location.hash = `#/mon/${encodeURIComponent(r.slug)}`; },
  });
}

// --- Detail ---------------------------------------------------------------

/** Normalise base vs mega into one shape the detail view can render. */
function makeForm(mon, mega) {
  if (!mega) {
    const abilities = (mon.abilities || []).map((a) => ({ name: a.name, desc: a.description, hidden: false }));
    if (mon.hidden_ability) {
      abilities.push({ name: mon.hidden_ability.name, desc: mon.hidden_ability.description, hidden: true });
    }
    return {
      label: 'Base', name: mon.showdown_name, types: mon.types || [], stats: mon.stats || {},
      abilities, image_url: mon.image_url, usage: mon.usage, battle_data: mon.battle_data,
      weight_hg: mon.weight_hg, form_text: mon.form_text,
    };
  }
  const ab = mega.ability ? [{ name: mega.ability.name, desc: mega.ability.description, hidden: false }] : [];
  return {
    label: mega.form_text || mega.showdown_name, name: mega.showdown_name, types: mega.types || [],
    stats: mega.stats || {}, abilities: ab, image_url: mega.image_url, usage: mega.usage,
    battle_data: mega.battle_data, weight_hg: mega.weight_hg, form_text: mega.form_text,
  };
}

async function renderDetail(main, slug, initialFormIndex = 0) {
  main.append(backLink(), el('p', { class: 'loading', text: 'Loading…' }));
  const mon = await D.getMon(slug);
  clear(main).append(backLink());
  if (!mon) {
    main.append(el('div', { class: 'notice' },
      el('h2', { text: 'Not found' }),
      el('p', { text: `No dex file for “${slug}”. Check the spelling or return to the overview.` })));
    return;
  }
  const forms = [makeForm(mon, null)].concat((mon.megas || []).map((m) => makeForm(mon, m)));
  const body = el('div', { class: 'detail' });
  main.append(body);
  // A Mega link (#/mon/charizard-mega-y) pre-selects that Mega form.
  let idx = (initialFormIndex >= 0 && initialFormIndex < forms.length) ? initialFormIndex : 0;
  const draw = () => { clear(body); drawDetailForm(body, slug, mon, forms, idx, (i) => { idx = i; draw(); }); };
  draw();
}

function drawDetailForm(body, slug, mon, forms, idx, onForm) {
  const form = forms[idx];

  // Header. Ownership is per species, so it uses the base slug across forms.
  const abilityNodes = form.abilities.map((a) => R.tip(
    el('span', { class: `ability ${a.hidden ? 'hidden-ability' : ''}` },
      a.hidden ? `${a.name} (hidden)` : a.name), a.desc));
  const header = el('div', { class: 'detail-header' },
    R.sprite(form.image_url, form.name, form.types, 160),
    el('div', { class: 'detail-heading' },
      el('h1', { text: form.name }),
      typeBadges(form.types),
      el('div', { class: 'ability-line' }, abilityNodes),
      el('div', { class: 'meta-line' },
        el('span', {}, `No. ${mon.national_dex ?? '—'}`),
        el('span', {}, `${((form.weight_hg ?? 0) / 10).toFixed(1)} kg`)),
      el('div', { class: 'own-row' }, ownedControl(slug, { labeled: true })),
      forms.length > 1
        ? segmented(forms.map((f, i) => ({ value: String(i), label: f.label })), String(idx),
          (v) => onForm(Number(v)))
        : null),
  );
  body.append(header);

  body.append(statsSection(form));
  body.append(matchupSection(form));
  body.append(usageHeadline(form));
  body.append(comparisonSection(form));
  const threats = threatsSection(form, slug);
  if (threats) body.append(threats);
  body.append(learnsetSection(mon));
}

/** Smogon checks/counters (all-players): what this mon Counters + is Countered by. */
function threatsSection(form, slug) {
  const byCutoff = (form.usage && form.usage.present && form.usage.by_cutoff) || {};
  // c&c is only computed for the full pool (cutoff 0); 1760 is near-empty.
  const counteredBy = (byCutoff['0'] && byCutoff['0'].top_counters)
    || (byCutoff['1760'] && byCutoff['1760'].top_counters) || [];
  const row = CORE.monBySlug.get(slug);
  const beats = (row && row.beats) || [];
  if (!counteredBy.length && !beats.length) return null;

  // "Counters" — mons THIS Pokémon most often KOs/forces out (inverse signal).
  // beats entries are {slug, score, n}: score = P(this mon KOs/forces out the
  // prey), n = encounters. (Tolerates the pre-scores plain-string shape from a
  // stale index — the link still resolves; meter/tooltip just read 0.)
  const counterRows = beats.map((b) => {
    const e = typeof b === 'string' ? { slug: b } : b;
    const m = CORE.monBySlug.get(e.slug);
    const name = m ? m.name : e.slug;
    const pct = 100 * (e.score || 0);
    const link = el('a', { class: 'tm-link', href: `#/mon/${encodeURIComponent(e.slug)}` }, name);
    return R.meterRow(link, pct, 1,
      `In their ladder encounters, ${form.name} KOs or forces out ${name} about `
      + `${Math.round(pct)}% of the time (${Math.round(e.n || 0)} encounters)`);
  });

  // "Countered by" — mons that most often KO/force out THIS Pokémon.
  const counteredByRows = counteredBy.map((c) => {
    const pct = 100 * (c.score || 0);
    return R.meterRow(nameLink(c.key), pct, 1,
      `In their ladder encounters, ${c.key} KOs or forces out ${form.name} about `
      + `${Math.round(pct)}% of the time (${Math.round(c.n || 0)} encounters)`);
  });

  return el('section', { class: 'card' },
    R.sectionTitle('Counters & countered by',
      'Smogon ladder checks/counters (from the all-players pool)'),
    beats.length ? el('div', { class: 'threats-block' },
      R.tip(el('h4', { class: 'sub-head series-1-text', text: 'Counters' }),
        'Mons this Pokémon most often KOs or forces out on the ladder'),
      el('div', { class: 'meter-list' }, counterRows)) : null,
    counteredBy.length ? el('div', { class: 'threats-block' },
      R.tip(el('h4', { class: 'sub-head series-1-text', text: 'Countered by' }),
        'Mons that most often KO or force out this Pokémon on the ladder'),
      el('div', { class: 'meter-list' }, counteredByRows)) : null);
}

/** The #1 in-game build ({sp, up, down, nature}) for a form, or null. */
const PANEL_STAT_ROWS = [
  ['hp', 'HP'], ['atk', 'Atk'], ['def', 'Def'],
  ['spa', 'SpA'], ['spd', 'SpD'], ['spe', 'Spe'],
];

/** Plain base-stat bars beside the interactive Stat Alignment (nature) panel. */
function statsSection(form) {
  return el('section', { class: 'card' },
    R.sectionTitle('Base stats'),
    el('div', { class: 'stats-and-align' },
      R.statBars(form.stats),
      alignmentPanel(form)));
}

/**
 * Nature selector: pick a nature (the mon's top in-game natures as chips with
 * their %, or any of the 25 via the dropdown) and see the six Lv50 values with
 * NO SP training. This is the single home for nature math — the base bars stay
 * plain, per the PM (base + nature + spread in one number was confusing).
 */
function alignmentPanel(form) {
  const natures = CORE.natures || {};                 // { name: {up, down} }
  const natureNames = Object.keys(natures);
  const topNatures = (form.battle_data && form.battle_data.present
    && form.battle_data.top_natures) || [];           // [{ name, pct }]
  const neutralDefault = natureNames.find((n) => !natures[n].up && !natures[n].down) || natureNames[0];
  let selected = (topNatures[0] && natures[topNatures[0].name]) ? topNatures[0].name : neutralDefault;

  const chipsHost = el('div', { class: 'nature-chips' });
  const valuesHost = el('div', { class: 'align-values' });
  const dropdown = el('select', { class: 'ctrl', 'aria-label': 'Choose a nature' },
    natureNames.map((n) => el('option', { value: n, text: n })));

  const render = () => {
    clear(chipsHost);
    topNatures.slice(0, 4).forEach((n) => {
      const btn = el('button', {
        type: 'button', class: `nature-chip ${n.name === selected ? 'active' : ''}`,
      }, n.name, typeof n.pct === 'number'
        ? el('span', { class: 'nature-chip-pct', text: ` ${n.pct.toFixed(0)}%` }) : null);
      btn.addEventListener('click', () => { selected = n.name; render(); });
      chipsHost.append(btn);
    });
    dropdown.value = selected;
    const nat = natures[selected] || { up: null, down: null };
    const finals = D.finalStats(form.stats, {}, nat.up, nat.down);
    clear(valuesHost);
    PANEL_STAT_ROWS.forEach(([k, label]) => {
      valuesHost.append(el('div', { class: 'align-row' },
        el('span', { class: 'align-label', text: label }),
        el('span', { class: 'align-val tnum', text: String(finals[k]) }),
        nat.up === k ? el('span', { class: 'nat-up', text: '▲' })
          : nat.down === k ? el('span', { class: 'nat-down', text: '▽' }) : null));
    });
  };
  dropdown.addEventListener('change', () => { selected = dropdown.value; render(); });
  render();

  const defaultNote = topNatures.length
    ? `Default is the most common Pokémon Champions nature (${topNatures[0].name}${typeof topNatures[0].pct === 'number' ? ` — ${topNatures[0].pct.toFixed(0)}%` : ''}).`
    : 'No Pokémon Champions nature data — showing a neutral nature.';

  return el('div', { class: 'align-panel' },
    R.tip(el('h4', { class: 'sub-head', text: 'Stat Alignments (natures)' }),
      'Pick a nature to see its Lv50 stats. The game calls a nature change a "Stat Alignment".'),
    chipsHost,
    el('div', { class: 'align-drop' },
      el('span', { class: 'muted small', text: 'or any nature: ' }), dropdown),
    valuesHost,
    el('p', { class: 'muted small', text: 'Lv50 values before SP training — SP adds on top (see the spread lists below).' }),
    el('p', { class: 'muted small', text: defaultNote }));
}

function matchupSection(form) {
  const groups = D.defensiveMatchups(CORE, form.types);
  const order = [
    ['4', '×4', 'arm-red'], ['2', '×2', 'arm-red'],
    ['0.5', '×½', 'arm-blue'], ['0.25', '×¼', 'arm-blue'], ['0', '×0', 'arm-immune'],
  ];
  const blocks = order.map(([mult, label, tone]) => {
    const list = groups[mult];
    if (!list || !list.length) return null;
    const chips = list.map((t) => {
      const badge = R.typeBadge(t, mult === '0' ? '' : label);
      badge.classList.add('chip', tone);
      return R.tip(badge, mult === '0' ? `Immune to ${t}` : `Takes ${label} from ${t}`);
    });
    return el('div', { class: 'matchup-group' },
      el('span', { class: 'matchup-label', text: mult === '0' ? `${label} (immune)` : label },),
      el('div', { class: 'chip-row' }, chips));
  }).filter(Boolean);

  return el('section', { class: 'card' },
    R.sectionTitle('Defensive matchups', 'How the 18 attacking types hit this typing (neutral omitted)'),
    blocks.length ? el('div', { class: 'matchups' }, blocks)
      : el('p', { class: 'muted', text: 'Perfectly neutral — no weaknesses or resistances.' }));
}

function usageHeadline(form) {
  const usage = form.usage;
  const cell = (cut) => {
    const b = usage && usage.present && usage.by_cutoff ? usage.by_cutoff[cut] : null;
    if (!b) return el('div', { class: 'headline-cell muted' },
      el('span', { class: 'headline-label', text: cut === '0' ? 'All players ⓪' : 'Top ladder ①⑦⑥⓪' }),
      el('span', { text: 'no data' }));
    // Smogon viability ceiling: [teamCount, maxGXE, meanGXE, stdev].
    const vc = b.viability_ceiling || [];
    const skill = [];
    if (vc[1] != null) skill.push(`GXE ${vc[1]} max`);
    if (vc[2] != null) skill.push(`${vc[2]} avg`);
    if (vc[0] != null) skill.push(`${D.formatInt(vc[0])} players`);
    return el('div', { class: 'headline-cell' },
      el('span', { class: 'headline-label', text: cut === '0' ? 'All players ⓪' : 'Top ladder ①⑦⑥⓪' }),
      el('span', { class: 'headline-usage tnum', text: D.fractionPct(b.usage) }),
      R.tip(el('span', { class: 'headline-gxe tnum', text: skill.length ? skill.join(' · ') : 'GXE —' }),
        'GXE ≈ a win-rate-adjusted rating: roughly the % of games a strong player '
        + 'wins with this Pokémon. Shown as the best and average GXE across the '
        + 'players who laddered with it.'),
      el('span', { class: 'headline-count', text: `${D.formatInt(b.raw_count)} teams` }));
  };
  return el('section', { class: 'card' },
    R.sectionTitle('Usage'),
    el('div', { class: 'headline' }, cell('0'), cell('1760')));
}

// -- Section 4: the comparison --------------------------------------------

/** Resolve a Smogon display name to a linkable URL slug (base mon OR a Mega
 *  form, which the router redirects to its base + pre-selected form). */
function monLinkSlug(displayName) {
  const slug = D.slugify(displayName);
  if (CORE.monBySlug.has(slug)) return slug;   // a base / alt-form mon
  if (CORE.megaToBase.has(slug)) return slug;  // a Mega → router resolves it
  const aliased = CORE.nameAlias.get(D.normName(displayName));
  if (aliased) return aliased;                 // regional/gender/forme/"Mr." variant
  return null;
}

function nameLink(displayName) {
  const slug = monLinkSlug(displayName);
  if (slug) {
    return el('a', { class: 'tm-link', href: `#/mon/${encodeURIComponent(slug)}` }, displayName);
  }
  return el('span', { text: displayName });
}

function smogonList(entries, series, resolve) {
  return entries.map((e) => {
    const info = resolve(e.key);
    // Item entries carry a VP `cost` (from itemInfo); fold it into the tooltip
    // so cost surfaces subtly wherever an item name shows. Abilities have none.
    const tipText = info.cost
      ? (info.desc ? `${info.desc} · ${info.cost}` : info.cost)
      : info.desc;
    return R.meterRow(el('span', { text: info.name }), e.pct, series, tipText, D.formatInt(e.weight));
  });
}

/** A move name → link to its `#/moves/<id>` page when the id is in the index;
 *  plain text otherwise (e.g. a move with no learners in our dex). */
function moveLink(moveId, displayName) {
  if (moveId && CORE.movesIndex && CORE.movesIndex[moveId]) {
    return el('a', { class: 'tm-link', href: `#/moves/${encodeURIComponent(moveId)}` }, displayName);
  }
  return el('span', { text: displayName });
}

/** Smogon Moves rows: like smogonList, but the move name links to its page
 *  (Smogon keys are already showdown move ids). */
function smogonMoveList(entries) {
  return entries.map((e) => {
    const info = D.moveInfo(CORE, e.key);
    return R.meterRow(moveLink(e.key, info.name), e.pct, 1, info.desc, D.formatInt(e.weight));
  });
}

function smogonColumn(form, cutoff) {
  const block = form.usage && form.usage.present && form.usage.by_cutoff
    ? form.usage.by_cutoff[cutoff] : null;
  if (!block) return noSignal('No Showdown-ladder data for this signal.');
  const { d, mode } = D.usageDenominator(block);
  const parts = [];
  if (mode === 'weights') parts.push(el('p', { class: 'weights-note', text: 'Showing raw weights (no ability data to normalise).' }));

  const moves = D.withPct(block.top_moves, d, 10);
  const items = D.withPct(block.top_items, d, 8);
  const abilities = D.withPct(block.top_abilities, d);
  const spreads = D.withPct(block.top_spreads, d, 6);
  const teammates = D.withPct(block.top_teammates, d, 12);

  parts.push(subList('Moves', smogonMoveList(moves)));
  parts.push(subList('Items', smogonList(items, 1, (k) => D.itemInfo(CORE, k))));
  parts.push(subList('Abilities', smogonList(abilities, 1, (k) => D.abilityInfo(CORE, k))));
  parts.push(subList('Spreads', spreads.map((e) => spreadRow(e, 1)), null, spTipText()));
  parts.push(subList('Teammates', teammates.map((e) => R.meterRow(
    nameLink(e.key), e.pct, 1, null, D.formatInt(e.weight))), 'appears on X% of its teams'));
  return el('div', { class: 'signal-col' }, parts);
}

/** Item tooltip keyed by display name (in-game + Trends lists): the effect
 *  text with the VP cost folded in — so cost surfaces wherever items render. */
function itemTipByName(name) {
  const it = CORE.itemsByName.get(name);
  const desc = describeEntry(it);
  const cost = D.itemCostText(it);
  return cost ? (desc ? `${desc} · ${cost}` : cost) : desc;
}

function ingameColumn(form) {
  const bd = form.battle_data;
  if (!bd || !bd.present) return noSignal('No Pokémon Champions data for this signal.');
  const parts = [];
  parts.push(subList('Moves', bd.top_moves.map((e) => R.meterRow(
    moveLink(CORE.moveNameToId.get(D.normName(e.name)), e.name),
    e.pct, 2, describeEntry(CORE.movesByName.get(e.name))))));
  parts.push(subList('Items', bd.top_items.map((e) => R.meterRow(
    el('span', { text: e.name }), e.pct, 2, itemTipByName(e.name)))));
  parts.push(subList('Abilities', bd.top_abilities.map((e) => R.meterRow(
    el('span', { text: e.name }), e.pct, 2, describeEntry(CORE.abilitiesByName.get(e.name))))));
  parts.push(subList('Spreads', bd.top_spreads.map((e) => spreadRow({ sp: e.sp, pct: e.pct }, 2)), null, spTipText()));
  parts.push(subList('Natures', bd.top_natures.map((e) => natureRow(e))));
  parts.push(subList('Teammates', bd.top_teammates.map((e) => R.meterRow(
    nameLink(e.name), null, 2, null, `#${e.rank}`)), 'rank-ordered (no % published)',
    "Order mirrors Pokémon Champions' own Battle Data ranking — most"
    + ' common teammates on ranked teams. The game publishes the order but not'
    + ' the underlying percentages.'));
  return el('div', { class: 'signal-col' }, parts);
}

function spreadRow(entry, series) {
  const sp = entry.sp || D.parseSpreadKey(entry.key, CORE.sp.byte_order).sp;
  const nature = entry.nature || (entry.key ? D.parseSpreadKey(entry.key, CORE.sp.byte_order).nature : null);
  const spStr = D.spString(sp, CORE.sp.byte_order);
  const vp = D.vpCost(sp, CORE.sp.vp_per_sp);
  const name = el('span', { class: 'spread-name' });
  if (nature) {
    const arrows = D.natureArrows(CORE, nature);
    name.append(el('span', { class: 'spread-nature', text: nature }), ...R.natureArrowNodes(arrows.up, arrows.down),
      el('span', { class: 'spread-dot', text: ' · ' }));
  }
  name.append(
    R.tip(el('span', { class: 'spread-sp tnum', text: spStr }),
      'Stat Points in HP/Atk/Def/SpA/SpD/Spe order'),
    R.tip(el('span', { class: 'spread-vp tnum', text: ` ${vp} VP` }),
      `Victory Points — the Pokémon Champions currency; training 1 SP costs ${CORE.sp.vp_per_sp} VP`));
  const tipText = `${nature ? nature + ' · ' : ''}${spStr} (HP/Atk/Def/SpA/SpD/Spe) · ${vp} VP to train`;
  return R.meterRow(name, entry.pct, series, tipText);
}

function natureRow(entry) {
  const arrows = D.natureArrows(CORE, entry.name, entry.stat_up, entry.stat_down);
  const name = el('span', { class: 'spread-name' },
    el('span', { text: entry.name }), ...R.natureArrowNodes(arrows.up, arrows.down));
  return R.meterRow(name, entry.pct, 2,
    `${entry.name}: +${entry.stat_up || '—'} / -${entry.stat_down || '—'}`);
}

function subList(title, rows, note, headingTip) {
  const body = rows && rows.length
    ? el('div', { class: 'meter-list' }, rows)
    : el('p', { class: 'muted small', text: 'none' });
  const heading = el('h4', { text: title },
    note ? el('span', { class: 'sub-note', text: ` — ${note}` }) : null);
  if (headingTip) R.tip(heading, headingTip);
  return el('div', { class: 'sub-list' }, heading, body);
}

/** Tooltip text explaining the SP system, pulled from sp-system data. */
function spTipText() {
  const sp = CORE.sp || {};
  return `Stat Points — Champions' training system: ${sp.total} total per Pokémon, max ${sp.per_stat_cap} per stat`;
}

function noSignal(msg) {
  return el('div', { class: 'signal-col empty' }, el('p', { class: 'muted', text: msg }));
}

// --- Data-freshness captions ("as of" lines) ------------------------------

/** Normalise an ISO timestamp/date to just its YYYY-MM-DD; pass through else. */
function isoDate(v) {
  if (!v) return null;
  const m = String(v).match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : String(v);
}

/** Quiet "as of" caption for the Showdown (blue) signal, or null if unknown. */
function smogonAsOf() {
  const f = CORE.freshness && CORE.freshness.smogon;
  const month = f && f.month;
  return month ? el('p', { class: 'as-of', text: `Showdown stats as of ${month}` }) : null;
}

/** Quiet "as of" caption for the in-game (aqua) signal, or null if unknown. */
function ingameAsOf() {
  const f = CORE.freshness && CORE.freshness.battle_data;
  if (!f) return null;
  const bits = [];
  if (f.season) bits.push(f.season === 'Current' ? 'current season' : `${f.season} season`);
  const d = isoDate(f.generated_at);
  if (d) bits.push(`generated ${d}`);
  return bits.length ? el('p', { class: 'as-of', text: `Pokémon Champions — ${bits.join(' · ')}` }) : null;
}

function comparisonSection(form) {
  let cutoff = '1760';
  const smogonHost = el('div', { class: 'signal-host' });
  const drawSmogon = () => clear(smogonHost).append(smogonColumn(form, cutoff));
  drawSmogon();

  const smogonToggle = segmented(
    [{ value: '0', label: 'All ⓪' }, { value: '1760', label: 'Top ①⑦⑥⓪' }],
    cutoff, (v) => { cutoff = v; drawSmogon(); });

  const legend = el('div', { class: 'legend' },
    el('span', { class: 'legend-item' }, el('span', { class: 'swatch series-1' }), 'Showdown ladder (simulator)'),
    el('span', { class: 'legend-item' }, el('span', { class: 'swatch series-2' }), 'Pokémon Champions'));

  return el('section', { class: 'card' },
    R.sectionTitle('The comparison', 'Showdown ladder (fan simulator) vs Pokémon Champions (the real game)'),
    legend,
    el('div', { class: 'compare' },
      el('div', { class: 'compare-col' },
        el('div', { class: 'compare-head' },
          R.tip(el('h3', { class: 'series-1-text', text: 'Showdown ladder' }),
            'Showdown ladder — fan simulator ranked play (what people run on Showdown)'), smogonToggle),
        smogonAsOf(),
        smogonHost),
      el('div', { class: 'compare-col' },
        el('div', { class: 'compare-head' },
          R.tip(el('h3', { class: 'series-2-text', text: 'Pokémon Champions' }),
            "Pokémon Champions — the real game's own ranked Battle Data")),
        ingameAsOf(),
        ingameColumn(form))));
}

// -- Section 5: learnset ---------------------------------------------------

function learnsetSection(mon) {
  const rows = mon.learnset || [];
  const searchBox = el('input', { type: 'search', class: 'ctrl', placeholder: 'Search moves…', 'aria-label': 'Search moves' });
  const host = el('div', { class: 'table-host' });

  const columns = [
    {
      key: 'name', label: 'Move', sortVal: (r) => r.name,
      cell: (r) => {
        const node = r.showdown_id
          ? el('a', { href: `#/moves/${encodeURIComponent(r.showdown_id)}` }, r.name)
          : el('span', { text: r.name });
        return R.tip(node, lookupMoveDesc(r));
      },
    },
    { key: 'type', label: 'Type', sortVal: (r) => r.type, cell: (r) => (r.type ? R.typeBadge(r.type) : '—') },
    { key: 'category', label: 'Cat.', sortVal: (r) => r.category, cell: (r) => r.category || '—' },
    { key: 'power', label: 'Pow', numeric: true, cell: (r) => (r.power ?? '—') },
    { key: 'accuracy', label: 'Acc', numeric: true, cell: (r) => (r.accuracy ?? '—') },
    { key: 'pp', label: 'PP', numeric: true, cell: (r) => (r.pp ?? '—') },
    { key: 'priority', label: 'Prio', numeric: true, cell: (r) => (r.priority ?? 0) },
  ];

  const draw = () => {
    const q = searchBox.value.trim().toLowerCase();
    const filtered = q ? rows.filter((r) => (r.name || '').toLowerCase().includes(q)) : rows;
    clear(host).append(R.sortableTable(columns, filtered, { sortKey: 'name', sortDir: 'asc', className: 'learnset-table' }));
  };
  searchBox.addEventListener('input', draw);
  draw();

  return el('section', { class: 'card' },
    R.sectionTitle('Learnset', `${rows.length} moves`),
    el('div', { class: 'learnset-controls' }, searchBox),
    host);
}

function lookupMoveDesc(move) {
  if (move.showdown_id) {
    const d = describeEntry(CORE.moves.get(move.showdown_id));
    if (d) return d;
  }
  return describeEntry(CORE.movesByName.get(move.name));
}

// --- Stats (sort by any stat) ---------------------------------------------

const STAT_PICKER = [
  { key: 'hp', label: 'HP' }, { key: 'atk', label: 'Atk' }, { key: 'def', label: 'Def' },
  { key: 'spa', label: 'SpA' }, { key: 'spd', label: 'SpD' }, { key: 'spe', label: 'Spe' },
  { key: 'bst', label: 'BST' },
];
const STAT_SHORT_LABEL = {
  hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe', bst: 'BST',
};
const STAT_FULL = {
  hp: 'HP', atk: 'Attack', def: 'Defense', spa: 'Sp. Atk', spd: 'Sp. Def',
  spe: 'Speed', bst: 'Base Stat Total',
};

function statValue(mon, statKey) {
  if (statKey === 'bst') return mon.bst;
  return mon.stats ? mon.stats[statKey] : undefined;
}

const STAT_KEY_SET = new Set(['hp', 'atk', 'def', 'spa', 'spd', 'spe', 'bst']);

function renderStats(main) {
  let statKey = 'spe';
  const mons = CORE.index.mons
    .filter((m) => typeof m.usage1760 === 'number' || typeof m.usage0 === 'number')
    .slice();
  // slug -> {sp:{...}, priorityMoves} — filled once (async) for the spread + ⚡.
  const bdCache = new Map();

  const subtitle = el('p', { class: 'muted' });
  const pickerHost = el('span', { class: 'stat-picker-host' });
  const host = el('div', { class: 'table-host' });

  main.append(
    el('div', { class: 'page-head' },
      el('h1', { text: 'Stat tiers' }),
      el('div', { class: 'stat-picker-row' },
        el('span', { class: 'picker-label', text: 'Sort by' }), pickerHost)),
    subtitle, host);

  // A single entry point for changing the sort stat, used by both the picker
  // and clicking a stat column header — so they stay in sync.
  const setStat = (k) => { statKey = k; draw(); };
  const draw = () => {
    subtitle.textContent = statSubtitle(statKey);
    const picker = segmented(
      STAT_PICKER.map((s) => ({ value: s.key, label: s.label })), statKey, setStat);
    R.tip(picker, 'Pick a stat to rank by (or click a stat column header)');
    clear(pickerHost).append(picker);
    clear(host).append(buildStatsTable(mons, statKey, bdCache, setStat));
  };
  draw();
  // Hydrate battle-data-derived spread/⚡ once, then refresh so the cells fill.
  hydrateStatsInvest(mons, bdCache).then(draw);
}

function statSubtitle(statKey) {
  const by = statKey === 'bst' ? 'Base Stat Total' : STAT_FULL[statKey];
  return `All base stats shown — ranked by ${by}; spreads are the most common `
    + 'Pokémon Champions SP placements. Click a Pokémon for nature and Lv50 details.';
}

const SP_BYTE_ORDER = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
const STAT_COLS = [
  ['hp', 'HP'], ['atk', 'Atk'], ['def', 'Def'],
  ['spa', 'SpA'], ['spd', 'SpD'], ['spe', 'Spe'], ['bst', 'BST'],
];

function buildStatsTable(mons, statKey, cache, onPick) {
  const columns = [
    { key: 'sprite', label: '', sortVal: (r) => r.name, cell: (r) => R.sprite(r.image_url, r.name, r.types, 24) },
    { key: 'name', label: 'Pokémon', sortVal: (r) => r.name, cell: (r) => statNameCell(r, cache) },
    ...STAT_COLS.map(([k, label]) => ({
      key: k, label, numeric: true,
      tip: k === 'bst' ? 'Base Stat Total — the six base stats added up' : `Base ${STAT_FULL[k]} stat`,
      sortVal: (r) => statValue(r, k),
      cell: (r) => { const v = statValue(r, k); return v == null ? '—' : String(v); },
    })),
    {
      key: 'usage1760', label: 'Top ①⑦⑥⓪', numeric: true,
      tip: 'Usage among players rated 1760+ — the serious end of the ladder',
      cell: (r) => D.fractionPct(r.usage1760),
    },
    {
      key: 'spread', label: 'Common spread',
      tip: "The #1 SP spread from Pokémon Champions' Battle Data, in HP/Atk/Def/SpA/SpD/Spe order. The slot for the sorted stat is emphasized.",
      sortVal: (r) => spreadSortVal(cache.get(r.slug), statKey),
      cell: (r) => statSpreadCell(r, statKey, cache),
    },
  ];
  return R.sortableTable(columns, mons, {
    sortKey: statKey, sortDir: 'desc', className: 'stats-table',
    onRowClick: (r) => { location.hash = `#/mon/${encodeURIComponent(r.slug)}`; },
    // Clicking a stat column header selects it as the sort stat (mirrors the
    // picker + highlight); non-stat headers just re-sort in place.
    onSort: (key) => { if (STAT_KEY_SET.has(key) && key !== statKey) onPick(key); },
  });
}

/** Sort key for the spread column: the sorted stat's SP (total SP for BST). */
function spreadSortVal(data, statKey) {
  if (!data || !data.sp) return null;
  if (statKey === 'bst') {
    return Object.values(data.sp).reduce((a, v) => a + (Number(v) || 0), 0);
  }
  return data.sp[statKey];
}

/** The "Common spread" cell — SP digits only, sorted stat's slot emphasized. */
function statSpreadCell(row, statKey, cache) {
  const span = el('span', { class: 'spread-cell' });
  if (!cache.has(row.slug)) { span.textContent = '…'; return span; }
  fillSpread(span, cache.get(row.slug), statKey);
  return span;
}

function fillSpread(span, data, statKey) {
  clear(span);
  if (!data || !data.sp) { span.append(document.createTextNode('—')); return; }
  const order = (CORE.sp.byte_order && CORE.sp.byte_order.length === 6)
    ? CORE.sp.byte_order : SP_BYTE_ORDER;
  const slots = el('span', { class: 'spread-sp tnum' });
  order.forEach((k, i) => {
    if (i) slots.append(document.createTextNode('/'));
    slots.append(el('span', {
      class: k === statKey ? 'sp-slot sorted-slot' : 'sp-slot',
    }, String(data.sp[k] ?? 0)));
  });
  span.append(slots);
}

/** ⚡ badge next to the name when the mon CAN learn a priority attack. */
function statNameCell(row, cache) {
  const cell = el('span', { class: 'mon-cell' },
    el('span', { class: 'mon-name', text: row.name }), typeBadges(row.types));
  const data = cache.get(row.slug);
  const prio = data && data.priorityMoves;
  if (prio && prio.length) {
    const list = prio.map((pm) => `${pm.name} (+${pm.priority})`).join(', ');
    cell.append(R.tip(el('span', { class: 'prio-badge' }, '⚡'),
      `Can learn priority attacks: ${list}`));
  }
  return cell;
}

async function hydrateStatsInvest(mons, cache) {
  for (const m of mons) {
    const mon = await D.getMon(m.slug);
    const bd = mon && mon.battle_data;
    const spread = bd && bd.present && bd.top_spreads && bd.top_spreads[0];
    // Priority attacks it CAN learn (learnset-based, not usage) — for the ⚡.
    const priorityMoves = ((mon && mon.learnset) || [])
      .filter((mv) => (mv.priority || 0) > 0 && mv.category !== 'status')
      .map((mv) => ({ name: mv.name, priority: mv.priority }));
    cache.set(m.slug, {
      sp: (spread && spread.sp) ? spread.sp : null,
      priorityMoves,
    });
  }
}

// --- Moves (reverse move search) ------------------------------------------

/** Accuracy display: a real percentage as-is; the never-miss sentinel (>100,
 *  e.g. Swords Dance / Aerial Ace) or a missing value shows as "—". */
function moveAccuracy(a) {
  return typeof a === 'number' && a <= 100 ? String(a) : '—';
}

function renderMoves(main, moveId) {
  const moves = CORE.movesIndex || {};
  const ids = Object.keys(moves);
  let selected = (moveId && moves[moveId]) ? moveId : null;
  let haveOnly = false;

  const search = el('input', {
    type: 'search', class: 'ctrl', placeholder: 'Search moves…', 'aria-label': 'Search a move',
  });
  const listHost = el('div', { class: 'move-results' });
  const detailHost = el('div', { class: 'move-detail' });

  main.append(
    el('div', { class: 'page-head' },
      el('h1', { text: 'Moves' }),
      el('p', { class: 'muted', text: 'Search a move to see who learns it — e.g. which of your Pokémon know Trick Room.' })),
    el('div', { class: 'moves-layout' },
      el('div', { class: 'moves-left' },
        el('div', { class: 'controls' }, search), listHost),
      el('div', { class: 'moves-right' }, detailHost)));

  if (!ids.length) {
    clear(listHost).append(el('p', { class: 'muted small', text: 'No move index available (refresh the data).' }));
    return;
  }

  const select = (id) => { selected = id; drawList(); drawDetail(); };

  function drawList() {
    clear(listHost);
    const q = search.value.trim().toLowerCase();
    if (!q) {
      listHost.append(el('p', { class: 'muted small', text: `${ids.length} moves — start typing a name.` }));
      return;
    }
    const matches = ids
      .filter((id) => (moves[id].name || '').toLowerCase().includes(q))
      .sort((a, b) => (moves[a].name || '').localeCompare(moves[b].name || ''))
      .slice(0, 40);
    if (!matches.length) {
      listHost.append(el('p', { class: 'muted small', text: 'No moves match.' }));
      return;
    }
    matches.forEach((id) => {
      const mv = moves[id];
      const btn = el('button', {
        type: 'button', class: `move-result ${id === selected ? 'active' : ''}`,
      }, el('span', { class: 'move-result-name', text: mv.name }),
        mv.type ? R.typeBadge(mv.type) : null);
      btn.addEventListener('click', () => select(id));
      listHost.append(btn);
    });
  }

  function drawDetail() {
    clear(detailHost);
    if (!selected) {
      detailHost.append(el('p', { class: 'muted', text: 'Pick a move to see every Pokémon that can learn it.' }));
      return;
    }
    const mv = moves[selected];
    // Structured effect fields (flags/secondary/recoil/...) live on the full
    // moves.json entry, not the lightweight moves-index row.
    const full = CORE.moves.get(selected);
    const chips = D.moveChips(full);
    const effectText = (full && full.official_desc) || mv.shortDesc || '';
    const learners = (mv.learners || []).map((s) => CORE.monBySlug.get(s)).filter(Boolean);
    const haveBtn = el('button', {
      type: 'button', class: `chip-toggle ${haveOnly ? 'on' : ''}`, 'aria-pressed': String(haveOnly),
    }, haveOnly ? '✓ I have it' : 'I have it');
    haveBtn.addEventListener('click', () => { haveOnly = !haveOnly; drawDetail(); });

    const rows = haveOnly ? learners.filter((m) => D.effectiveOwned(CORE, m.slug)) : learners;
    const columns = [
      { key: 'sprite', label: '', sortVal: (r) => r.name, cell: (r) => R.sprite(r.image_url, r.name, r.types, 24) },
      {
        key: 'name', label: 'Pokémon', sortVal: (r) => r.name,
        cell: (r) => el('span', { class: 'mon-cell' }, el('span', { class: 'mon-name', text: r.name }), typeBadges(r.types)),
      },
      { key: 'usage1760', label: 'Top ①⑦⑥⓪', numeric: true, tip: 'Usage among players rated 1760+', cell: (r) => D.fractionPct(r.usage1760) },
      {
        key: 'owned', label: 'Have', sortVal: (r) => (D.effectiveOwned(CORE, r.slug) ? 1 : 0),
        cell: (r) => (D.effectiveOwned(CORE, r.slug)
          ? R.tip(el('span', { class: 'owned yes' }, '✓'), 'In your roster')
          : document.createTextNode('')),
      },
    ];

    detailHost.append(
      el('div', { class: 'move-info' },
        el('h2', { text: mv.name }),
        el('div', { class: 'move-meta' },
          mv.type ? R.typeBadge(mv.type) : null,
          el('span', { class: 'move-cat', text: mv.category || '—' }),
          el('span', { text: `Power ${mv.power ?? '—'}` }),
          el('span', { text: `Accuracy ${moveAccuracy(mv.accuracy)}` }),
          el('span', { text: `Priority ${mv.priority ?? 0}` }),
          mv.pp != null ? el('span', { text: `PP ${mv.pp}` }) : null),
        chips.length
          ? el('div', { class: 'move-chips' }, chips.map((c) => el('span', { class: 'move-chip', text: c })))
          : null,
        effectText ? el('p', { class: 'move-desc muted', text: effectText }) : null,
        mv.available === false
          ? el('p', { class: 'move-desc muted', text: 'Found in the game data but not yet '
            + 'obtainable in Pokémon Champions — no effect text published yet.' })
          : null),
      el('div', { class: 'move-learn-head' },
        el('span', { class: 'muted', text: `${learners.length} learn it` }), haveBtn),
      rows.length
        ? el('div', { class: 'table-host' },
          R.sortableTable(columns, rows, {
            sortKey: 'usage1760', sortDir: 'desc', className: 'learners-table',
            onRowClick: (r) => { location.hash = `#/mon/${encodeURIComponent(r.slug)}`; },
          }))
        : el('p', { class: 'muted', text: learners.length
          ? 'None of the learners are in your roster yet.'
          : 'No Pokémon in the dex can learn this move.' }));
  }

  // If we arrived via #/moves/<id>, prefill the search with the move's name so
  // the result list shows context; otherwise start empty.
  if (selected) search.value = moves[selected].name || '';
  search.addEventListener('input', drawList);
  drawList();
  drawDetail();
}

// --- Abilities (reverse ability search) -----------------------------------

function renderAbilities(main, abilityId) {
  const abilities = CORE.abilitiesIndex || {};
  const ids = Object.keys(abilities);
  let selected = (abilityId && abilities[abilityId]) ? abilityId : null;
  let haveOnly = false;

  const search = el('input', {
    type: 'search', class: 'ctrl', placeholder: 'Search abilities…', 'aria-label': 'Search an ability',
  });
  const listHost = el('div', { class: 'move-results' });
  const detailHost = el('div', { class: 'move-detail' });

  main.append(
    el('div', { class: 'page-head' },
      el('h1', { text: 'Abilities' }),
      el('p', { class: 'muted', text: 'Search an ability to see which Pokémon have it — e.g. everything with Intimidate. '
        + 'Hidden-ability holders are marked HA; Mega abilities list under the Mega form.' })),
    el('div', { class: 'moves-layout' },
      el('div', { class: 'moves-left' },
        el('div', { class: 'controls' }, search), listHost),
      el('div', { class: 'moves-right' }, detailHost)));

  if (!ids.length) {
    clear(listHost).append(el('p', { class: 'muted small', text: 'No ability index available (refresh the data).' }));
    return;
  }

  const select = (id) => { selected = id; drawList(); drawDetail(); };

  function drawList() {
    clear(listHost);
    const q = search.value.trim().toLowerCase();
    if (!q) {
      listHost.append(el('p', { class: 'muted small', text: `${ids.length} abilities — start typing a name.` }));
      return;
    }
    const matches = ids
      .filter((id) => (abilities[id].name || '').toLowerCase().includes(q))
      .sort((a, b) => (abilities[a].name || '').localeCompare(abilities[b].name || ''))
      .slice(0, 40);
    if (!matches.length) {
      listHost.append(el('p', { class: 'muted small', text: 'No abilities match.' }));
      return;
    }
    matches.forEach((id) => {
      const ab = abilities[id];
      const n = (ab.holders || []).length;
      const btn = el('button', {
        type: 'button', class: `move-result ${id === selected ? 'active' : ''}`,
      }, el('span', { class: 'move-result-name', text: ab.name }),
        el('span', { class: 'muted small', text: `${n}` }));
      btn.addEventListener('click', () => select(id));
      listHost.append(btn);
    });
  }

  function drawDetail() {
    clear(detailHost);
    if (!selected) {
      detailHost.append(el('p', { class: 'muted', text: 'Pick an ability to see every Pokémon that has it.' }));
      return;
    }
    const ab = abilities[selected];
    const holders = (ab.holders || []).map((h) => ({
      slug: h.slug, name: h.name, hidden: h.hidden,
      row: holderRow(h.slug), base: holderBaseSlug(h.slug),
    }));
    const haveBtn = el('button', {
      type: 'button', class: `chip-toggle ${haveOnly ? 'on' : ''}`, 'aria-pressed': String(haveOnly),
    }, haveOnly ? '✓ I have it' : 'I have it');
    haveBtn.addEventListener('click', () => { haveOnly = !haveOnly; drawDetail(); });

    const rows = haveOnly ? holders.filter((h) => D.effectiveOwned(CORE, h.base)) : holders;
    const columns = [
      { key: 'sprite', label: '', sortVal: (r) => r.name, cell: (r) => R.sprite(r.row && r.row.image_url, r.name, r.row && r.row.types, 24) },
      {
        key: 'name', label: 'Pokémon', sortVal: (r) => r.name,
        cell: (r) => el('span', { class: 'mon-cell' },
          el('span', { class: 'mon-name', text: r.name }),
          typeBadges(r.row ? r.row.types : []),
          r.hidden ? R.tip(el('span', { class: 'ha-badge' }, 'HA'), 'Hidden ability') : null),
      },
      { key: 'usage1760', label: 'Top ①⑦⑥⓪', numeric: true, tip: 'Usage among players rated 1760+', cell: (r) => D.fractionPct(r.row && r.row.usage1760) },
      {
        key: 'owned', label: 'Have', sortVal: (r) => (D.effectiveOwned(CORE, r.base) ? 1 : 0),
        cell: (r) => (D.effectiveOwned(CORE, r.base)
          ? R.tip(el('span', { class: 'owned yes' }, '✓'), 'In your roster')
          : document.createTextNode('')),
      },
    ];

    const effect = ab.official_desc || describeEntry(CORE.abilitiesByName.get(ab.name));
    const hiddenCount = holders.filter((h) => h.hidden).length;
    detailHost.append(
      el('div', { class: 'move-info' },
        el('h2', { text: ab.name }),
        effect ? el('p', { class: 'move-desc muted', text: effect }) : null),
      el('div', { class: 'move-learn-head' },
        el('span', { class: 'muted', text: `${holders.length} ${holders.length === 1 ? 'holder' : 'holders'}`
          + `${hiddenCount ? ` · ${hiddenCount} hidden` : ''}` }), haveBtn),
      el('div', { class: 'table-host' },
        R.sortableTable(columns, rows, {
          sortKey: 'usage1760', sortDir: 'desc', className: 'learners-table',
          onRowClick: (r) => { location.hash = `#/mon/${encodeURIComponent(r.slug)}`; },
        })));
  }

  // Arrived via #/abilities/<id> → prefill the search with the ability's name.
  if (selected) search.value = abilities[selected].name || '';
  search.addEventListener('input', drawList);
  drawList();
  drawDetail();
}

/** Resolve a holder slug (base or Mega) to its index mon row, for sprite /
 *  types / usage. A Mega holder borrows its base species' row (the index has
 *  no per-Mega row); its own "-Mega" name still labels it. */
function holderRow(slug) {
  if (CORE.monBySlug.has(slug)) return CORE.monBySlug.get(slug);
  const mega = CORE.megaToBase.get(slug);
  return mega ? CORE.monBySlug.get(mega.base) : null;
}

/** The base species slug for a holder (ownership is tracked per species). */
function holderBaseSlug(slug) {
  if (CORE.monBySlug.has(slug)) return slug;
  const mega = CORE.megaToBase.get(slug);
  return mega ? mega.base : slug;
}

// --- Speed tiers (More ▾) -------------------------------------------------

function renderSpeed(main) {
  // Same usage pool as the Stats page (mons with a usage number at either cutoff).
  const pool = CORE.index.mons
    .filter((m) => typeof m.usage1760 === 'number' || typeof m.usage0 === 'number');
  // ⚡ priority-attack learners, straight from the moves-index — no per-mon fetch.
  const prio = D.priorityAttackMap(CORE.movesIndex || {});
  let trickRoom = false;

  const trBtn = el('button', {
    type: 'button', class: 'chip-toggle', 'aria-pressed': 'false',
  }, 'Trick Room');
  const host = el('div', { class: 'table-host' });

  main.append(
    el('div', { class: 'page-head' },
      el('h1', { text: 'Speed tiers' }),
      el('p', { class: 'muted' },
        'Every used Pokémon by Lv50 Speed. ',
        el('b', { text: 'Min' }), ' = neutral nature, 0 SP; ',
        el('b', { text: 'Max' }), ' = +Spe nature, 32 SP; ',
        el('b', { text: '+Tailwind' }), ' = max ×2. Same-Speed mons are grouped — '
        + 'ties matter in Doubles. Toggle Trick Room to rank slowest-first.')),
    el('div', { class: 'controls' },
      R.tip(trBtn, 'Trick Room makes slower Pokémon move first — flips this table to slowest-first.')),
    host);

  const draw = () => { clear(host).append(buildSpeedTable(pool, trickRoom, prio)); };
  trBtn.addEventListener('click', () => {
    trickRoom = !trickRoom;
    trBtn.classList.toggle('on', trickRoom);
    trBtn.setAttribute('aria-pressed', String(trickRoom));
    draw();
  });
  draw();
}

const SPEED_COLS = [
  ['base', 'Base Spe', 'Base Speed stat'],
  ['min', 'Lv50 min', 'Lv50 Speed with a neutral nature and 0 SP (base + 20)'],
  ['max', 'Lv50 max', 'Lv50 Speed with a +Spe nature and the full 32 SP'],
  ['tailwind', '+Tailwind', 'Lv50 max Speed doubled by Tailwind'],
];

function buildSpeedTable(pool, trickRoom, prio) {
  const rows = D.computeSpeedTiers(pool, { trickRoom });
  const table = el('table', { class: 'data-table speed-table' });
  const headRow = el('tr', {}, el('th'), el('th', { text: 'Pokémon' }));
  SPEED_COLS.forEach(([, label, tipText]) => headRow.append(R.tip(el('th', { class: 'tnum', text: label }), tipText)));
  headRow.append(R.tip(el('th', { text: 'Have' }), 'Click to mark whether you own this Pokémon — saved automatically'));

  const tbody = el('tbody');
  let prevBase = null;
  rows.forEach((r) => {
    const tr = el('tr');
    // Group ties: a heavier top border each time the Speed value changes, so
    // same-Speed mons visually cluster (they share every column).
    if (prevBase !== null && r.spd.base !== prevBase) tr.classList.add('tier-sep');
    prevBase = r.spd.base;
    tr.append(
      el('td', {}, R.sprite(r.image_url, r.name, r.types, 24)),
      el('td', {}, speedNameCell(r, prio)));
    SPEED_COLS.forEach(([key]) => tr.append(el('td', { class: 'tnum' }, String(r.spd[key]))));
    tr.append(el('td', {}, ownedControl(r.slug)));
    tbody.append(tr);
  });
  table.append(el('thead', {}, headRow), tbody);
  return table;
}

/** Speed-page name cell: a linked mon name + type badges + ⚡ priority badge. */
function speedNameCell(r, prio) {
  const cell = el('span', { class: 'mon-cell' },
    el('a', { class: 'mon-name tm-link', href: `#/mon/${encodeURIComponent(r.slug)}` }, r.name),
    typeBadges(r.types));
  const pm = prio.get(r.slug);
  if (pm && pm.length) {
    const list = pm.map((p) => `${p.name} (+${p.priority})`).join(', ');
    cell.append(R.tip(el('span', { class: 'prio-badge' }, '⚡'), `Can learn priority attacks: ${list}`));
  }
  return cell;
}

// --- Trends ---------------------------------------------------------------

function renderTrends(main) {
  const trends = CORE.index.trends || {};
  main.append(el('div', { class: 'page-head' },
    el('h1', { text: 'Meta trends' }),
    el('p', { class: 'muted' },
      'Type % is a true share of top-ladder (1760) usage. The four lists below '
      + 'show expected appearances per 100 top-ladder teams — each Pokémon\'s '
      + 'team usage × how often it runs the item/move/ability/nature, from '
      + "Pokémon Champions' own ranked Battle Data (approximate). Bars "
      + 'are scaled to the top entry in each list.')));
  const fresh = el('div', { class: 'freshness-row' }, smogonAsOf(), ingameAsOf());
  if (fresh.childNodes.length) main.append(fresh);

  const types = trends.types || [];
  if (types.length) {
    const typeMax = Math.max(0.001, ...types.map((t) => t.pct || 0));
    const rows = types.map((t) => el('div', { class: 'trend-type-row' },
      R.typeBadge(t.type),
      el('span', { class: 'meter-track' },
        el('span', {
          class: 'meter-fill', style: { width: `${(t.pct / typeMax) * 100}%`, background: R.TYPE_COLORS[t.type] || 'var(--series-1)' },
        })),
      el('span', { class: 'meter-val tnum', text: `${(t.pct || 0).toFixed(1)}%` })));
    main.append(el('section', { class: 'card' },
      R.sectionTitle('Type distribution', 'Share of top-ladder usage each type carries (dual types counted for both)'),
      el('div', { class: 'trend-types' }, rows)));
  }

  // `tipExtra(name)` optionally appends to a row's tooltip (used to fold each
  // item's VP cost into the Top-items list).
  const listCard = (title, entries, what, tipExtra) => {
    if (!entries || !entries.length) return;
    const max = Math.max(0.0001, ...entries.map((e) => e.weight || 0));
    const rows = entries.map((e) => {
      const per100 = Math.round((e.weight || 0) * 100);
      let tipText = `Roughly ${per100} ${what} per 100 top-ladder teams — expected count from `
        + 'each Pokémon\'s team usage × how often it runs this (approximate). '
        + 'The bar is scaled to the top entry, not a percentage.';
      const extra = tipExtra ? tipExtra(e.name) : '';
      if (extra) tipText += ` · ${extra}`;
      return R.meterRow(
        el('span', { text: e.name }), 100 * ((e.weight || 0) / max), 2,
        tipText, null, `≈${per100} / 100 teams`);
    });
    main.append(el('section', { class: 'card' },
      R.sectionTitle(title, 'Expected appearances per 100 top-ladder teams'),
      el('div', { class: 'meter-list' }, rows)));
  };
  listCard('Top moves', trends.moves, 'carriers of this move');
  listCard('Top items', trends.items, 'copies of this item',
    (name) => D.itemCostText(CORE.itemsByName.get(name)));
  listCard('Top abilities', trends.abilities, 'team members with this ability');
  listCard('Top natures', trends.natures, 'team members with this nature');
}

// --- Pairing cores (More ▾) -----------------------------------------------

/** A linked mon chip (sprite + name) for a pair row, resolved from a slug. */
function pairMonChip(slug) {
  const m = CORE.monBySlug.get(slug);
  const name = m ? m.name : slug;
  return el('a', { class: 'pair-mon tm-link', href: `#/mon/${encodeURIComponent(slug)}` },
    R.sprite(m && m.image_url, name, m && m.types, 22),
    el('span', { class: 'pair-mon-name', text: name }));
}

/** In-game confirmation chip for a pair ("each lists the other at rank N/M").
 *  Null when neither mon lists the other in its in-game teammate ranking. */
function pairIngameChip(pair) {
  const a = CORE.monBySlug.get(pair.a);
  const b = CORE.monBySlug.get(pair.b);
  const an = a ? a.name : pair.a;
  const bn = b ? b.name : pair.b;
  if (pair.ig_ab == null && pair.ig_ba == null) return null;
  let label;
  let tipText;
  if (pair.ig_ab != null && pair.ig_ba != null) {
    label = 'Pokémon Champions: mutual';
    tipText = `Pokémon Champions Battle Data: ${an} lists ${bn} at #${pair.ig_ab}/${pair.ig_a_n}, `
      + `and ${bn} lists ${an} at #${pair.ig_ba}/${pair.ig_b_n}.`;
  } else if (pair.ig_ab != null) {
    label = 'Pokémon Champions ✓';
    tipText = `Pokémon Champions Battle Data: ${an} lists ${bn} at #${pair.ig_ab}/${pair.ig_a_n} (one-directional).`;
  } else {
    label = 'Pokémon Champions ✓';
    tipText = `Pokémon Champions Battle Data: ${bn} lists ${an} at #${pair.ig_ba}/${pair.ig_b_n} (one-directional).`;
  }
  return R.tip(el('span', { class: 'pair-chip ingame' }, label), tipText);
}

/** Tooltip spelling out the per-100 math (both directions, honestly). */
function pairPer100Tip(pair) {
  const a = CORE.monBySlug.get(pair.a);
  const b = CORE.monBySlug.get(pair.b);
  const an = a ? a.name : pair.a;
  const bn = b ? b.name : pair.b;
  const dirs = [];
  if (pair.p_ab != null) dirs.push(`${an}→${bn} ${pair.p_ab.toFixed(1)}`);
  if (pair.p_ba != null) dirs.push(`${bn}→${an} ${pair.p_ba.toFixed(1)}`);
  const math = pair.dir === 'both'
    ? `Both directions (${dirs.join(' · ')} per 100) averaged to ${pair.per100.toFixed(1)}.`
    : `One direction only (${dirs.join('')} per 100).`;
  return `Roughly ${Math.round(pair.per100)} teams per 100 run both — expected count from each `
    + "Pokémon's all-players usage × how often it lists the other as a teammate "
    + `(Showdown ladder). ${math} A relative estimate, not an exact count.`;
}

function buildPairsList(pairs) {
  return el('div', { class: 'pairs-list' }, pairs.map((pair, i) => {
    const badges = [];
    if (pair.mutual) {
      badges.push(R.tip(el('span', { class: 'pair-chip mutual' }, 'mutual'),
        'Each Pokémon lists the other as a teammate (in at least one signal).'));
    }
    const ig = pairIngameChip(pair);
    if (ig) badges.push(ig);
    return el('div', { class: 'pair-row' },
      el('span', { class: 'pair-rank tnum', text: String(i + 1) }),
      el('span', { class: 'pair-mons' },
        pairMonChip(pair.a),
        el('span', { class: 'pair-plus', text: '+' }),
        pairMonChip(pair.b)),
      R.tip(el('span', { class: 'pair-per100 tnum', text: `≈${pair.per100.toFixed(1)} / 100` }),
        pairPer100Tip(pair)),
      badges.length ? el('span', { class: 'pair-badges' }, badges) : null);
  }));
}

async function renderPairs(main) {
  const head = () => el('div', { class: 'page-head' },
    el('h1', { text: 'Pairing cores' }),
    el('p', { class: 'muted' },
      'The most common two-Pokémon cores, estimated from Showdown all-players '
      + 'teammate data as expected teams per 100 that run both (the same honest '
      + "quantity the Trends page uses). Pokémon Champions' own teammate "
      + 'rankings ride along as confirmation — the game publishes the order, not a '
      + 'percentage.'));
  main.append(head(), el('p', { class: 'loading', text: 'Loading…' }));

  const data = await D.getDexJson('pairs-index.json');
  clear(main).append(head());
  if (!data || !Array.isArray(data.pairs)) {
    main.append(notBuiltNotice('The pairing-cores list'));
    return;
  }

  let ownedOnly = false;
  const ownedBtn = el('button', {
    type: 'button', class: 'chip-toggle', 'aria-pressed': 'false',
  }, 'Owned pairs only');
  const note = el('p', { class: 'muted small pairs-note' });
  const host = el('div', { class: 'pairs-host' });

  main.append(
    el('div', { class: 'controls' },
      R.tip(ownedBtn, 'Show only pairs where you own BOTH Pokémon.')),
    note, host);

  const draw = () => {
    const shown = ownedOnly
      ? data.pairs.filter((p) => D.effectiveOwned(CORE, p.a) && D.effectiveOwned(CORE, p.b))
      : data.pairs;
    clear(host);
    if (!shown.length) {
      host.append(ownedOnly
        ? el('p', { class: 'muted empty-filter', text: 'No ranked pairs where you own both Pokémon yet — '
          + 'mark ownership with the ✓ toggles (Overview or a Pokémon page), or turn off "Owned pairs only".' })
        : el('p', { class: 'muted empty-filter', text: 'No pairs available (not enough teammate data).' }));
    } else {
      host.append(buildPairsList(shown));
    }
    note.textContent = ownedOnly
      ? `${shown.length} owned-only pair(s), out of the top ${data.shown} of ${D.formatInt(data.total_pairs)} cores.`
      : `Top ${data.shown} of ${D.formatInt(data.total_pairs)} cores (capped at ${data.cap}), most common first.`;
  };
  ownedBtn.addEventListener('click', () => {
    ownedOnly = !ownedOnly;
    ownedBtn.classList.toggle('on', ownedOnly);
    ownedBtn.setAttribute('aria-pressed', String(ownedOnly));
    draw();
  });
  draw();
}

// --- Signal divergence (More ▾) -------------------------------------------

function divergenceRow(mon, maxScore) {
  const m = CORE.monBySlug.get(mon.slug);
  const name = m ? m.name : mon.slug;
  const width = maxScore > 0 ? Math.min(100, (mon.score / maxScore) * 100) : 0;
  return el('div', { class: 'div-row' },
    R.sprite(m && m.image_url, name, m && m.types, 28),
    el('div', { class: 'div-body' },
      el('a', { class: 'div-name tm-link', href: `#/mon/${encodeURIComponent(mon.slug)}` }, name),
      el('span', { class: 'div-fact muted', text: D.divergenceFact(mon) })),
    el('div', { class: 'div-score' },
      el('span', { class: 'meter-track div-meter' },
        el('span', { class: 'meter-fill series-1', style: { width: `${width}%` } })),
      R.tip(el('span', { class: 'div-score-num tnum', text: mon.score.toFixed(1) }),
        `Divergence ${mon.score.toFixed(1)}/100 — a weighted blend of how much `
        + "Showdown's and Pokémon Champions' top moves (40%), items (30%), abilities (15%), "
        + 'and natures (15%) disagree. Higher = the signals differ more.')));
}

async function renderDivergence(main) {
  const head = () => el('div', { class: 'page-head' },
    el('h1', { text: 'Signal divergence' }),
    el('p', { class: 'muted' },
      'Where the two signals disagree most. They come from different populations: '
      + "Showdown's ladder is a fan simulator with its own metagame, while Battle "
      + "Data is Pokémon Champions' own ranked play — and item/move "
      + 'availability can differ by timing. Neither is "right"; a big gap just flags '
      + 'where simulator habits and Pokémon Champions play diverge.'));
  main.append(head(), el('p', { class: 'loading', text: 'Loading…' }));

  const data = await D.getDexJson('divergence-index.json');
  clear(main).append(head());
  if (!data || !Array.isArray(data.mons)) {
    main.append(notBuiltNotice('The divergence list'));
    return;
  }
  const mons = data.mons;
  main.append(el('p', { class: 'muted small' },
    `Comparing top-5 moves & items and top-3 abilities & natures for the ${mons.length} `
    + `Pokémon with BOTH signals. ${data.excluded_single_signal} more carry only one signal `
    + 'and are excluded.'));
  if (!mons.length) {
    main.append(el('section', { class: 'card' },
      el('p', { class: 'muted', text: 'No Pokémon have both signals yet.' })));
    return;
  }
  const maxScore = Math.max(...mons.map((m) => m.score), 1);
  main.append(el('section', { class: 'card' },
    R.sectionTitle('Most divergent first', 'Score 0–100; the fact is the single clearest disagreement'),
    el('div', { class: 'div-list' }, mons.map((m) => divergenceRow(m, maxScore)))));
}

// --- Roster coverage (More ▾) ---------------------------------------------

/** ×-label for a type multiplier (null = no damaging move at all). */
function multLabel(mult) {
  if (mult == null) return '—';
  const map = { 0: '×0', 0.25: '×¼', 0.5: '×½', 1: '×1', 2: '×2', 4: '×4' };
  return map[mult] || `×${mult}`;
}

/** A linked mon chip with its combined (dual-type) multiplier, e.g.
 *  "Dragonite ×4" — the visible proof both of a mon's types were multiplied. */
function covMonChip(entry, kind) {
  const sev = entry.mult >= 4 ? 'x4' : entry.mult === 0 ? 'x0' : '';
  return el('a', {
    class: `cov-mon-chip ${kind} ${sev}`,
    href: `#/mon/${encodeURIComponent(entry.slug)}`,
  }, entry.name, el('span', { class: 'cov-chip-mult tnum', text: ` ${multLabel(entry.mult)}` }));
}

/** One line of the expanded detail: a label + mon chips (or a quiet "none"). */
function covDetailLine(label, entries, kind) {
  return el('div', { class: 'cov-detail-line' },
    el('span', { class: 'cov-detail-label muted small', text: label }),
    entries.length
      ? el('span', { class: 'cov-chip-wrap' }, entries.map((e) => covMonChip(e, kind)))
      : el('span', { class: 'muted small', text: 'none' }));
}

/** One expandable defensive row: counts up front; click to list exactly which
 *  owned mons are weak / resist with their combined multiplier (both of a
 *  mon's types multiply — ×4 / ×2 / ×½ / ×¼ / ×0). */
function defensiveRow(row) {
  const weak = row.weak.slice().sort((a, b) => (b.mult - a.mult) || a.name.localeCompare(b.name));
  const resist = row.resist.slice().sort((a, b) => (a.mult - b.mult) || a.name.localeCompare(b.name));
  const chevron = el('span', { class: 'cov-chevron', text: '▸' });
  const detail = el('div', { class: 'cov-def-detail' },
    covDetailLine('Weak:', weak, 'weak'),
    covDetailLine('Resists/immune:', resist, 'resist'));
  detail.hidden = true;
  const btn = el('button', {
    type: 'button',
    class: `cov-def-row ${row.pileUp ? 'pileup' : ''}`,
    'aria-expanded': 'false',
    onClick: () => {
      detail.hidden = !detail.hidden;
      btn.setAttribute('aria-expanded', String(!detail.hidden));
      chevron.textContent = detail.hidden ? '▸' : '▾';
    },
  },
  el('span', { class: 'cov-def-type' }, R.typeBadge(row.atk),
    el('span', { class: 'cov-type-name', text: row.atk })),
  el('span', { class: 'cov-weak tnum', text: `${row.weakCount} weak` }),
  el('span', { class: 'cov-resist tnum', text: `${row.resistCount} resist` }),
  row.pileUp ? el('span', { class: 'cov-pileup-badge', text: '⚠ pile-up' }) : null,
  chevron);
  return el('div', { class: 'cov-def-block' }, btn, detail);
}

function renderCoverage(main) {
  main.append(el('div', { class: 'page-head' },
    el('h1', { text: 'Roster coverage' }),
    el('p', { class: 'muted' },
      'Defensive type coverage over the Pokémon you own — which attacking types '
      + "threaten your roster and where weaknesses pile up. Both of a Pokémon's "
      + 'types multiply together (a Dragon/Flying Pokémon takes ×4 from Ice); '
      + 'click any row to see exactly who is weak or resistant and by how much. '
      + 'Reacts to the same ✓/○ ownership you set elsewhere.')));

  const owned = CORE.index.mons.filter((m) => D.effectiveOwned(CORE, m.slug));
  if (!owned.length) {
    main.append(el('div', { class: 'notice' },
      el('h2', { text: 'No owned Pokémon yet' }),
      el('p', {}, 'Mark the Pokémon you own with the ',
        el('b', { text: '✓ / ○' }),
        ' toggles (in the Overview "Have" column or on any Pokémon page), then this '
        + 'page shows which attacking types threaten your roster and where '
        + 'weaknesses pile up.')));
    return;
  }

  // Defensive: weak vs resist counts per attacking type, most dangerous first.
  const def = D.defensiveCoverage(owned, CORE.typechart).slice()
    .sort((a, b) => (b.weakCount - a.weakCount)
      || (a.resistCount - b.resistCount)
      || (TYPES.indexOf(a.atk) - TYPES.indexOf(b.atk)));
  const pileUps = def.filter((r) => r.pileUp);
  main.append(el('section', { class: 'card' },
    R.sectionTitle('Defensive coverage',
      `How many of your ${owned.length} owned Pokémon are weak vs resist each attacking type (most dangerous first)`),
    pileUps.length
      ? el('p', { class: 'cov-callout warn' },
        el('b', { text: '⚠ Shared weaknesses (3+): ' }),
        `${pileUps.map((r) => `${r.atk} (${r.weakCount})`).join(', ')}.`)
      : el('p', { class: 'cov-callout good', text: 'No single type threatens 3 or more of your owned Pokémon.' }),
    el('div', { class: 'cov-def-list' }, def.map(defensiveRow))));
}

// --- Tournaments (More ▾) -------------------------------------------------

/** Resolve a tournament mon record ({name, slug}) to a link slug. Prefers the
 *  scraped slug (VR's sprite slug, our dex slug for all but a few cosmetic
 *  forms); falls back to display-name resolution (the alias map); null when the
 *  form is genuinely absent from the dex (Floette-Eternal etc. → plain text). */
function tournamentMonSlug(mon) {
  const slug = mon && mon.slug;
  if (slug && (CORE.monBySlug.has(slug) || CORE.megaToBase.has(slug))) return slug;
  return monLinkSlug((mon && mon.name) || '');
}

/** A linked mon name for a tournament mon, or plain text when unresolvable. */
function tournamentMonLink(mon) {
  const slug = tournamentMonSlug(mon);
  const name = (mon && mon.name) || '';
  if (slug) return el('a', { class: 'tm-link', href: `#/mon/${encodeURIComponent(slug)}` }, name);
  return el('span', { text: name });
}

/** A sprite+name chip for a tournament mon (used in standings + names-only teams). */
function tournamentMonChip(mon) {
  const slug = tournamentMonSlug(mon);
  const row = slug ? holderRow(slug) : null;
  const name = (mon && mon.name) || '';
  const inner = [
    R.sprite(row && row.image_url, name, row && row.types, 22),
    el('span', { class: 'tt-mon-name', text: name }),
  ];
  if (slug) {
    return el('a', { class: 'tt-mon-chip tm-link', href: `#/mon/${encodeURIComponent(slug)}` }, inner);
  }
  return el('span', { class: 'tt-mon-chip' }, inner);
}

/** A full detail block for a rich (paste-backed) mon: name + item + ability +
 *  linked moves. Item/ability/moves come straight from the open team list. */
function tournamentRichMon(mon) {
  const slug = tournamentMonSlug(mon);
  const row = slug ? holderRow(slug) : null;
  const moves = (mon.moves || []).map((mv, i) => {
    const id = CORE.moveNameToId ? CORE.moveNameToId.get(D.normName(mv)) : null;
    return el('span', { class: 'tt-move' }, i ? el('span', { class: 'tt-move-sep', text: ' · ' }) : null,
      moveLink(id, mv));
  });
  return el('div', { class: 'tt-rich-mon' },
    R.sprite(row && row.image_url, mon.name, row && row.types, 32),
    el('div', { class: 'tt-rich-body' },
      el('div', { class: 'tt-rich-head' },
        tournamentMonLink(mon),
        mon.item ? el('span', { class: 'tt-item' }, ` @ ${mon.item}`) : null,
        mon.ability ? el('span', { class: 'tt-ability muted small', text: mon.ability }) : null),
      moves.length ? el('div', { class: 'tt-moves muted small' }, moves) : null));
}

/** Scheme allowlist for hrefs sourced from scraped data (tournaments.json is
 *  a committed artifact — a future source or hand edit must not be able to
 *  smuggle a javascript:/data: URI into a clickable link). */
function safeHref(u) {
  return (typeof u === 'string' && /^(https?:|#)/i.test(u.trim())) ? u : null;
}

/** A muted "source · date" caption for a tournament block. */
function tournamentSourceLine(url, dateStr, label) {
  const bits = [];
  if (label) bits.push(label);
  if (dateStr) bits.push(dateStr);
  const cap = el('span', { class: 'muted small', text: bits.join(' · ') });
  const href = safeHref(url);
  if (!href) return el('p', { class: 'tt-source' }, cap);
  return el('p', { class: 'tt-source' }, cap,
    el('span', { text: ' · ' }),
    el('a', { class: 'tt-source-link', href, target: '_blank', rel: 'noopener' }, 'source ↗'));
}

/** One standings phase as a card (place · player · team), long lists collapsed. */
function tournamentEventCard(ev) {
  const standings = ev.standings || [];
  const card = el('section', { class: 'card tt-event' });
  const title = ev.phase ? `${ev.name} — ${ev.phase}` : ev.name;
  card.append(R.sectionTitle(title, `${standings.length} placement${standings.length === 1 ? '' : 's'}`));
  card.append(tournamentSourceLine(ev.source_url, ev.date, 'Victory Road'));

  const host = el('div', { class: 'tt-standings' });
  const CAP = 24;
  let expanded = false;
  const draw = () => {
    clear(host);
    const shown = expanded ? standings : standings.slice(0, CAP);
    shown.forEach((s) => {
      host.append(el('div', { class: 'tt-standing-row' },
        el('span', { class: 'tt-place tnum', text: s.place == null ? '—' : String(s.place) }),
        el('span', { class: 'tt-player' }, el('span', { class: 'tt-player-name', text: s.player || '—' }),
          s.record ? el('span', { class: 'tt-record muted small', text: ` ${s.record}` }) : null),
        el('span', { class: 'tt-team' }, (s.team || []).map(tournamentMonChip))));
    });
    if (standings.length > CAP) {
      const btn = el('button', { type: 'button', class: 'chip-toggle tt-more' },
        expanded ? 'Show fewer' : `Show all ${standings.length}`);
      btn.addEventListener('click', () => { expanded = !expanded; draw(); });
      host.append(btn);
    }
  };
  draw();
  card.append(host);
  return card;
}

/** One notable team as a card. Rich (item/ability/moves) when paste-backed,
 *  else a names-only chip row — each labelled with its source + fetch context. */
function tournamentTeamCard(team) {
  const mons = team.mons || [];
  const rich = mons.some((m) => m.item || m.ability || (m.moves && m.moves.length));
  const meta = [];
  if (team.placement) meta.push(team.placement);
  const card = el('section', { class: 'card tt-team' });
  card.append(el('div', { class: 'tt-team-head' },
    el('h3', { class: 'tt-team-title', text: team.title || team.player || 'Team' }),
    rich ? R.tip(el('span', { class: 'tt-badge rich' }, 'full list'),
      'Item, ability and moves from the player\'s open team list (VRPastes).')
      : R.tip(el('span', { class: 'tt-badge names' }, 'names only'),
        'Team members only — this source doesn\'t publish the item/ability/move detail.')));
  const srcUrl = team.paste_url || team.event_url || team.source_url;
  const srcLabel = team.paste_url ? 'Victory Road · VRPastes' : 'Victory Road';
  card.append(tournamentSourceLine(srcUrl, team.date, srcLabel));
  if (rich) {
    card.append(el('div', { class: 'tt-rich-team' }, mons.map(tournamentRichMon)));
  } else {
    card.append(el('div', { class: 'tt-names-team' }, mons.map(tournamentMonChip)));
  }
  return card;
}

async function renderTournaments(main) {
  const head = () => el('div', { class: 'page-head' },
    el('h1', { text: 'Tournaments' }),
    el('p', { class: 'muted' },
      'Community-reported results and notable teams from ',
      el('b', { text: 'Victory Road' }),
      ' — a third view alongside the two ranked usage signals (Showdown ladder + '
      + 'Pokémon Champions Battle Data). These are human-curated event reports and open team '
      + 'lists, not aggregate statistics, so treat them as "here\'s what won", not usage %.'));
  main.append(head(), el('p', { class: 'loading', text: 'Loading…' }));

  const data = await D.getDexJson('tournaments.json');
  clear(main).append(head());
  if (!data) {
    main.append(notBuiltNotice('The tournament results'));
    return;
  }

  const events = Array.isArray(data.events) ? data.events : [];
  const teams = Array.isArray(data.teams) ? data.teams : [];
  main.append(el('p', { class: 'muted small tt-fetched' },
    `Community data · fetched ${data.fetched_at || '—'} · `
    + `${events.length} event phase${events.length === 1 ? '' : 's'}, `
    + `${teams.length} team${teams.length === 1 ? '' : 's'}. Mon names link to their pages.`));

  if (!events.length && !teams.length) {
    main.append(el('section', { class: 'card' },
      el('p', { class: 'muted', text: 'tournaments.json is present but carries no events or '
        + 'teams yet. Re-run the tournament scraper to populate it.' })));
    return;
  }

  if (events.length) {
    main.append(el('h2', { class: 'tt-section-h', text: 'Event standings' }));
    events.forEach((ev) => main.append(tournamentEventCard(ev)));
  }
  if (teams.length) {
    main.append(el('h2', { class: 'tt-section-h', text: 'Notable teams' }));
    main.append(el('p', { class: 'muted small' },
      'Open team lists from top finishers, richest first. "Full list" cards carry '
      + 'item / ability / moves; "names only" cards list the six team members.'));
    teams.forEach((team) => main.append(tournamentTeamCard(team)));
  }
}

// --- New in Champions (More ▾) --------------------------------------------

/** One row for a Champions-original move/ability/item. Tolerant of both a bare
 *  string ("Eelevate") and an object ({name, official_desc, ...}). Moves link
 *  to their Moves page when the id resolves; everything else is name + effect. */
function championsRow(raw, kind) {
  const entry = (raw && typeof raw === 'object') ? raw : { name: String(raw) };
  const name = entry.name || entry.showdown_id || '';
  if (!name) return null;
  let desc = entry.official_desc || entry.desc || entry.description || entry.pkmn_shortDesc || '';
  let nameNode;
  let moveMeta = null;
  let note = null;
  if (kind === 'move') {
    const id = entry.showdown_id || entry.id || (CORE.moveNameToId && CORE.moveNameToId.get(D.normName(name)));
    nameNode = (id && CORE.movesIndex && CORE.movesIndex[id])
      ? el('a', { class: 'tm-link', href: `#/moves/${encodeURIComponent(id)}` }, name)
      : el('span', { text: name });
    // The full moves.json entry carries the stats (and, for unreleased moves,
    // the availability flag) even when the game has no effect text yet.
    const full = id ? CORE.moves.get(id) : null;
    if (full) {
      desc = desc || full.official_desc || full.pkmn_shortDesc || full.description || '';
      moveMeta = el('span', { class: 'champ-move-meta' },
        full.type ? R.typeBadge(full.type) : null,
        el('span', { class: 'muted small',
          text: ` ${full.category || '—'} · Power ${full.power ?? '—'} · `
            + `Accuracy ${moveAccuracy(full.accuracy)} · PP ${full.pp ?? '—'}` }));
      if (full.available_in_champions === false) {
        note = el('span', { class: 'champ-desc muted', text: 'Found in the game data but '
          + 'not yet obtainable — no Pokémon currently learns it.' });
      }
    }
  } else {
    nameNode = el('span', { text: name });
  }
  return el('div', { class: 'champ-row' },
    el('span', { class: 'champ-name' }, nameNode, moveMeta),
    desc ? el('span', { class: 'champ-desc muted', text: desc }) : null,
    note);
}

/** A titled card listing Champions-original content; empty lists render an
 *  explicit "none flagged yet" note rather than vanishing. */
function championsList(title, entries, kind) {
  const rows = (entries || []).map((raw) => championsRow(raw, kind)).filter(Boolean);
  const body = rows.length
    ? el('div', { class: 'champ-list' }, rows)
    : el('p', { class: 'muted small', text: 'None flagged in the current data.' });
  return el('section', { class: 'card' },
    R.sectionTitle(title, `${rows.length} Champions-original`),
    body);
}

async function renderNewInChampions(main) {
  const head = () => el('div', { class: 'page-head' },
    el('h1', { text: 'New in Champions' }),
    el('p', { class: 'muted', text: 'Moves, abilities, and items that are original to '
      + 'Pokémon Champions — they have no match in the standard game data, so their '
      + 'effects here come straight from the game.' }));
  main.append(head(), el('p', { class: 'loading', text: 'Loading…' }));

  const meta = await D.getDexJson('meta-regmb-doubles.json');
  clear(main).append(head());
  if (!meta) {
    main.append(notBuiltNotice('The Champions-original lists'));
    return;
  }
  const moves = meta.champions_only_moves || [];
  const abilities = meta.champions_only_abilities || [];
  const items = meta.champions_only_items || [];
  if (!moves.length && !abilities.length && !items.length) {
    main.append(el('section', { class: 'card' },
      el('p', { class: 'muted', text: 'No Champions-original moves, abilities, or items are '
        + 'flagged in the current data yet. Once the pipeline identifies them (content with '
        + 'no standard-game match), they will be listed here.' })));
    return;
  }
  main.append(championsList('Moves', moves, 'move'));
  main.append(championsList('Abilities', abilities, 'ability'));
  main.append(championsList('Items', items, 'item'));
}

// --- Ranks & VP (More ▾) --------------------------------------------------

/** A friendly "not built yet" card for pages whose data file hasn't landed. */
function notBuiltNotice(what) {
  return el('div', { class: 'notice' },
    el('h2', { text: 'Not built yet' }),
    el('p', {}, `${what} come from a data file that hasn't been generated on this machine yet.`),
    el('p', { class: 'muted', text: 'Run the data refresh (launch serve.cmd, or the manual '
      + 'pipeline on the About page) to build it, then reload this page.' }));
}

/** Map a confidence level to a visible label + class. null → plain (confirmed
 *  or unknown); guide → "per guides"; uncertain → clearly-marked warning. */
function confidenceTag(conf) {
  if (conf === 'guide') return { text: 'per guides', cls: 'conf-guide' };
  if (conf === 'uncertain') return { text: 'unverified · single source', cls: 'conf-uncertain' };
  if (conf === 'confirmed' || conf == null) return null;
  return { text: String(conf), cls: 'conf-other' };
}

/** A confidence cell: a coloured chip for guide/uncertain, a plain "confirmed"
 *  otherwise. The source (when present) is attributed in the tooltip. */
function confCell(conf, source) {
  const tag = confidenceTag(conf);
  const node = tag
    ? el('span', { class: `conf-chip ${tag.cls}`, text: tag.text })
    : el('span', { class: 'conf-plain muted small', text: conf === 'confirmed' ? 'confirmed' : '' });
  if (source) R.tip(node, `Source: ${source}`);
  return node;
}

function ranksSection(ranks) {
  const rows = ranks.map((r, i) => el('li', { class: 'rank-row' },
    el('span', { class: 'rank-num tnum', text: String((r && r.index != null) ? r.index : i) }),
    el('span', { class: 'rank-name', text: (r && r.name) || '—' })));
  return el('section', { class: 'card' },
    R.sectionTitle('Ranked ladder', `${ranks.length} tiers — Champion at the top`),
    el('ol', { class: 'rank-ladder' }, rows));
}

function titlesSection(titles) {
  return el('section', { class: 'card' },
    R.sectionTitle('Titles'),
    el('ul', { class: 'title-list' }, titles.map((t) =>
      el('li', { text: (t && t.name) || String(t) }))));
}

/** In-game achievements from champout's game-ripped table. Each row is
 *  {name, description}; the description carries `{0}`/`{1}`/`{2}` template slots
 *  the game fills in (a count, a Pokémon, a type). Rendered verbatim as the
 *  game's own text — no confidence chip (these are game-ripped, not sourced). */
function achievementsSection(achievements) {
  const rows = achievements.map((a) => {
    const desc = a && a.description ? String(a.description).replace(/\s+/g, ' ').trim() : '';
    return el('div', { class: 'achievement-row' },
      el('span', { class: 'achievement-name', text: (a && a.name) || '—' }),
      desc ? el('span', { class: 'achievement-desc muted', text: desc }) : null);
  });
  return el('section', { class: 'card' },
    R.sectionTitle('Achievements',
      `${achievements.length} Pokémon Champions achievements — {0}/{1}/{2} are fill-in counts/Pokémon/types`),
    el('div', { class: 'achievement-list' }, rows));
}

function seasonsSection(seasons) {
  const rows = seasons.map((s) => {
    const range = [s.start, s.end].filter(Boolean).join(' → ') || 'dates TBC';
    return el('div', { class: 'season-row' },
      el('span', { class: 'season-id', text: s.id || '—' }),
      el('span', { class: 'season-reg', text: s.regulation ? `Reg ${s.regulation}` : '' }),
      el('span', { class: 'season-range muted', text: range }),
      confCell(s.confidence, s.source));
  });
  return el('section', { class: 'card' },
    R.sectionTitle('Season timeline', 'Each competitive season and its regulation'),
    el('div', { class: 'season-list' }, rows));
}

function economySection(economy) {
  const rows = economy.map((e) => el('tr', {},
    el('td', {},
      el('span', { class: 'econ-label', text: e.label || '—' }),
      e.note ? el('span', { class: 'econ-note muted small', text: ` — ${e.note}` }) : null),
    el('td', { class: 'tnum' }, e.vp != null ? `${D.formatInt(e.vp)} VP` : '—'),
    el('td', {}, confCell(e.confidence, e.source))));
  const table = el('table', { class: 'data-table econ-table' },
    el('thead', {}, el('tr', {},
      el('th', { text: 'What' }), el('th', { class: 'tnum', text: 'Cost' }),
      el('th', { text: 'Confidence' }))),
    el('tbody', {}, rows));
  return el('section', { class: 'card' },
    R.sectionTitle('VP economy', 'What Victory Points buy — confidence labelled per row'),
    el('div', { class: 'table-host' }, table));
}

function legalitySection(leg) {
  return el('section', { class: 'card' },
    R.sectionTitle('Format legality', 'Reg M-B'),
    el('ul', { class: 'kv' },
      el('li', {}, el('b', { text: 'Legal species: ' }), leg.species != null ? String(leg.species) : '—'),
      el('li', {}, el('b', { text: 'Legal Megas: ' }), leg.megas != null ? String(leg.megas) : '—')),
    el('div', { class: 'legality-conf' }, confCell(leg.confidence, leg.source)));
}

async function renderRanksVp(main) {
  const head = () => el('div', { class: 'page-head' },
    el('h1', { text: 'Ranks & VP' }),
    el('p', { class: 'muted', text: 'The competitive ladder tiers, season timeline, and '
      + 'Victory-Point economy. Each figure is labelled by how confident the source is.' }));
  main.append(head(), el('p', { class: 'loading', text: 'Loading…' }));

  const info = await D.getDexJson('game-info.json');
  clear(main).append(head());
  if (!info) {
    main.append(el('div', { class: 'notice' },
      el('h2', { text: 'Game info not built yet' }),
      el('p', {}, 'The ranks, seasons, and VP economy come from ',
        el('b', { text: 'data/dex/game-info.json' }),
        ", which hasn't been generated on this machine yet."),
      el('p', { class: 'muted', text: 'Run the data refresh (launch serve.cmd, or the manual '
        + 'pipeline on the About page) to build it, then reload this page.' })));
    return;
  }

  const ranks = Array.isArray(info.ranks) ? info.ranks : [];
  const titles = Array.isArray(info.titles) ? info.titles : [];
  const achievements = Array.isArray(info.achievements) ? info.achievements : [];
  const seasons = Array.isArray(info.seasons) ? info.seasons : [];
  const economy = Array.isArray(info.economy) ? info.economy : [];
  if (ranks.length) main.append(ranksSection(ranks));
  if (titles.length) main.append(titlesSection(titles));
  if (achievements.length) main.append(achievementsSection(achievements));
  if (seasons.length) main.append(seasonsSection(seasons));
  if (economy.length) main.append(economySection(economy));
  if (info.legality && typeof info.legality === 'object') main.append(legalitySection(info.legality));
  if (info.sources_note) {
    main.append(el('p', { class: 'muted small sources-note', text: info.sources_note }));
  }
  if (!ranks.length && !titles.length && !achievements.length && !seasons.length
      && !economy.length && !info.legality) {
    main.append(el('section', { class: 'card' },
      el('p', { class: 'muted', text: 'game-info.json is present but empty — nothing to show yet.' })));
  }
}

// --- About ----------------------------------------------------------------

// Every page in the portal, one line each — the About page renders this as a
// linked directory (nav row 1 = browse the dex, row 2 = meta views + game info).
const PAGE_DIRECTORY = [
  ['#/', 'Overview', 'every ranked Pokémon — search, stack filters (type + ability + move), sort, ✓/○ ownership'],
  ['#/stats', 'Stats', 'the full base-stat comparison table, sortable by any stat'],
  ['#/speed', 'Speed', 'Lv50 speed tiers — min / max / Tailwind, with a Trick Room toggle'],
  ['#/moves', 'Moves', 'reverse move search — who learns it, power/accuracy/PP + effect chips'],
  ['#/abilities', 'Abilities', 'reverse ability search — who has it, hidden abilities marked'],
  ['#/trends', 'Trends', 'the meta at a glance — type share + top items, natures, abilities, moves'],
  ['#/pairs', 'Pairs', 'the most common two-Pokémon cores, both signals'],
  ['#/divergence', 'Divergence', 'where the Showdown ladder and Pokémon Champions disagree most'],
  ['#/coverage', 'Coverage', "your owned roster's defensive type chart (click rows for per-mon detail)"],
  ['#/tournaments', 'Tournaments', 'community event standings and winning team lists'],
  ['#/new', 'New in Champions', 'moves, abilities and items original to Pokémon Champions'],
  ['#/ranks', 'Ranks & VP', 'ladder tiers, seasons, achievements and the VP economy'],
];

function renderAbout(main) {
  const gen = CORE.index.generated_from || {};
  const sp = CORE.sp || {};
  const fresh = CORE.freshness || {};
  const roster = (CORE.index.roster) || { confirmed: [], likely: [], unmatched: [] };

  main.append(el('div', { class: 'page-head' }, el('h1', { text: 'About this portal' })));

  main.append(el('section', { class: 'card' },
    R.sectionTitle('Pages', 'what lives where'),
    el('ul', { class: 'kv page-directory' }, PAGE_DIRECTORY.map(([href, label, desc]) =>
      el('li', {}, el('a', { href }, el('b', { text: label })),
        el('span', { class: 'muted', text: ` — ${desc}` }))))));

  const bd = fresh.battle_data || {};
  const ownedCount = (CORE.index.mons || []).filter((m) => D.effectiveOwned(CORE, m.slug)).length;
  const tournamentsLine = el('span', { text: 'checking…' });
  D.getDexJson('tournaments.json').then((t) => {
    tournamentsLine.textContent = t && t.fetched_at
      ? `${(t.teams || []).length} teams · fetched ${t.fetched_at}`
      : 'not built on this machine';
  });
  main.append(el('section', { class: 'card' },
    R.sectionTitle('Data'),
    el('ul', { class: 'kv' },
      el('li', {}, el('b', { text: 'Showdown ladder: ' }),
        `${gen.month || '—'} · ${gen.format || '—'} · ${D.formatInt(gen.battles)} battles · cutoffs ${(gen.cutoffs || []).join(', ')}`),
      el('li', {}, el('b', { text: 'Pokémon Champions Battle Data: ' }),
        bd.season || bd.generated_at
          ? `${bd.season || '—'}${bd.generated_at ? ` · generated ${String(bd.generated_at).slice(0, 10)}` : ''}`
          : '—'),
      el('li', {}, el('b', { text: 'Tournaments: ' }), tournamentsLine),
      fresh.pulled_at ? el('li', {}, el('b', { text: 'Last source pull: ' }), fresh.pulled_at) : null,
      el('li', {}, el('b', { text: 'In the dex: ' }),
        `${(CORE.index.mons || []).length} ranked Pokémon · ${Object.keys(CORE.movesIndex || {}).length} moves · `
        + `${Object.keys(CORE.abilitiesIndex || {}).length} abilities · you own ${ownedCount}`))));

  main.append(el('section', { class: 'card' },
    R.sectionTitle('SP system', 'Champions trains with Stat Points (SP)'),
    el('ul', { class: 'kv' },
      el('li', {}, `${sp.total} SP total, max ${sp.per_stat_cap} per stat`),
      el('li', {}, `${sp.vp_per_sp} VP per SP · ${sp.vp_per_nature_change} VP per nature change`),
      el('li', {}, `Byte order: ${(sp.byte_order || []).map((k) => R.STAT_SHORT[k] || k).join(' / ')}`)),
    el('h3', { class: 'sub-head', text: 'How a stat reads at Lv50' }),
    el('p', {}, 'The "→ final" values on the Stats and detail pages use the confirmed '
      + 'Champions Lv50 formula:'),
    el('pre', { class: 'code' },
      'HP    = base + SP + 75\n'
      + 'other = floor((base + SP + 20) × nature)     nature = 1.1 raised / 0.9 lowered / 1.0 neutral'),
    el('p', { class: 'muted' }, 'The "1 SP = +1 stat" rule is the neutral-case '
      + 'training-cost shorthand — a nature-raised stat actually gains about 1.1 '
      + 'per SP once the multiplier applies (HP is never nature-modified).'),
    el('p', { class: 'muted' }, 'Verify it yourself: Incineroar with the common '
      + 'Careful · 32/0/14/0/20/0 build reads Sp. Def 143 at Lv50.')));

  const writable = D.ownedIsWritable(CORE);
  main.append(el('section', { class: 'card' },
    R.sectionTitle('Ownership', `seeded from ${CORE.ownedSeed.size} roster entries`),
    el('p', {}, 'Click the ', el('b', { text: '✓ / ○' }),
      ' toggle on any Pokémon (in the overview table or on its detail page) to mark whether you own it.'),
    el('p', { class: 'muted' }, writable
      ? 'Your choices are saved on the PC running the portal (data/owned-overrides.json), so every device on your home network shares one list and it survives browser resets. It was seeded once from docs/roster.md; each toggle overrides the seed.'
      : 'Read-only right now — ownership is seeded from docs/roster.md but the toggles are disabled because the save-enabled server isn\'t running. Start the portal with serve.cmd to make ownership editable.'),
    roster.unmatched.length
      ? el('div', {},
        el('p', { class: 'muted', text: 'Roster names that did not match a dex file (fix the spelling in docs/roster.md, or they are transfer-exclusive forms absent from the dex):' }),
        el('ul', { class: 'unmatched' }, roster.unmatched.map((u) => el('li', { text: u }))))
      : el('p', { class: 'muted', text: 'Every roster name matched a dex file.' })));

  main.append(el('section', { class: 'card' },
    R.sectionTitle('Refresh the data'),
    el('p', {}, 'This happens ', el('b', { text: 'automatically' }),
      '. Each time you launch the portal (serve.cmd / serve-lan.cmd), it checks '
      + 'whether a newer Smogon month is published or the Pokémon Champions '
      + 'data is over a week old, and refreshes if so — otherwise it '
      + 'starts instantly. '
      + 'Checks are throttled to once per ~20 hours and never block serving.'),
    el('p', { class: 'muted', text: 'You can still refresh by hand from the project root:' }),
    el('pre', { class: 'code' },
      '.venv\\Scripts\\python.exe scripts\\pull.py --sprites --battle-data\n'
      + '.venv\\Scripts\\python.exe scripts\\build_dex.py --sprites --battle-data\n'
      + '.venv\\Scripts\\python.exe scripts\\build_portal_index.py')));

  main.append(el('section', { class: 'card' },
    R.sectionTitle('Sources'),
    el('p', { class: 'muted' },
      'Two usage signals sit side by side: the blue one is the '
      + 'Showdown fan-simulator ladder; the aqua one is Pokémon Champions\' own '
      + 'ranked Battle Data (the real game).'),
    el('ul', { class: 'kv' },
      el('li', {}, 'Showdown ladder usage (blue signal) — smogon.com/stats'),
      el('li', {}, 'Pokémon Champions Battle Data (aqua signal) — championsbattledata.com'),
      el('li', {}, 'Game-ripped tables — projectpokemon/champout'),
      el('li', {}, 'Type chart + move/item/ability effects — @pkmn/ps'))));
}

// --- Go --------------------------------------------------------------------

boot();
