// render.js — DOM widget layer for the Champions portal.
//
// Pure view helpers: every dynamic string reaches the DOM through textContent
// or createTextNode (via `el`), never innerHTML, so local data can't inject
// markup. No data fetching happens here.

// --- Core element builder -------------------------------------------------

/**
 * Create an element. Props are applied safely: `text` sets textContent,
 * `on*` adds listeners, `dataset`/`style` take objects, everything else is a
 * plain attribute. Children may be nodes, strings (escaped as text nodes),
 * arrays, or null/false (skipped). There is deliberately no innerHTML path.
 */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (v === true) node.setAttribute(k, '');
    else if (v !== false) node.setAttribute(k, String(v));
  }
  appendChildren(node, children);
  return node;
}

function appendChildren(node, children) {
  for (const child of children) {
    if (child == null || child === false) continue;
    if (Array.isArray(child)) { appendChildren(node, child); continue; }
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

// --- Type colours ---------------------------------------------------------

export const TYPE_COLORS = {
  Normal: '#A8A77A', Fire: '#EE8130', Water: '#6390F0', Electric: '#F7D02C',
  Grass: '#7AC74C', Ice: '#96D9D6', Fighting: '#C22E28', Poison: '#A33EA1',
  Ground: '#E2BF65', Flying: '#A98FF3', Psychic: '#F95587', Bug: '#A6B91A',
  Rock: '#B6A136', Ghost: '#735797', Dragon: '#6F35FC', Dark: '#705746',
  Steel: '#B7B7CE', Fairy: '#D685AD',
};

/** Pick black or white text for a background hex, by relative luminance. */
export function labelColor(hex) {
  const c = hex.replace('#', '');
  const r = parseInt(c.slice(0, 2), 16) / 255;
  const g = parseInt(c.slice(2, 4), 16) / 255;
  const b = parseInt(c.slice(4, 6), 16) / 255;
  const lin = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const lum = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return lum > 0.45 ? '#0b0b0b' : '#ffffff';
}

// The game's own type badges, hotlinked at runtime like the sprite art (same
// host, same no-download policy). Rendered as an <img> with the classic
// coloured text pill as an instant, offline-safe fallback via onerror.
const TYPE_ICON_BASE = 'https://championsbattledata.com/pokemon_champions_assets/types';

/**
 * A type badge: the official Champions type icon (hotlinked) with the classic
 * coloured text pill as an instant fallback when the image can't load
 * (offline / missing). `extra` (e.g. a "×2" multiplier on matchup chips) shows
 * beside the icon and is preserved in the fallback text.
 */
export function typeBadge(type, extra) {
  const bg = TYPE_COLORS[type] || '#888';
  const img = el('img', {
    class: 'type-icon',
    src: `${TYPE_ICON_BASE}/${encodeURIComponent(type)}.png`,
    alt: type,
    loading: 'lazy',
  });
  // Children via `el` (not native append) so a null `extra` is skipped, not
  // stringified to a "null" text node.
  const badge = el('span', { class: 'type-badge' },
    img, extra ? el('span', { class: 'type-extra', text: ` ${extra}` }) : null);

  // Fallback: the original coloured pill, type NAME (+ extra) shown as text.
  img.addEventListener('error', () => {
    clear(badge);
    badge.classList.add('type-badge-text');
    Object.assign(badge.style, { background: bg, color: labelColor(bg) });
    badge.append(type + (extra ? ` ${extra}` : ''));
  });
  return badge;
}

// --- Sprites (hotlinked, offline-safe) ------------------------------------

const STAT_INITIAL = (name) => (name ? name.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() : '?');

/** A type-coloured monogram tile shown when a sprite is missing/offline. */
export function monogram(name, types, size) {
  const type = (types && types[0]) || 'Normal';
  const bg = TYPE_COLORS[type] || '#888';
  return el('span', {
    class: 'monogram',
    style: {
      width: `${size}px`, height: `${size}px`,
      background: bg, color: labelColor(bg),
      fontSize: `${Math.max(9, Math.round(size / 3.2))}px`,
    },
    title: name || '',
  }, STAT_INITIAL(name));
}

/**
 * A lazily-loaded sprite. On error (offline / missing art) it hides itself and
 * swaps in a monogram, so the portal stays usable without network access.
 */
export function sprite(imageUrl, name, types, size) {
  const wrap = el('span', { class: 'sprite', style: { width: `${size}px`, height: `${size}px` } });
  if (!imageUrl) { wrap.append(monogram(name, types, size)); return wrap; }
  const img = el('img', {
    src: imageUrl, alt: name || '', width: size, height: size, loading: 'lazy',
  });
  img.addEventListener('error', () => {
    img.remove();
    if (!wrap.querySelector('.monogram')) wrap.append(monogram(name, types, size));
  });
  wrap.append(img);
  return wrap;
}

// --- Tooltips (single shared, absolutely-positioned div) ------------------

let tipEl = null;

export function initTooltips() {
  if (tipEl) return;
  tipEl = el('div', { class: 'tooltip', role: 'tooltip' });
  tipEl.style.display = 'none';
  document.body.append(tipEl);
  document.addEventListener('pointerover', (e) => {
    const host = e.target.closest('[data-tip]');
    if (!host || !host.dataset.tip) return;
    tipEl.textContent = host.dataset.tip;
    tipEl.style.display = 'block';
    positionTip(host);
  });
  document.addEventListener('pointerout', (e) => {
    if (e.target.closest('[data-tip]')) tipEl.style.display = 'none';
  });
  document.addEventListener('scroll', () => { if (tipEl) tipEl.style.display = 'none'; }, true);
}

function positionTip(host) {
  const r = host.getBoundingClientRect();
  const tr = tipEl.getBoundingClientRect();
  let left = r.left + r.width / 2 - tr.width / 2;
  left = Math.max(6, Math.min(left, window.innerWidth - tr.width - 6));
  let top = r.top - tr.height - 8;
  if (top < 6) top = r.bottom + 8;
  tipEl.style.left = `${left + window.scrollX}px`;
  tipEl.style.top = `${top + window.scrollY}px`;
}

/** Mark a node as carrying a tooltip (empty text is ignored). */
export function tip(node, text) {
  if (text) node.dataset.tip = text;
  return node;
}

// --- Stat bars ------------------------------------------------------------

const RAMP_VARS = ['--ramp-0', '--ramp-1', '--ramp-2', '--ramp-3'];

function readRamp() {
  const cs = getComputedStyle(document.documentElement);
  const stops = RAMP_VARS.map((v) => cs.getPropertyValue(v).trim() || '#3987e5');
  return stops;
}

function lerpHex(a, b, t) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  const p = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return `#${p.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Map a 0..max magnitude onto the sequential blue ramp (floor = lightest). */
export function rampColor(value, max, stops) {
  const ramp = stops || readRamp();
  const f = Math.max(0, Math.min(1, (value || 0) / (max || 255)));
  const seg = f * (ramp.length - 1);
  const i = Math.min(ramp.length - 2, Math.floor(seg));
  return lerpHex(ramp[i], ramp[i + 1], seg - i);
}

const STAT_ROWS = [
  ['hp', 'HP'], ['atk', 'Atk'], ['def', 'Def'],
  ['spa', 'SpA'], ['spd', 'SpD'], ['spe', 'Spe'],
];

/** The six plain base-stat bars (0-255 domain) plus a BST total row.
 *  (Nature/Lv50 math lives in the detail page's Stat Alignment panel now.) */
export function statBars(stats) {
  const stops = readRamp();
  const rows = STAT_ROWS.map(([key, label]) => {
    const value = stats[key] ?? 0;
    const fill = el('span', {
      class: 'stat-fill',
      style: { width: `${Math.min(100, (value / 255) * 100)}%`, background: rampColor(value, 255, stops) },
    });
    const row = el('div', { class: 'stat-row' },
      el('span', { class: 'stat-label', text: label }),
      el('span', { class: 'stat-track' }, fill),
      el('span', { class: 'stat-num tnum', text: String(value) }),
    );
    tip(row, `Base ${label}: ${value}`);
    return row;
  });
  const bst = Object.values(stats).reduce((a, v) => a + (Number(v) || 0), 0);
  rows.push(el('div', { class: 'stat-row stat-total' },
    el('span', { class: 'stat-label', text: 'BST' }),
    el('span', { class: 'stat-track' }),
    el('span', { class: 'stat-num tnum', text: String(bst) }),
  ));
  return el('div', { class: 'stat-bars' }, rows);
}

// --- Usage meter row ------------------------------------------------------

/**
 * One "name + thin meter + % label" row for a usage list. `series` is 1 (Smogon
 * blue) or 2 (in-game aqua). `pct` may be null (raw-weights mode).
 */
export function meterRow(nameNode, pct, series, tipText, rawLabel, valueText) {
  const width = typeof pct === 'number' ? Math.min(100, pct) : 0;
  const fill = el('span', {
    class: `meter-fill series-${series}`,
    style: { width: `${width}%` },
  });
  // valueText overrides the displayed value when the bar width is a relative
  // scale rather than a true percentage (e.g. the Trends lists).
  const valText = valueText ?? (typeof pct === 'number'
    ? `${pct.toFixed(1)}%`
    : (rawLabel || '—'));
  const row = el('div', { class: 'meter-row' },
    el('span', { class: 'meter-name' }, nameNode),
    el('span', { class: 'meter-track' }, fill),
    el('span', { class: 'meter-val tnum', text: valText }),
  );
  tip(row, tipText);
  return row;
}

// --- Sortable table -------------------------------------------------------

/**
 * Build a sortable table. `columns` is an array of
 *   { key, label, numeric?, tip?, cell(row)->node|string, sortVal(row) }.
 * Missing/undefined sort values always sink to the bottom regardless of dir.
 * `onRowClick(row)` makes rows navigable.
 */
export function sortableTable(columns, rows, opts = {}) {
  const state = {
    key: opts.sortKey || columns[0].key,
    dir: opts.sortDir || 'desc',
  };
  const table = el('table', { class: `data-table ${opts.className || ''}` });
  const thead = el('thead');
  const headRow = el('tr');
  const tbody = el('tbody');

  const sortValue = (col, row) => (col.sortVal ? col.sortVal(row) : row[col.key]);

  function renderBody() {
    const col = columns.find((c) => c.key === state.key) || columns[0];
    const sorted = rows.slice().sort((a, b) => {
      const av = sortValue(col, a);
      const bv = sortValue(col, b);
      const aMiss = av == null || av === '' || Number.isNaN(av);
      const bMiss = bv == null || bv === '' || Number.isNaN(bv);
      if (aMiss && bMiss) return 0;
      if (aMiss) return 1;   // missing always last
      if (bMiss) return -1;
      let cmp;
      if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
      else cmp = String(av).localeCompare(String(bv));
      return state.dir === 'asc' ? cmp : -cmp;
    });
    clear(tbody);
    sorted.forEach((row, i) => {
      const tr = el('tr');
      if (opts.onRowClick) {
        tr.classList.add('clickable');
        tr.addEventListener('click', () => opts.onRowClick(row));
      }
      columns.forEach((c) => {
        const content = c.cell ? c.cell(row, i) : row[c.key];
        const td = el('td', {
          class: `${c.numeric ? 'tnum' : ''}${c.key === state.key ? ' sorted-col' : ''}`.trim(),
        });
        if (content != null) td.append(content.nodeType ? content : document.createTextNode(String(content)));
        tr.append(td);
      });
      tbody.append(tr);
    });
  }

  columns.forEach((c) => {
    const th = el('th', {
      class: `${c.numeric ? 'tnum' : ''} ${c.key === state.key ? `sorted-${state.dir}` : ''}`,
    }, c.label);
    if (c.tip) tip(th, c.tip);
    th.addEventListener('click', () => {
      if (state.key === c.key) state.dir = state.dir === 'asc' ? 'desc' : 'asc';
      else { state.key = c.key; state.dir = c.numeric ? 'desc' : 'asc'; }
      headRow.querySelectorAll('th').forEach((h) => h.classList.remove('sorted-asc', 'sorted-desc'));
      th.classList.add(`sorted-${state.dir}`);
      renderBody();
      if (opts.onSort) opts.onSort(state.key, state.dir);
    });
    headRow.append(th);
  });

  thead.append(headRow);
  table.append(thead, tbody);
  renderBody();
  return table;
}

// --- Small shared bits ----------------------------------------------------

export const STAT_SHORT = { hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe' };

/** Render nature up/down arrows from stat keys (either may be null). */
export function natureArrowNodes(up, down) {
  const nodes = [];
  if (up) nodes.push(el('span', { class: 'nat-up' }, `▲${STAT_SHORT[up] || up}`));
  if (down) nodes.push(el('span', { class: 'nat-down' }, `▽${STAT_SHORT[down] || down}`));
  return nodes;
}

/** A section heading with an optional subtitle line. */
export function sectionTitle(title, subtitle) {
  return el('div', { class: 'section-head' },
    el('h2', { text: title }),
    subtitle ? el('p', { class: 'section-sub', text: subtitle }) : null,
  );
}
