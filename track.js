// The track of the web app (drawings approved on 30/10/2026, docs/ruoli.md §8): a lane for each system, the health lane wider and last,
// the seven days around the lap. Monday starts on the line of the 400 m, at the end of the home straight, and the lap runs counter-clockwise.

export const CHANNELS = {
  ala: ['Alattacido', '#3987E5'], lat: ['Lattacido', '#D95926'], vo2: ['Intenso', '#B0488C'], sog: ['Soglia', '#A8B820'],
  aer: ['Aerobico', '#199E70'], for: ['Forza e salti', '#C98500'], tec: ['Tecnica', '#9085E9'],
};
export const HEALTH = '#E96B9A';
const DAYS = ['L', 'M', 'M', 'G', 'V', 'S', 'D'];
const TRACK = '#3B2A28', LINE = '#F2EEE8', INFIELD = '#1E6B46', INK = '#10141A';
const NS = 'http://www.w3.org/2000/svg';

export function el(name, attrs = {}, parent = null, text = null) {
  const e = document.createElementNS(NS, name);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (text != null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

function shape(lanes, health) {
  const A = 150, R0 = 70, LW = 24, WIDE = health ? 42 : 0;
  const RI = R0 + lanes * LW, RO = RI + WIDE, W = 2 * (A + RO + 46), H = 2 * (RO + 46), CX = W / 2, CY = H / 2;
  const RREF = R0 + (RO - R0) / 2, PREF = 4 * A + 2 * Math.PI * RREF, START = 0.035, SPAN = (1 - START) / 7, T0 = 2 * A / PREF;
  const pt = (r, t) => {
    let s = (((t % 1) + 1) % 1) * PREF;
    if (s < 2 * A) return [CX - A + s, CY + r];
    s -= 2 * A;
    const c = Math.PI * RREF;
    if (s < c) { const q = s / RREF; return [CX + A + r * Math.sin(q), CY + r * Math.cos(q)]; }
    s -= c;
    if (s < 2 * A) return [CX + A - s, CY - r];
    s -= 2 * A;
    const q = s / RREF;
    return [CX - A - r * Math.sin(q), CY - r * Math.cos(q)];
  };
  const arc = (r, a, b, n = 48) => 'M' + Array.from({ length: n + 1 }, (_, i) => pt(r, a + (b - a) * i / n).map(v => v.toFixed(1)).join(' ')).join(' L');
  const band = (r0, r1, a, b, n = 48) => {
    const p = [];
    for (let i = 0; i <= n; i++) p.push(pt(r1, a + (b - a) * i / n));
    for (let i = 0; i <= n; i++) p.push(pt(r0, b - (b - a) * i / n));
    return 'M' + p.map(q => q.map(v => v.toFixed(1)).join(' ')).join(' L') + 'Z';
  };
  return { A, R0, LW, WIDE, RI, RO, W, H, CX, CY, START, SPAN, T0, pt, arc, band, day: d => T0 + d * SPAN };
}

export function face(parent, x, y, r, level) {
  const m = { 4: 0.62, 3: 0.30, 2: 0, 1: -0.42 }[level] ?? 0, w = r * 0.52, my = y + r * 0.34 - m * r * 0.25;
  el('circle', { cx: x, cy: y, r, fill: HEALTH }, parent);
  for (const e of [-1, 1]) el('circle', { cx: x + e * r * 0.36, cy: y - r * 0.22, r: r * 0.11, fill: INK }, parent);
  el('path', { d: `M${x - w} ${my} Q${x} ${my + m * r * 0.95} ${x + w} ${my}`, fill: 'none', stroke: INK, 'stroke-width': Math.max(1.6, r * 0.13), 'stroke-linecap': 'round' }, parent);
}

function segment(g, s, svg, key, k, d, state) {
  const p = s.band(s.R0 + s.LW * k + 3, s.R0 + s.LW * (k + 1) - 3, s.day(d) + 0.004, s.day(d + 1) - 0.004), c = CHANNELS[key][1];
  if (state === 'p') el('path', { d: p, fill: c, 'fill-opacity': 0.5 }, g);
  else if (state === 'x') el('path', { d: p, fill: INK, 'fill-opacity': 0.55, stroke: '#8B939D', 'stroke-width': 2 }, g);
  else if (state === 'm') el('path', { d: p, fill: `url(#st-${key})`, stroke: c, 'stroke-width': 2 }, g);
  else el('path', { d: p, fill: c }, g);
}

/**
 * [lanes] the keys of the systems shown, [days] seven: { lanes: {key: state}, mood, pain, ask, race, visit, away, label }, with state d done, p
 * planned, m changed, x not done. [today], [sel]: index of the day or null. [center]: two lines. [onDay]: the sector touched.
 */
export function drawTrack({ lanes, days, today, sel, center, health, onDay }) {
  const s = shape(lanes.length, health);
  const svg = el('svg', { viewBox: `0 0 ${s.W} ${s.H}`, class: 'track', role: 'group', 'aria-label': 'La settimana sulla pista' });
  const defs = el('defs', {}, svg);
  for (const key of lanes) {
    const p = el('pattern', { id: `st-${key}`, patternUnits: 'userSpaceOnUse', width: 9, height: 9, patternTransform: 'rotate(45)' }, defs);
    el('rect', { width: 9, height: 9, fill: TRACK }, p);
    el('rect', { width: 5, height: 9, fill: CHANNELS[key][1] }, p);
  }
  const ab = el('pattern', { id: 'away', patternUnits: 'userSpaceOnUse', width: 14, height: 14, patternTransform: 'rotate(45)' }, defs);
  el('rect', { width: 14, height: 14, fill: '#2A313B' }, ab);
  el('rect', { width: 7, height: 14, fill: '#5B6573' }, ab);

  el('path', { d: s.band(s.R0, s.RO, 0, 0.9999, 120), fill: TRACK }, svg);
  el('path', { d: s.arc(s.R0 - 1, 0, 0.9999, 120) + 'Z', fill: INFIELD, stroke: LINE, 'stroke-width': 2 }, svg);
  days.forEach((d, i) => { if (d.race) el('path', { d: s.band(s.R0, s.RO, s.day(i), s.day(i + 1)), fill: '#FF9900', 'fill-opacity': 0.3 }, svg); });
  if (sel != null) el('path', { d: s.band(s.R0, s.RO, s.day(sel), s.day(sel + 1)), fill: '#fff', 'fill-opacity': 0.22 }, svg);
  const rings = lanes.map((_, i) => s.R0 + s.LW * (i + 1));
  if (health) rings.push(s.RO);
  for (const r of rings) el('path', { d: s.arc(r, 0, 0.9999, 120) + 'Z', fill: 'none', stroke: LINE, 'stroke-opacity': 0.45, 'stroke-width': 1 }, svg);

  const mid = (s.RI + s.RO) / 2;
  days.forEach((d, i) => {
    lanes.forEach((key, k) => { if (d.lanes[key]) segment(svg, s, svg, key, k, i, d.lanes[key]); });
    const c = s.day(i) + s.SPAN / 2;
    if (health && d.mood) {
      const [x, y] = s.pt(mid, c);
      face(svg, x, y, s.WIDE / 2 - 3, d.mood);
      if (d.pain) { const [a, b] = s.pt(mid, c + s.SPAN * 0.3); el('text', { x: a, y: b + 7, 'text-anchor': 'middle', fill: '#fff', 'font-size': 22, 'font-weight': 700 }, svg, '+'); }
    } else if (health && d.ask) {
      const [x, y] = s.pt(mid, c);
      el('path', { d: s.band(s.RI + 3, s.RO - 3, s.day(i) + 0.004, s.day(i + 1) - 0.004), fill: 'none', stroke: '#fff', 'stroke-width': 2.5, 'stroke-dasharray': '7 5' }, svg);
      el('text', { x, y: y + 8, 'text-anchor': 'middle', fill: '#fff', 'font-size': 23, 'font-weight': 600 }, svg, '?');
    }
    if (d.away) el('path', { d: s.band(s.R0, s.RO, s.day(i), s.day(i + 1)), fill: 'url(#away)', 'fill-opacity': 0.92 }, svg);
    if (d.race) {
      const [x, y] = s.pt(s.R0 + 2.5 * s.LW, c);
      el('path', { transform: `translate(${x - 20} ${y - 26}) scale(1.9)`, d: 'M6 22V3h13l-3 4.5 3 4.5H6', fill: '#FF9900', stroke: '#FF9900', 'stroke-width': 2, 'stroke-linejoin': 'round' }, svg);
    }
    if (d.visit) {
      const [x, y] = s.pt(s.RO - 14, c);
      el('circle', { cx: x, cy: y, r: 13, fill: '#fff' }, svg);
      el('text', { x, y: y + 8, 'text-anchor': 'middle', fill: INK, 'font-size': 22, 'font-weight': 700 }, svg, '+');
    }
  });
  for (let d = 0; d < 8; d++) {
    const [a, b] = s.pt(s.R0 - 1, s.day(d)), [c, e] = s.pt(s.RO + 1, s.day(d));
    el('line', { x1: a, y1: b, x2: c, y2: e, stroke: LINE, 'stroke-width': 1.5 }, svg);
  }
  if (sel != null) el('path', { d: s.band(s.R0, s.RO, s.day(sel), s.day(sel + 1)), fill: 'none', stroke: '#fff', 'stroke-width': 3.5 }, svg);
  const [a, b] = s.pt(s.R0 - 1, s.T0), [c, e] = s.pt(s.RO + 1, s.T0);
  el('line', { x1: a, y1: b, x2: c, y2: e, stroke: LINE, 'stroke-width': 3.5 }, svg);
  [...lanes.map((_, i) => s.R0 + s.LW * i + s.LW / 2), ...(health ? [mid] : [])].forEach((r, k) => {
    const [x, y] = s.pt(r, s.T0 - s.START / 2);
    el('text', { x, y: y + 6, 'text-anchor': 'middle', fill: LINE, 'font-size': 16, 'font-weight': 500 }, svg, k + 1);
  });
  days.forEach((d, i) => {
    const [x, y] = s.pt(s.RO + 22, s.day(i) + s.SPAN / 2);
    if (i === today) {
      el('circle', { cx: x, cy: y, r: 19, fill: '#FF9900' }, svg);
      el('text', { x, y: y + 8, 'text-anchor': 'middle', fill: '#2B1A00', 'font-size': 23, 'font-weight': 600 }, svg, DAYS[i]);
    } else el('text', { x, y: y + 8, 'text-anchor': 'middle', fill: i === sel ? '#fff' : '#D5DAE0', 'font-size': 23, 'font-weight': i === sel ? 600 : 400 }, svg, DAYS[i]);
  });
  el('text', { x: s.CX, y: s.CY - 10, 'text-anchor': 'middle', fill: '#fff', 'font-size': 23 }, svg, center[0]);
  el('text', { x: s.CX, y: s.CY + 28, 'text-anchor': 'middle', fill: '#fff', 'font-size': center[1].length > 16 ? 25 : 31, 'font-weight': 600 }, svg, center[1]);
  // the sector is what you touch, a lane would be too thin: the whole day, up to its letter
  days.forEach((d, i) => {
    const hit = el('path', { d: s.band(s.R0, s.RO + 44, s.day(i), s.day(i + 1)), fill: 'transparent', class: 'hit', role: 'button', tabindex: 0, 'aria-label': d.label }, svg);
    hit.addEventListener('click', () => onDay(i));
    hit.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onDay(i); } });
  });
  return svg;
}

