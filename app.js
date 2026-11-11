// The web app of the athletes (drawings approved on 30/10/2026, docs/ruoli.md §6–§10). It computes nothing: it reads what the coach
// published and writes the athlete's own marks. Every text from the cloud goes on the page as text, never as markup.
import { Api, isOffline } from './api.js';
import { Demo } from './demo.js';
import { Store } from './store.js';
import { CHANNELS, HEALTH, drawTrack, drawRings, el, face } from './track.js';

const LANES = ['ala', 'lat', 'aer', 'for', 'tec'], ZONES = ['sog', 'vo2'];
const DAY_NAMES = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];
const REASONS = ['Ferie', 'Studio', 'Esami', 'Lavoro', 'Altro'];
const CHANGES = ['Meno ripetizioni', 'Meno intensità', 'Più recupero', 'Meno tempo', 'Altro lavoro'];
const LEVELS = {
  sleep_quality: ['Sonno', ['Male', 'Così così', 'Bene', 'Benissimo']], sleep_band: ['Ore dormite', ['Meno di 6', '6–7', '7–8', '8 o più']],
  fatigue: ['Fatica', ['Tanta', 'Abbastanza', 'Poca', 'Nessuna']], soreness: ['Dolori muscolari', ['Tanti', 'Abbastanza', 'Pochi', 'Nessuno']],
  stress: ['Stress', ['Tanto', 'Abbastanza', 'Poco', 'Nessuno']],
};

// ---------------------------------------------------------------- days, as ISO strings in the time of the team
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome' }).format(new Date());
const utc = iso => new Date(iso + 'T12:00:00Z');
const add = (iso, n) => new Date(utc(iso).getTime() + n * 864e5).toISOString().slice(0, 10);
const weekday = iso => (utc(iso).getUTCDay() + 6) % 7;
const mondayOf = iso => add(iso, -weekday(iso));
const fmt = (iso, o) => new Intl.DateTimeFormat('it-IT', { timeZone: 'UTC', ...o }).format(utc(iso));
const dayMonth = iso => fmt(iso, { day: 'numeric', month: 'long' });
const longDay = iso => `${DAY_NAMES[weekday(iso)]} ${dayMonth(iso)}`;
const short = iso => fmt(iso, { day: 'numeric', month: 'short' });
const isRace = e => /gara|campionat/i.test(e.type || '');
const isAway = e => /^assenza$/i.test((e.type || '').trim());
const isVisit = e => /visita/i.test(e.type || '');
const eventName = x => x.replace(/^(\d+)m$/, '$1 m').replace(/^(\d+)x(\d+)$/, '$1×$2');
const covers = (e, day) => e.start <= day && (e.end && e.end !== 'in corso' ? e.end : e.end === 'in corso' ? '9999' : e.start) >= day && (!e.days?.length || e.days.includes(weekday(day) + 1));

// ---------------------------------------------------------------- the page
function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else if (k === 'bg') e.style.background = v;
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  e.append(...kids.flat(Infinity).filter(x => x != null && x !== false));
  return e;
}
const root = document.getElementById('app');
const params = new URLSearchParams(location.search), demo = params.has('demo');
const api = demo ? new Demo(today(), params.get('demo') === 'login') : new Api();
const store = new Store(demo ? 'dok-demo' : 'dok');
const S = { tab: 'pista', monday: mondayOf(today()), sel: weekday(today()), weeks: new Map(), wellness: new Map(), messages: [], races: [], reports: null, cal: 'week', month: today().slice(0, 7), form: null, login: { step: 'welcome' },
  queue: [], at: {}, offline: false };
// the cloud refused the session: the copies go, the marks still to send wait for the same account
api.refused = () => { store.clearCopies(); S.ready = false; S.weeks.clear(); };

let toastTimer;
function toast(text) {
  document.querySelector('.toast')?.remove();
  const t = h('div', { class: 'toast', role: 'status' }, text);
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 3500);
}
async function run(work) {
  try { await work(); } catch (e) { toast(isOffline(e) ? "Senza rete: riprova quando c'è campo." : e.message); if (!api.signedIn) render(); }
}
function render() {
  const y = window.scrollY;
  root.replaceChildren(...screen());
  window.scrollTo(0, y);
}
const go = patch => { Object.assign(S, patch); render(); };

// ---------------------------------------------------------------- data: the cloud, and with no network the copy on the phone (§11)
/** The weeks kept on the phone: the last one, this one, the next one. */
const KEPT = () => { const m = mondayOf(today()); return [add(m, -7), m, add(m, 7)]; };
const SAVED = "Salvata sul telefono: parte appena c'è rete";

async function copy(key) {
  const c = await store.get(key);
  if (c) S.at[key] = c.at;
  return c?.data;
}
async function keep(key, data) { S.at[key] = Date.now(); await store.put(key, data); }

/** From the cloud, kept on the phone when [save]; with no network, the copy, if there is one. */
async function fresh(key, load, save = true) {
  let data;
  try { data = await load(); } catch (e) {
    if (!isOffline(e)) throw e;
    S.offline = true;
    const c = await copy(key);
    if (c === undefined) throw e;
    return c;
  }
  const was = S.offline;
  S.offline = false;
  if (save) await keep(key, data); else S.at[key] = Date.now();
  if (was && S.queue.length) setTimeout(() => run(async () => told(await sendQueue())));
  return data;
}

async function week(monday, force = false) {
  if (!force && S.weeks.has(monday)) return S.weeks.get(monday);
  const end = add(monday, 6);
  const c = await fresh(`week:${monday}`, async () => {
    const [w, ok] = await Promise.all([api.rpc('athlete_week', { p_from: monday, p_to: end }), S.me.health_ok ? api.wellness(monday, end) : []]);
    return { w, ok: ok || [] };
  }, KEPT().includes(monday)).catch(e => { throw isOffline(e) ? new Error('Questa settimana non è sul telefono: serve la rete.') : e; });
  S.weeks.set(monday, c.w);
  S.wellness.set(monday, c.ok);
  applyQueue();
  return c.w;
}
async function messages() { S.messages = await fresh('messages', () => api.rpc('athlete_messages')); applyQueue(); }

