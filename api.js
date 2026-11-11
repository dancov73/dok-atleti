// The few calls of Supabase the web app needs, straight over HTTPS, with no library (as the Android app: nothing of others runs next to the
// data of minors). The address and the publishable key are public by construction. The rules of the database decide what comes back.
const BASE = 'https://lfctbribuafafwderqqh.supabase.co';
const KEY = 'sb_publishable_vFAQJFltOOBdm9o1ZU8Uiw_Umgon2N0';
const STORE = 'dok.session';
const WAIT = 15000;

/** No answer: no network, or one too weak to use. The pages show the copy on the phone, the marks wait there (docs/ruoli.md §11). */
export function offline() { const e = new Error('Senza rete'); e.offline = true; return e; }
export const isOffline = e => e?.offline === true;

async function net(url, init) {
  if (navigator.onLine === false) throw offline();
  const stop = new AbortController(), timer = setTimeout(() => stop.abort(), WAIT);
  try {
    const r = await fetch(url, { ...init, signal: stop.signal });
    return { r, body: init?.blob ? await r.blob() : await r.text() };
  } catch { throw offline(); } finally { clearTimeout(timer); }
}

function load() { try { return JSON.parse(localStorage.getItem(STORE)); } catch { return null; } }
function keep(s) { try { if (s) localStorage.setItem(STORE, JSON.stringify(s)); else localStorage.removeItem(STORE); } catch { /* a private window: the session lasts the page */ } }

export class Api {
  constructor() { this.session = load(); }
  get signedIn() { return !!this.session; }
  /** The account, from the token: the copies and the marks on the phone belong to it. */
  get userId() {
    try { const p = this.session.access.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'); return JSON.parse(atob(p + '='.repeat((4 - p.length % 4) % 4))).sub || null; } catch { return null; }
  }

  async call(path, { method = 'GET', body, token = true, headers = {} } = {}) {
    const h = { apikey: KEY, Accept: 'application/json', ...headers };
    if (body !== undefined) h['Content-Type'] = 'application/json';
    if (token) { const t = await this.token(); if (t) h.Authorization = `Bearer ${t}`; }
    const { r, body: text } = await net(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!r.ok) { const e = new Error(data?.message || data?.msg || data?.error_description || `errore ${r.status}`); e.status = r.status; throw e; }
    return data;
  }

  async token() {
    const s = this.session;
    if (!s) return null;
    if (s.expires - Date.now() > 60000) return s.access;
    // one renewal at a time: a refresh token holds once, and the pages ask several things together
    this.renewing ||= this.renew(s).finally(() => { this.renewing = null; });
    return this.renewing;
  }

  async renew(s) {
    try { this.take(await this.call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: s.refresh }, token: false })); }
    // out only when the server refuses the session: no network, or too many requests, leave the athlete in
    catch (e) { if ([400, 401, 403].includes(e.status)) { this.signOut(); this.refused?.(); throw new Error('Accesso scaduto: entra di nuovo con il codice.'); } throw e; }
    return this.session.access;
  }

  take(o) {
    this.session = { access: o.access_token, refresh: o.refresh_token, expires: o.expires_at ? o.expires_at * 1000 : Date.now() + (o.expires_in || 3600) * 1000, email: o.user?.email };
    keep(this.session);
  }

  sendCode(email) { return this.call('/auth/v1/otp', { method: 'POST', body: { email, create_user: true }, token: false }); }
  async verify(email, code) { this.take(await this.call('/auth/v1/verify', { method: 'POST', body: { type: 'email', email, token: code }, token: false })); }
  signOut() { this.session = null; keep(null); }

  rpc(name, args = {}) { return this.call(`/rest/v1/rpc/${name}`, { method: 'POST', body: args }); }

  /** Their team: what the rules let them read of the members, their own row. */
  async seat() {
    const a = await this.call('/rest/v1/team_members?select=team_id,athlete_id&role=eq.athlete&limit=1');
    return a?.[0] || null;
  }

  wellness(from, to) { return this.call(`/rest/v1/wellness_daily?select=day,sleep_quality,sleep_band,fatigue,soreness,stress,mood,health&day=gte.${from}&day=lte.${to}&order=day.asc`); }

  /** The reports the coach published for them, the latest first, each with a link valid for an hour. */
  async reports(seat) {
    const folder = `${seat.team_id}/${seat.athlete_id}/atleta`;
    const list = await this.call('/storage/v1/object/list/reports', { method: 'POST', body: { prefix: folder, limit: 100, offset: 0, sortBy: { column: 'name', order: 'desc' } } });
    const files = (list || []).filter(f => /^\d{4}-\d{2}-\d{2}_.*\.png$/.test(f.name));
    return Promise.all(files.map(async f => {
      const s = await this.call(`/storage/v1/object/sign/reports/${folder}/${f.name}`, { method: 'POST', body: { expiresIn: 3600 } });
      return { name: f.name, date: f.name.slice(0, 10), from: f.name.slice(11, -4), url: BASE + '/storage/v1' + s.signedURL };
    }));
  }

  /** A report as an image to keep on the phone. */
  async image(url) {
    const { r, body } = await net(url, { blob: true });
    if (!r.ok) { const e = new Error(`errore ${r.status}`); e.status = r.status; throw e; }
    return body;
  }
}