/** The week done, on Sunday: each lane fills with the sessions of that system. [share]: {key: [done, all]}. */
export function drawRings({ lanes, share, center, health, healthShare }) {
  const s = shape(lanes.length, health);
  const svg = el('svg', { viewBox: `0 0 ${s.W} ${s.H}`, class: 'track', role: 'img', 'aria-label': 'Avanzamento della settimana per sistema' });
  el('path', { d: s.band(s.R0, s.RO, 0, 0.9999, 120), fill: TRACK }, svg);
  el('path', { d: s.arc(s.R0 - 1, 0, 0.9999, 120) + 'Z', fill: INFIELD, stroke: LINE, 'stroke-width': 2 }, svg);
  const fill = (r0, r1, c, v) => {
    el('path', { d: s.band(r0, r1, s.T0, s.T0 + 1 - s.START, 120), fill: c, 'fill-opacity': 0.22 }, svg);
    if (v > 0) el('path', { d: s.band(r0, r1, s.T0, s.T0 + (1 - s.START) * v, 120), fill: c }, svg);
  };
  lanes.forEach((key, k) => {
    const [n, t] = share[key] || [0, 0];
    fill(s.R0 + s.LW * k + 3, s.R0 + s.LW * (k + 1) - 3, CHANNELS[key][1], t ? n / t : 0);
  });
  if (health) fill(s.RI + 3, s.RO - 3, HEALTH, healthShare);
  const [a, b] = s.pt(s.R0 - 1, s.T0), [c, e] = s.pt(s.RO + 1, s.T0);
  el('line', { x1: a, y1: b, x2: c, y2: e, stroke: LINE, 'stroke-width': 3.5 }, svg);
  el('text', { x: s.CX, y: s.CY + 6, 'text-anchor': 'middle', fill: '#fff', 'font-size': 40, 'font-weight': 500 }, svg, center[0]);
  el('text', { x: s.CX, y: s.CY + 34, 'text-anchor': 'middle', fill: '#fff', 'font-size': 17 }, svg, center[1]);
  return svg;
}