/** The copy first, so the app opens at once also with no network; then the cloud, the marks waiting and what to keep for later. */
async function start() {
  await sortStore();
  const me = await copy('me'), w = me && await copy(`week:${S.monday}`);
  if (w) {
    S.me = me; S.seat = await copy('seat');
    S.weeks.set(S.monday, w.w); S.wellness.set(S.monday, w.ok); S.messages = (await copy('messages')) || [];
    applyQueue(); S.ready = true; render();
  }
  try {
    const now = await api.rpc('athlete_me');
    // signed in but in no team yet: the code of the coach is still to come
    if (!now) { await store.clearCopies(); S.ready = false; S.outside = true; S.login.joining = true; S.login.step = 'invite'; render(); return; }
    S.me = now; await keep('me', now);
    S.seat = await api.seat(); await keep('seat', S.seat);
  } catch (e) {
    if (!isOffline(e)) throw e;
    S.offline = true; S.stuck = !S.ready; render();
    return;
  }
  S.offline = false; S.stuck = false;
  await Promise.all([week(S.monday, true), messages()]);
  S.ready = true;
  render();
  if (!demo) store.keepOn();
  told(await sendQueue());
  // what the athlete may want with no network later: the weeks around, the races, the last report
  Promise.allSettled([week(KEPT()[0], true), week(KEPT()[2], true), races(), lastReport()]);
}

/** The phone holds the copies of one account, and the weeks around today only. */
async function sortStore() {
  const id = api.userId, owner = await store.get('owner');
  if (owner && owner.data !== id) await store.clearCopies();
  await store.put('owner', id);
  for (const q of await store.queue()) if (q.user !== id) await store.remove(q.id); // someone else's: they cannot leave from this account
  S.queue = (await store.queue()).filter(q => q.user === id);
  for (const k of await store.keys()) if (k.startsWith('week:') && !KEPT().includes(k.slice(5))) await store.del(k);
}

/** The network is back, or the app is again in front: fresh data, then the marks waiting. */
async function resume() {
  if (!S.ready) return start();
  S.weeks.clear();
  await week(S.monday);
  await messages();
  render();
  told(await sendQueue());
}

// ---------------------------------------------------------------- the marks of the athlete, on the phone first (§11)
const uuid = () => crypto.randomUUID ? crypto.randomUUID() : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));

/** Kept on the phone, then sent with the ones before it. 'sent', or 'kept' when the network is missing or too slow to wait for (the
 * sending goes on behind); a no of the cloud is thrown. */
async function write(name, args) {
  const item = { name, args, at: new Date().toISOString(), user: api.userId };
  item.id = await store.add(item);
  S.queue.push(item);
  applyQueue();
  const going = sendQueue(), failed = await Promise.race([going, new Promise(ok => setTimeout(() => ok(null), 4000))]);
  if (!failed) { going.then(told); return 'kept'; }
  const mine = failed.find(f => f.item.id === item.id);
  told(failed.filter(f => f !== mine));
  if (mine) throw new Error(mine.message);
  return S.queue.some(q => q.id === item.id) ? 'kept' : 'sent';
}

let sending = null;
function sendQueue() { return sending ||= drain().finally(() => { sending = null; }); }

/** In order, until the network or the account stops it; a mark the cloud refuses is dropped, as it would refuse it again. */
async function drain() {
  const failed = [];
  let moved = false;
  for (const item of [...S.queue]) {
    try {
      try { await api.rpc(item.name, item.args); }
      catch (e) { if (e.status === 404 && item.args.p_at !== undefined) { const { p_at, ...old } = item.args; await api.rpc(item.name, old); } else throw e; }
      S.offline = false;
    } catch (e) {
      if (isOffline(e)) { S.offline = true; break; }
      if (!api.signedIn || !e.status || e.status === 401 || e.status >= 500) break;
      failed.push({ item, message: e.message });
    }
    await store.remove(item.id);
    S.queue = S.queue.filter(q => q.id !== item.id);
    moved = true;
  }
  if (moved) {
    S.weeks.clear();
    try { await week(S.monday); await messages(); } catch { /* the copy stays on screen */ }
    render();
  }
  return failed;
}

function told(failed) {
  if (failed.length) toast(`${failed.length === 1 ? 'Una segnatura non è partita' : `${failed.length} segnature non sono partite`}: ${failed[0].message}`);
}

/** What waits on the phone, drawn over what came from the cloud or from the copy. */
function applyQueue() {
  for (const { name, args: a } of S.queue) {
    if (name === 'athlete_mark') for (const w of S.weeks.values()) {
      const s = w.sessions.find(x => x.id === a.p_workout);
      if (s) Object.assign(s, { did: a.p_did, rpe: a.p_rpe, note: a.p_note, pending: true });
    }
    if (name === 'athlete_wellness') {
      const m = mondayOf(a.p_day), list = S.wellness.get(m);
      if (list) S.wellness.set(m, list.filter(x => x.day !== a.p_day).concat({ day: a.p_day, sleep_quality: a.p_sleep_quality, sleep_band: a.p_sleep_band, fatigue: a.p_fatigue,
        soreness: a.p_soreness, stress: a.p_stress, mood: a.p_mood, health: a.p_health, pending: true }));
    }
    if (name === 'athlete_absence') for (const [m, w] of S.weeks) {
      w.events = w.events.filter(e => e.id !== a.p_id);
      if (a.p_start <= add(m, 6) && (a.p_end || a.p_start) >= m) w.events.push({ id: a.p_id, title: a.p_reason, type: 'Assenza', start: a.p_start, end: a.p_end, place: null,
        days: a.p_days?.length ? a.p_days : null, mine: true, called_for: null, reserve_for: null, pending: true });
    }
    if (name === 'athlete_absence_remove') for (const w of S.weeks.values()) w.events = w.events.filter(e => e.id !== a.p_id);
    if (name === 'athlete_message_seen') { const m = S.messages.find(x => x.id === a.p_id); if (m) Object.assign(m, { seen: true, pending: true }); }
  }
}

// ---------------------------------------------------------------- the lanes
function lanesFor() {
  const used = new Set();
  for (const w of S.weeks.values()) for (const s of w.sessions) (s.view?.channels || []).forEach(c => used.add(c));
  return [...LANES.slice(0, 2), ...ZONES.filter(z => used.has(z)), ...LANES.slice(2)];
}
const stateOf = (s, day) => ({ DONE: 'd', PART: 'd', OTHER: 'm', ABSENT: 'x' }[s.did] || 'p');

function dayData(monday, i) {
  const day = add(monday, i), w = S.weeks.get(monday) || { sessions: [], events: [] }, lanes = {};
  for (const s of w.sessions.filter(x => x.date === day)) for (const c of s.view?.channels || []) lanes[c] = stateOf(s, day);
  const ev = w.events.filter(e => covers(e, day)), away = ev.find(isAway);
  const mood = (S.wellness.get(monday) || []).find(x => x.day === day);
  return { lanes, mood: mood?.mood, pain: (mood?.health || 0) > 0, ask: day === today() && !mood && !away, race: ev.some(isRace), visit: ev.some(isVisit), away: !!away, label: longDay(day) };
}

function legend(lanes) {
  const items = lanes.map((k, i) => h('span', {}, h('i', { bg: CHANNELS[k][1] }, String(i + 1)), CHANNELS[k][0].split(' ')[0]));
  if (S.me.health_ok) items.push(h('span', {}, h('i', { bg: HEALTH }, String(lanes.length + 1)), 'Salute'));
  return h('div', { class: 'legend' }, items);
}
const STATES = () => h('div', { class: 'states' }, [['s-d', 'fatta'], ['s-m', 'modificata'], ['s-x', 'non fatta'], ['s-p', 'programmata']].map(([c, t]) => h('span', {}, h('u', { class: c }), t)));

function weekBar() {
  const m = S.monday, now = mondayOf(today()), end = add(m, 6);
  const sub = m === now ? 'Questa settimana' : m === add(now, 7) ? 'Settimana prossima' : m === add(now, -7) ? 'Settimana scorsa' : null;
  const span = m.slice(5, 7) === end.slice(5, 7) ? `${fmt(m, { day: 'numeric' })} – ${dayMonth(end)}` : `${dayMonth(m)} – ${dayMonth(end)}`;
  const move = n => run(async () => { const next = add(S.monday, n); await week(next); go({ monday: next, form: null, sel: next === now ? weekday(today()) : 0 }); });
  return h('div', { class: 'week' },
    h('button', { class: 'arrow', 'aria-label': 'Settimana prima', onclick: () => move(-7) }, '‹'),
    h('div', {}, h('b', {}, span), h('small', {}, sub || ' ')),
    h('button', { class: 'arrow', 'aria-label': 'Settimana dopo', onclick: () => move(7) }, '›'));
}

// ---------------------------------------------------------------- Pista
function pista() {
  if (S.form?.what === 'wellness') return wellnessForm();
  if (S.form?.what === 'absence') return absenceForm();
  const monday = S.monday, day = add(monday, S.sel), lanes = lanesFor(), w = S.weeks.get(monday);
  const sessions = w.sessions.filter(s => s.date === day), ev = w.events.filter(e => covers(e, day));
  const days = Array.from({ length: 7 }, (_, i) => dayData(monday, i));
  const race = ev.find(isRace), away = ev.find(isAway);
  const center = [fmt(day, { weekday: 'short' }).replace(/^./, c => c.toUpperCase()) + ' ' + fmt(day, { day: 'numeric' }),
    away ? 'Assente' : race ? 'Gara' : sessions[0]?.title?.split(':')[0] || 'Riposo'];
  const fresh = S.messages.filter(m => !m.seen), first = fresh[0];
  return [
    weekBar(),
    first && h('button', { class: 'strip', onclick: () => go({ tab: 'coach' }) }, whistle(24),
      h('span', {}, h('small', {}, `Da ${first.from || 'Coach'}` + (fresh.length > 1 ? ` · ${fresh.length} nuovi` : '')), first.text.slice(0, 70)), h('b', {}, '›')),
    S.me.health_ok && days[weekday(today())]?.ask && monday === mondayOf(today()) &&
      h('button', { class: 'strip', onclick: () => go({ form: { what: 'wellness', a: {} } }) }, h('span', {}, h('small', {}, 'Mezzo minuto'), 'Come stai oggi?'), h('b', {}, '›')),
    drawTrack({ lanes, days, today: monday === mondayOf(today()) ? weekday(today()) : null, sel: S.sel, center, health: S.me.health_ok, onDay: i => go({ sel: i, form: null }) }),
    legend(lanes),
    ...dayDetail(day, sessions, ev),
  ];
}

function whistle(size) {
  const svg = el('svg', { viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': 'true' });
  el('path', { d: 'M3 9h11a6 6 0 1 1-6 7H6z', fill: '#FF9900' }, svg);
  el('path', { d: 'M14 9h7v3h-5', fill: '#FF9900' }, svg);
  el('circle', { cx: 13, cy: 15, r: 2, fill: '#10141A' }, svg);
  return svg;
}

function dayDetail(day, sessions, ev) {
  const out = [], now = today(), away = ev.find(isAway);
  if (away) out.push(absenceBox(away, day));
  for (const e of ev.filter(isRace)) out.push(raceBox(e));
  for (const e of ev.filter(x => isVisit(x))) out.push(h('div', { class: 'det' }, h('div', { class: 'title' }, e.title), h('small', {}, e.place)));
  for (const s of sessions) out.push(sessionBox(s, day, !!away));
  if (!sessions.length && !ev.length) out.push(h('div', { class: 'det' }, h('small', {}, longDay(day)), h('div', { class: 'title' }, 'Riposo')));
  if (day >= now && !away) out.push(h('button', { class: 'btn alt', onclick: () => go({ form: { what: 'absence', mode: 'day', start: day, end: day, days: [weekday(day) + 1], reason: 'Altro', note: '' } }) }, 'Non ci sarò'));
  return out;
}

function raceBox(e) {
  return h('div', { class: 'det' }, h('small', {}, [longDay(e.start), e.place].filter(Boolean).join(' · ')), h('div', { class: 'title' }, e.title), called(e),
    h('button', { class: 'link', onclick: () => go({ tab: 'gare' }) }, 'Apri la gara ›'));
}

function called(e) {
  if (e.called_for == null) return h('small', {}, 'Convocazione non ancora uscita');
  const main = e.called_for, res = e.reserve_for || [];
  if (!main.length && !res.length) return h('small', {}, 'Non sei tra i convocati');
  return h('div', {}, h('b', {}, 'Sei convocato'), h('div', {}, main.map(x => h('span', { class: 'chip', bg: '#FFE2B8' }, h('span', { class: 'ink' }, eventName(x)))), res.map(x => h('span', { class: 'chip', bg: '#3D4653' }, `${eventName(x)} · riserva`))));
}

function stops(view) {
  const list = view.stops.map((st, i) => h('div', { class: 'stop' }, h('em', { bg: CHANNELS[st.channel]?.[1] || '#7D8590' }, String(i + 1)),
    h('div', {}, h('b', {}, st.title), st.detail && h('small', {}, st.detail),
      st.squares?.length ? h('div', { class: 'squares' }, st.squares.map(c => h('i', { bg: CHANNELS[c]?.[1] || '#7D8590' }))) : null)));
  list.push(h('div', { class: 'stop' }, h('em', { class: 'finish' }), h('div', {}, h('b', {}, 'Arrivo'))));
  return h('div', { class: 'stops' }, list);
}

const DID = { DONE: 'Fatta', PART: 'Fatta in parte', ABSENT: 'Non fatta', OTHER: 'Modificata' };

function sessionBox(s, day, away) {
  const note = S.messages.find(m => m.kind === 'SESSION' && m.workout === s.id), f = S.form?.id === s.id ? S.form : null, past = day <= today();
  return h('div', { class: 'det' },
    h('small', {}, longDay(day) + (day > today() ? ' · programmata' : '')), h('div', { class: 'title' }, s.title || 'Seduta'),
    (s.view?.channels || []).map(c => h('span', { class: 'chip', bg: CHANNELS[c]?.[1] }, CHANNELS[c]?.[0])),
    note && h('div', { class: 'note' }, whistle(20), h('div', {}, h('small', {}, `Da ${note.from || 'Coach'}`), note.text)),
    s.view?.note && h('p', {}, s.view.note),
    s.view?.stops?.length ? stops(s.view) : h('div', { class: 'text' }, s.text),
    f ? markForm(s, f) : past && !away ? markBox(s) : null);
}

function markBox(s) {
  if (s.by_coach) return h('p', {}, h('b', {}, `${DID[s.did] || 'Segnata'}`), h('small', {}, ' · dal coach') );
  if (s.did) return h('div', {}, h('p', {}, h('b', {}, DID[s.did]), s.rpe ? ` · sforzo ${s.rpe} su 10` : ''), s.pending && pend(), s.note && h('div', { class: 'text' }, s.note),
    h('div', { class: 'row' }, h('button', { class: 'link', onclick: () => go({ form: { id: s.id, did: s.did, rpe: s.rpe, note: s.note || '', picks: [] } }) }, 'Cambia ›')));
  const open = did => go({ form: { id: s.id, did, rpe: null, note: '', picks: [] } });
  return h('div', { class: 'btns' }, h('button', { class: 'btn main', onclick: () => open('DONE') }, 'Fatta'), h('button', { class: 'btn alt', onclick: () => open('OTHER') }, 'Modificata'),
    h('button', { class: 'btn quiet', onclick: () => saveMark(s.id, 'ABSENT', null, null) }, 'Non fatta'));
}

function saveMark(id, did, rpe, note) {
  return run(async () => {
    const how = await write('athlete_mark', { p_workout: id, p_did: did, p_rpe: rpe, p_note: note, p_at: new Date().toISOString() });
    S.form = null; render(); toast(how === 'sent' ? 'Segnata: la vede il coach' : SAVED);
  });
}

function markForm(s, f) {
  const change = f.did === 'OTHER', text = [...f.picks, f.note.trim()].filter(Boolean).join(': ');
  const ok = !change || !!text;
  return h('div', {},
    change && h('label', { class: 'q' }, 'Cosa hai cambiato?'),
    change && h('div', { class: 'picks' }, CHANGES.map(c => h('button', { class: 'pick' + (f.picks.includes(c) ? ' on' : ''), onclick: () => { f.picks = f.picks.includes(c) ? f.picks.filter(x => x !== c) : [...f.picks, c]; render(); } }, c))),
    change && h('input', { value: f.note, maxlength: 300, placeholder: 'Scrivilo qui, se vuoi', 'aria-label': 'Cosa hai cambiato', oninput: e => { f.note = e.target.value; } , onchange: render }),
    h('label', { class: 'q' }, 'Quanto è stata dura?'),
    h('div', { class: 'scale' }, Array.from({ length: 10 }, (_, i) => h('button', { class: f.rpe === i + 1 ? 'on' : '', onclick: () => { f.rpe = i + 1; render(); } }, String(i + 1)))),
    h('div', { class: 'row' }),
    h('button', { class: 'btn main', disabled: !ok, onclick: () => saveMark(s.id, f.did, f.rpe, change ? text : null) }, 'Salva'),
    h('div', { class: 'row' }, h('button', { class: 'link', onclick: () => go({ form: null }) }, 'Annulla')));
}

// ---------------------------------------------------------------- absences
function absenceBox(e, day) {
  const days = e.days?.map(d => DAY_NAMES[d - 1].toLowerCase()).join(', ');
  const when = days ? `Ogni ${days} fino al ${dayMonth(e.end)}` : e.end && e.end !== e.start ? `Dal ${dayMonth(e.start)} al ${dayMonth(e.end)}` : longDay(e.start);
  return h('div', { class: 'det' }, h('small', {}, longDay(day)), h('div', { class: 'title' }, `Assente: ${e.title.toLowerCase()}`), h('div', { class: 'text' }, when),
    e.pending && pend(),
    e.mine ? h('div', { class: 'row' },
      h('button', { class: 'link', onclick: () => go({ tab: 'pista', form: { what: 'absence', id: e.id, mode: e.days ? 'week' : e.end && e.end !== e.start ? 'span' : 'day', start: e.start, end: e.end || e.start, days: e.days || [weekday(e.start) + 1], reason: e.title, note: '' } }) }, 'Cambia ›'),
      h('button', { class: 'link', onclick: () => run(async () => { const how = await write('athlete_absence_remove', { p_id: e.id }); render(); toast(how === 'sent' ? 'Assenza tolta' : SAVED); }) }, 'Togli ›'))
      : h('p', {}, h('small', {}, 'Per cambiarla parla con il coach.')));
}

function absenceCount(f) {
  if (f.mode !== 'week' || !f.start || !f.end || f.end < f.start) return null;
  let n = 0;
  for (let d = f.start; d <= f.end; d = add(d, 1)) if (f.days.includes(weekday(d) + 1)) n++;
  return `${n} ${n === 1 ? 'giorno' : 'giorni'}`;
}

function absenceForm() {
  const f = S.form, min = add(today(), -7);
  const ok = f.start >= min && (f.mode === 'day' || (f.end && f.end >= f.start)) && (f.mode !== 'week' || f.days.length > 0);
  const set = patch => { Object.assign(f, patch); render(); };
  const save = () => run(async () => {
    // the id made here: sent twice with no answer in between, it stays one absence
    const how = await write('athlete_absence', { p_id: f.id || uuid(), p_start: f.start, p_end: f.mode === 'day' ? null : f.end, p_days: f.mode === 'week' ? f.days : null, p_reason: f.reason, p_note: f.note.trim() || null });
    S.form = null; render(); toast(how === 'sent' ? 'Il coach la vede in Dok' : SAVED);
  });
  return [
    h('button', { class: 'link', onclick: () => go({ form: null }) }, '‹ Annulla'), h('h1', {}, "Segna un'assenza"),
    h('div', { class: 'seg' }, [['day', 'Un giorno'], ['span', 'Periodo'], ['week', 'Ogni settimana']].map(([m, t]) => h('button', { class: f.mode === m ? 'on' : '', onclick: () => set({ mode: m }) }, t))),
    f.mode === 'week' && h('label', { class: 'q' }, 'Quali giorni'),
    f.mode === 'week' && h('div', { class: 'wd' }, ['L', 'M', 'M', 'G', 'V', 'S', 'D'].map((t, i) => h('button', { class: f.days.includes(i + 1) ? 'on' : '', 'aria-label': DAY_NAMES[i], onclick: () => set({ days: f.days.includes(i + 1) ? f.days.filter(d => d !== i + 1) : [...f.days, i + 1].sort() }) }, t))),
    h('div', { class: f.mode === 'day' ? '' : 'two' },
      h('div', {}, h('label', { class: 'q' }, f.mode === 'day' ? 'Giorno' : 'Dal'), h('input', { type: 'date', value: f.start, min, onchange: e => set({ start: e.target.value }) })),
      f.mode !== 'day' && h('div', {}, h('label', { class: 'q' }, 'Fino al'), h('input', { type: 'date', value: f.end, min: f.start, onchange: e => set({ end: e.target.value }) }))),
    h('label', { class: 'q' }, 'Motivo'), h('div', { class: 'picks' }, REASONS.map(r => h('button', { class: 'pick' + (f.reason === r ? ' on' : ''), onclick: () => set({ reason: r }) }, r))),
    h('label', { class: 'q' }, 'Nota per il coach, se vuoi'), h('input', { value: f.note, maxlength: 300, oninput: e => { f.note = e.target.value; } }),
    absenceCount(f) && h('p', { class: 'sm' }, absenceCount(f)),
    h('div', { class: 'row' }), h('button', { class: 'btn main', disabled: !ok, onclick: save }, 'Salva'), h('p', { class: 'sm' }, 'Il coach la vede subito in Dok. Per malattia o infortunio usa «Come stai».'),
  ];
}

// ---------------------------------------------------------------- Come stai
function wellnessForm() {
  const a = S.form.a, done = Object.keys(LEVELS).every(k => a[k]) && a.mood && a.health != null;
  const set = (k, v) => { a[k] = v; render(); };
  const face4 = v => { const s = el('svg', { viewBox: '0 0 60 60', width: '100%', 'aria-hidden': 'true' }); face(s, 30, 30, 26, v); return s; };
  const save = () => run(async () => {
    const how = await write('athlete_wellness', { p_day: today(), p_sleep_quality: a.sleep_quality, p_sleep_band: a.sleep_band, p_fatigue: a.fatigue, p_soreness: a.soreness, p_stress: a.stress, p_mood: a.mood, p_health: a.health });
    S.form = null; render(); toast(how === 'sent' ? 'Grazie! La tua faccina è sulla pista' : SAVED);
  });
  return [
    h('button', { class: 'link', onclick: () => go({ form: null }) }, '‹ Annulla'), h('h1', {}, 'Come stai?'),
    h('label', { class: 'q' }, 'Umore'), h('div', { class: 'faces' }, [1, 2, 3, 4].map(v => h('button', { class: a.mood === v ? 'on' : '', 'aria-label': `Umore ${v} su 4`, onclick: () => set('mood', v) }, face4(v)))),
    Object.entries(LEVELS).map(([k, [label, words]]) => [h('label', { class: 'q' }, label),
      h('div', { class: 'picks' }, words.map((w, i) => h('button', { class: 'pick' + (a[k] === i + 1 ? ' on' : ''), onclick: () => set(k, i + 1) }, w)))]),
    h('label', { class: 'q' }, 'Hai un dolore o una malattia che ti limita?'),
    h('div', { class: 'picks' }, ['No', "Un po'", 'Molto'].map((w, i) => h('button', { class: 'pick' + (a.health === i ? ' on' : ''), onclick: () => set('health', i) }, w))),
    h('div', { class: 'row' }), h('button', { class: 'btn main', disabled: !done, onclick: save }, 'Salva'),
    h('p', { class: 'sm' }, 'Le risposte le vedete solo tu e i tuoi coach, non i genitori.'),
  ];
}

// ---------------------------------------------------------------- Calendario
function calendario() {
  return [
    h('div', { class: 'seg' }, [['week', 'Settimana'], ['month', 'Mese']].map(([m, t]) => h('button', { class: S.cal === m ? 'on' : '', onclick: () => { if (m === 'month') openMonth(S.month); else go({ cal: m }); } }, t))),
    h('div', { class: 'row' }),
    ...(S.cal === 'week' ? straight() : monthView()),
  ];
}

function straight() {
  const m = S.monday, lanes = lanesFor(), now = today(), days = Array.from({ length: 7 }, (_, i) => dayData(m, i)), w = S.weeks.get(m);
  const cells = [h('span', {})];
  ['L', 'M', 'M', 'G', 'V', 'S', 'D'].forEach((d, i) => cells.push(h('u', { class: add(m, i) === now ? 'now' : '' }, d)));
  const pick = i => () => go({ tab: 'pista', sel: i, form: null });
  lanes.forEach(k => {
    cells.push(h('span', {}, CHANNELS[k][0].split(' ')[0]));
    days.forEach((d, i) => {
      const st = d.lanes[k], c = CHANNELS[k][1], b = h('button', { 'aria-label': `${d.label}: ${CHANNELS[k][0]}`, onclick: pick(i) });
      if (st === 'd') b.style.background = c;
      if (st === 'p') { b.style.background = c; b.style.opacity = 0.5; }
      if (st === 'm') b.style.background = `repeating-linear-gradient(45deg, ${c} 0 4px, #3B2A28 4px 8px)`;
      if (st === 'x') { b.style.background = '#10141A'; b.style.outline = '2px solid #8B939D'; b.style.outlineOffset = '-2px'; }
      cells.push(b);
    });
  });
  if (S.me.health_ok) {
    cells.push(h('span', {}, 'Salute'));
    days.forEach((d, i) => {
      const b = h('button', { 'aria-label': `${d.label}: salute`, onclick: pick(i) });
      if (d.mood) { const s = el('svg', { viewBox: '0 0 60 60', 'aria-hidden': 'true' }); face(s, 30, 30, 28, d.mood); b.append(s); } else if (d.ask) b.append('?');
      cells.push(b);
    });
  }
  const out = [weekBar(), h('div', { class: 'grid' }, cells), STATES()];
  const list = [...w.events].sort((a, b) => a.start.localeCompare(b.start));
  list.forEach(e => out.push(eventItem(e)));
  if (now >= add(m, 6)) out.push(...recap(m, lanes));
  return out;
}

/** The week done, on its Sunday and after. */
function recap(m, lanes) {
  const w = S.weeks.get(m), share = {}, count = c => { share[c] = share[c] || [0, 0]; return share[c]; };
  for (const s of w.sessions) for (const c of s.view?.channels || []) { count(c)[1]++; if (s.did && s.did !== 'ABSENT') count(c)[0]++; }
  const done = w.sessions.filter(s => s.did && s.did !== 'ABSENT').length, moods = (S.wellness.get(m) || []).filter(x => x.mood).length;
  return [h('h2', {}, 'La tua settimana'), drawRings({ lanes, share, center: [`${done} su ${w.sessions.length}`, 'sedute fatte'], health: S.me.health_ok, healthShare: moods / 7 }),
    h('div', { class: 'legend' }, lanes.map(k => h('span', {}, h('i', { bg: CHANNELS[k][1] }), `${CHANNELS[k][0].split(' ')[0]} ${(share[k] || [0, 0]).join('/')}`)))];
}

function openMonth(month) {
  run(async () => {
    const first = month + '-01', from = mondayOf(first), to = add(from, 41);
    S.monthData = await api.rpc('athlete_week', { p_from: from, p_to: to });
    go({ cal: 'month', month });
  });
}

function monthView() {
  const first = S.month + '-01', from = mondayOf(first), d = S.monthData, now = today(), cells = ['L', 'M', 'M', 'G', 'V', 'S', 'D'].map(x => h('u', {}, x));
  const shift = n => { const [y, m] = S.month.split('-').map(Number), t = new Date(Date.UTC(y, m - 1 + n, 15)); openMonth(t.toISOString().slice(0, 7)); };
  for (let i = 0; i < 42; i++) {
    const day = add(from, i), ev = d.events.filter(e => covers(e, day)), mine = d.sessions.filter(s => s.date === day);
    const cls = [day.slice(0, 7) !== S.month && 'out', day === now && 'now', ev.some(isAway) && 'away'].filter(Boolean).join(' ');
    const open = () => run(async () => { const m = mondayOf(day); await week(m); go({ tab: 'pista', monday: m, sel: weekday(day), form: null }); });
    cells.push(h('button', { class: cls, 'aria-label': longDay(day), onclick: open }, String(Number(day.slice(8))), h('br'),
      mine.flatMap(s => (s.view?.channels || []).map(c => h('i', { bg: CHANNELS[c]?.[1], class: s.did ? '' : 'p' }))),
      ev.some(isRace) && h('em', { class: 'flag' }, '⚑'), ev.some(isVisit) && h('em', { class: 'flag' }, '+')));
  }
  const list = d.events.filter(e => e.start.slice(0, 7) === S.month || (isAway(e) && covers(e, first)));
  return [
    h('div', { class: 'week' }, h('button', { class: 'arrow', 'aria-label': 'Mese prima', onclick: () => shift(-1) }, '‹'),
      h('b', {}, fmt(first, { month: 'long', year: 'numeric' }).replace(/^./, c => c.toUpperCase())), h('button', { class: 'arrow', 'aria-label': 'Mese dopo', onclick: () => shift(1) }, '›')),
    h('div', { class: 'row' }), h('div', { class: 'cal' }, cells),
    h('div', { class: 'row' }), h('button', { class: 'btn alt', onclick: () => go({ tab: 'pista', form: { what: 'absence', mode: 'day', start: today(), end: today(), days: [weekday(today()) + 1], reason: 'Altro', note: '' } }) }, '+ Assenza'),
    list.map(eventItem),
  ];
}

function eventItem(e) {
  const sub = isAway(e) ? (e.days ? `Ogni ${e.days.map(x => DAY_NAMES[x - 1].toLowerCase()).join(', ')} fino al ${dayMonth(e.end)}` : e.end ? `Fino al ${dayMonth(e.end)}` : 'Assente')
    : isRace(e) ? [e.place, e.called_for == null ? 'convocazione non ancora uscita' : e.called_for.length ? 'sei convocato' : null].filter(Boolean).join(' · ') : e.place;
  return h('div', { class: 'item' }, h('b', {}, short(e.start)), h('div', {}, isAway(e) ? `Assente: ${e.title.toLowerCase()}` : e.title, sub && h('small', {}, sub)));
}

// ---------------------------------------------------------------- Gare
function gare() {
  const list = S.upcoming || [], next = list[0], days = next ? Math.round((utc(next.start) - utc(today())) / 864e5) : null;
  return [
    h('h1', {}, 'Gare'),
    next ? h('div', { class: 'big' }, h('div', { class: 'count' }, days === 0 ? 'Oggi' : days === 1 ? 'Domani' : `Tra ${days} giorni`), h('div', { class: 'name' }, next.title),
      h('small', {}, [longDay(next.start), next.place].filter(Boolean).join(' · ')), h('div', { class: 'row' }), called(next)) : h('p', { class: 'center' }, 'Nessuna gara in calendario.'),
    list.length > 1 && h('h2', {}, 'Prossime gare'), list.slice(1).map(eventItem),
    S.races.length > 0 && h('h2', {}, 'I tuoi risultati'),
    S.races.slice(0, 12).map(r => h('div', { class: 'item' }, h('b', {}, eventName(r.event)), h('div', {}, String(r.mark ?? r.value).replace('.', ','), h('small', {}, [r.place, r.date.length === 10 ? dayMonth(r.date) : r.date, r.wind != null ? `vento ${r.wind > 0 ? '+' : ''}${String(r.wind).replace('.', ',')}` : null].filter(Boolean).join(' · '))))),
  ];
}
async function races() {
  const g = await fresh('races', async () => {
    const [w, res] = await Promise.all([api.rpc('athlete_week', { p_from: today(), p_to: add(today(), 365) }), api.rpc('athlete_results')]);
    return { upcoming: w.events.filter(isRace).sort((a, b) => a.start.localeCompare(b.start)), races: res?.races || [] };
  });
  S.upcoming = g.upcoming.filter(e => (e.end || e.start) >= today());
  S.races = g.races;
}
function openGare() { run(async () => { await races(); go({ tab: 'gare' }); }); }

// ---------------------------------------------------------------- Coach
const TAGS = { NOTICE: ['Avviso', '#9085E9', '#1B1442'], SESSION: ['Sulla seduta', '#3987E5', '#fff'], PERSONAL: ['Per te', '#FF9900', '#2B1A00'] };

function coach() {
  const seen = m => run(async () => { await write('athlete_message_seen', { p_id: m.id }); render(); });
  return [
    h('h1', {}, 'Dal coach'),
    !S.messages.length && h('p', { class: 'center' }, 'Qui trovi gli avvisi e i messaggi dei tuoi coach.'),
    S.messages.map(m => {
      const [t, bg, ink] = TAGS[m.kind] || TAGS.NOTICE, tag = h('span', { bg }, t);
      tag.style.color = ink;
      return h('article', { class: 'msg' }, !m.seen && h('i', { class: 'dot' }),
        h('header', {}, tag, h('small', {}, `Da ${m.from || 'Coach'} · ${short(m.at.slice(0, 10))}`)), h('p', {}, m.text),
        m.seen ? h('small', {}, m.pending ? 'Visto · sul telefono' : 'Visto') : h('button', { class: 'link', onclick: () => seen(m) }, 'Segna come visto'));
    }),
  ];
}

// ---------------------------------------------------------------- Scheda
/** The reports from the cloud, the last one kept on the phone as an image; with no network, that one. */
async function lastReport() {
  let list;
  try { list = await api.reports(S.seat); } catch (e) {
    if (!isOffline(e)) throw e;
    S.offline = true;
    const k = await copy('report');
    S.reports = k ? [{ date: k.date, from: k.from, url: shown(k.image) }] : [];
    return;
  }
  S.reports = list;
  S.at.report = Date.now();
  const k = await store.get('report'), r = list[0];
  if (!r) await store.del('report');
  else if (k?.data.name !== r.name) await keep('report', { name: r.name, date: r.date, from: r.from, image: await api.image(r.url) });
}
let shownUrl;
const shown = image => { if (shownUrl) URL.revokeObjectURL(shownUrl); shownUrl = URL.createObjectURL(image); return shownUrl; };

function openScheda() {
  run(async () => { await lastReport(); go({ tab: 'scheda', report: 0 }); });
}

/** Out of the account: everything on the phone goes, and first a word if some marks have not left. */
async function signOut() {
  const n = S.queue.length;
  if (n && !confirm(`${n === 1 ? 'Una segnatura non è ancora partita e uscendo si perde' : `${n} segnature non sono ancora partite e uscendo si perdono`}. Vuoi uscire lo stesso?`)) return;
  await store.clearAll();
  api.signOut();
  location.reload();
}

function scheda() {
  const list = S.reports || [], r = list[S.report || 0];
  return [
    r ? [h('small', {}, `Da ${r.from} · ${dayMonth(r.date)}`), h('h1', {}, 'Il tuo report'), h('img', { class: 'report', src: r.url, alt: `Report del ${dayMonth(r.date)}` })]
      : [h('h1', {}, 'Il tuo report'), h('p', { class: 'center' }, S.offline ? 'Il report si vede con la rete.' : 'Il tuo coach non ha ancora pubblicato un report.')],
    list.length > 1 && h('h2', {}, 'Report precedenti'),
    list.map((x, i) => i !== (S.report || 0) && h('button', { class: 'item', onclick: () => { go({ report: i }); window.scrollTo(0, 0); } }, h('b', {}, short(x.date)), h('div', {}, `Da ${x.from}`))),
    h('div', { class: 'row' }), !demo && h('button', { class: 'link', onclick: signOut }, 'Esci dall\'account'),
  ];
}

// ---------------------------------------------------------------- the frame
const ICONS = {
  pista: ['Pista', 'M6 6h12a6 6 0 0 1 0 12H6A6 6 0 0 1 6 6zM9 10h6a2 2 0 0 1 0 4H9a2 2 0 0 1 0-4z'],
  calendario: ['Calendario', 'M3 5h18v16H3zM3 10h18M8 3v4M16 3v4'],
  gare: ['Gare', 'M6 21V4M6 5h12l-3 4 3 4H6'],
  coach: ['Coach', 'M3 5h18v12H9l-5 4v-4H3z'],
  scheda: ['Scheda', 'M6 3h9l4 4v14H6zM9 12h7M9 16h7'],
};
function nav() {
  const open = { pista: () => go({ tab: 'pista', form: null }), calendario: () => go({ tab: 'calendario', form: null }), gare: openGare, coach: () => run(async () => { await messages(); go({ tab: 'coach' }); }), scheda: openScheda };
  const fresh = S.messages.filter(m => !m.seen).length;
  return h('nav', { class: 'nav', 'aria-label': 'Sezioni' }, Object.entries(ICONS).map(([k, [label, d]]) => {
    const svg = el('svg', { viewBox: '0 0 24 24', width: 24, height: 24, 'aria-hidden': 'true' });
    el('path', { d, fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linejoin': 'round' }, svg);
    return h('button', { class: S.tab === k ? 'on' : '', onclick: open[k], 'aria-current': S.tab === k ? 'page' : null }, svg, k === 'coach' && fresh > 0 && h('em', {}, String(fresh)), label);
  }));
}

const JOIN_ERRORS = {
  wrong: 'Codice o data di nascita non corretti.', used: 'Questo codice è già stato usato: chiedine uno nuovo al coach.', expired: 'Questo codice è scaduto: chiedine uno nuovo al coach.',
  blocked: 'Troppi tentativi: chiedi un nuovo codice al coach.', taken: 'Questo atleta ha già un accesso: parla con il coach.', wait: "Troppi tentativi: riprova tra un'ora.",
};

/** Joining the team with the code of the coach: the account comes first, so nobody can try codes without a working email. */
async function join() {
  const L = S.login, answer = await api.rpc('athlete_join', { p_code: L.invite, p_birth: L.birth });
  if (answer === 'ok' || answer === 'member') { S.outside = false; L.error = null; await start(); return; }
  S.outside = true;
  go({ login: { ...L, step: 'invite', error: JOIN_ERRORS[answer] || answer } });
}

function loginScreen() {
  const L = S.login, step = next => { L.step = next; L.error = null; render(); };
  const field = (label, attrs, key) => [h('label', { class: 'q' }, label), h('input', { ...attrs, 'aria-label': label, value: L[key] || '', oninput: e => { L[key] = e.target.value; } })];
  const act = work => run(async () => { try { await work(); } catch (e) { L.error = e.message; render(); } });
  const back = (text, to) => h('button', { class: 'link', onclick: () => step(to) }, `‹ ${text}`);
  const count = n => L.joining ? h('p', { class: 'steps' }, `Passo ${n} di 3`) : null;
  const screens = {
    welcome: () => [h('img', { class: 'logo', src: 'icons/lockup.svg', alt: 'Tekna Dok' }), h('p', {}, 'Entra nella tua squadra.'),
      h('button', { class: 'btn main', onclick: () => { L.joining = true; step('invite'); } }, 'Ho un codice'), h('div', { class: 'row' }),
      h('button', { class: 'btn alt', onclick: () => { L.joining = false; step('email'); } }, 'Ho già un account')],
    invite: () => [S.outside ? h('button', { class: 'link', onclick: () => { api.signOut(); location.reload(); } }, 'Esci') : back('Indietro', 'welcome'), count(1), h('h1', {}, 'Il tuo codice'), h('p', { class: 'sm' }, 'Te lo ha mandato il coach.'),
      field('Codice', { autocapitalize: 'characters', autocomplete: 'off', placeholder: 'K7F2-Q9', class: 'code' }, 'invite'), field('Data di nascita', { type: 'date', max: today() }, 'birth'),
      h('div', { class: 'row' }), h('button', { class: 'btn main', onclick: () => act(async () => {
        if (!L.invite?.trim() || !L.birth) { L.error = 'Scrivi il codice e la data di nascita.'; render(); return; }
        if (api.signedIn) await join(); else step('email');
      }) }, 'Avanti')],
    email: () => [back('Indietro', L.joining ? 'invite' : 'welcome'), count(2), h('h1', {}, 'La tua email'), h('p', { class: 'sm' }, "Scrivi un'email che leggi: ti mandiamo un codice per entrare."),
      field('Email', { type: 'email', autocomplete: 'email', autocapitalize: 'none', placeholder: 'nome@esempio.it' }, 'email'),
      h('div', { class: 'row' }), h('button', { class: 'btn main', onclick: () => act(async () => { await api.sendCode((L.email || '').trim().toLowerCase()); step('code'); }) }, 'Mandami il codice')],
    code: () => [back('Cambia email', 'email'), count(3), h('h1', {}, 'Controlla la posta'), h('p', { class: 'sm' }, `Scrivi il codice mandato a ${L.email}. Se non lo vedi, guarda nello spam.`),
      field('Codice ricevuto', { inputmode: 'numeric', autocomplete: 'one-time-code', class: 'code' }, 'otp'),
      h('div', { class: 'row' }), h('button', { class: 'btn main', onclick: () => act(async () => { await api.verify(L.email.trim().toLowerCase(), (L.otp || '').trim()); L.otp = ''; if (L.joining) await join(); else await start(); }) }, 'Entra'),
      L.joining && h('p', { class: 'sm' }, 'Poi resti dentro: niente codice ai prossimi accessi.')],
  };
  return h('main', { class: 'login' }, screens[L.step](), L.error && h('p', { class: 'err', role: 'alert' }, L.error));
}

// ---------------------------------------------------------------- with no network (§11, variant A of 11/11/2026)
const icon = (d, size) => {
  const svg = el('svg', { viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': 'true' });
  d.forEach(x => el('path', { d: x, fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, svg));
  return svg;
};
const NO_NET = ['M7 18h10a4 4 0 0 0 .6-7.96A6 6 0 0 0 6.1 9.1 4.5 4.5 0 0 0 7 18z', 'M4 3l16 18'];
const CLOCK = ['M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z', 'M12 7v5l3 2'];
const pend = () => h('p', { class: 'pend' }, icon(CLOCK, 16), h('span', {}, "Sul telefono · parte appena c'è rete"));

/** When what is on the screen was taken from the cloud. */
function copyLabel() {
  const at = { gare: S.at.races, coach: S.at.messages, scheda: S.at.report }[S.tab] ?? S.at[`week:${S.monday}`];
  if (!at) return '';
  const day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome' }).format(at), o = { timeZone: 'Europe/Rome' };
  const time = new Intl.DateTimeFormat('it-IT', { ...o, hour: '2-digit', minute: '2-digit' }).format(at);
  if (day === today()) return ` · copia delle ${time}`;
  if (day > add(today(), -6)) return ` · copia di ${new Intl.DateTimeFormat('it-IT', { ...o, weekday: 'short' }).format(at)} ${time}`;
  return ` · copia del ${new Intl.DateTimeFormat('it-IT', { ...o, day: 'numeric', month: 'short' }).format(at)}`;
}

/** The strip on top: what is seen is the copy on the phone, and how many marks wait. A touch tries the network again. */
function offBar() {
  if (!S.offline) return null;
  const n = S.queue.length;
  return h('button', { class: 'offbar', onclick: () => run(resume), 'aria-label': 'Senza rete: tocca per riprovare' }, icon(NO_NET, 18),
    h('span', {}, 'Senza rete' + copyLabel()), n > 0 && h('em', {}, `${n} da inviare`));
}

function screen() {
  if (!api.signedIn || S.outside) return [loginScreen()];
  if (!S.ready) return [h('main', {}, S.stuck
    ? [h('p', { class: 'center' }, "Senza rete, e sul telefono non c'è ancora una copia: riprova quando c'è campo."), h('button', { class: 'btn alt', onclick: () => run(start) }, 'Riprova')]
    : h('p', { class: 'center' }, 'Un attimo…'))];
  const body = { pista, calendario, gare, coach, scheda }[S.tab]();
  return [h('main', {}, offBar(), [body].flat(3).filter(Boolean)), nav()];
}

render();
if (api.signedIn) run(start);
addEventListener('online', () => { if (api.signedIn && S.me) run(resume); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && api.signedIn && S.ready && (S.offline || S.queue.length)) run(resume); });
if ('serviceWorker' in navigator && !demo) navigator.serviceWorker.register('sw.js').catch(() => {});
