// Invented data, to look at the pages with no account (?demo=1): nothing leaves the browser.
const add = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const stop = (title, detail, channel, n = 0) => ({ title, detail, channel, squares: Array(n).fill(channel) });

export class Demo {
  constructor(today) {
    this.today = today;
    this.monday = add(today, -((new Date(today + 'T12:00:00Z').getUTCDay() + 6) % 7));
    const m = this.monday, session = (id, d, title, channels, stops, did = null, extra = {}) => ({ id, date: add(m, d), title, text: stops.map(s => `${s.title} ${s.detail}`).join('\n'),
      view: { v: 1, note: '', channels, stops }, did, by_coach: false, coach_mark: null, rpe: did ? 6 : null, note: null, ...extra });
    const speed = [stop('Andature e tecnica', "Andature 15'", 'tec'), stop('4 × 60 m massimali', "dai blocchi · recupero 4'", 'ala', 4), stop('3 × 30 m lanciati massimali', "recupero 3'", 'ala', 3), stop('Defaticamento', '', '')];
    this.sessions = [
      session('s1', 0, 'Velocità: partenze', ['ala', 'tec'], speed, 'DONE'),
      session('s2', 1, 'Resistenza', ['lat'], [stop('Riscaldamento', "Andature 15'", 'tec'), stop('3 × 150 m al 90%', "recupero 6'", 'lat', 3), stop('Defaticamento', '', '')], 'DONE'),
      session('s3', 2, 'Forza e tecnica', ['for', 'tec'], [stop('Forza', 'Hip thrust 3×6 40 kg · Squat 3×5 50 kg', 'for'), stop('Andature', "Andature 15'", 'tec')], 'OTHER', { note: 'Meno ripetizioni: un giro in meno', rpe: 7 }),
      session('s4', 3, 'Corsa facile', ['aer'], [stop('Corsa', "30' di corsa lenta", 'aer')], 'DONE'),
      session('s5', 4, 'Velocità: inseguimenti', ['ala', 'tec'], speed),
      session('s6', 5, 'Corsa e forza', ['aer', 'for'], [stop('Corsa', "25' di corsa lenta", 'aer'), stop('Circuito di forza', "3 giri · recupero 2'", 'for')]),
      session('s7', 7, 'Velocità', ['ala', 'tec'], speed),
      session('s8', 8, 'Resistenza', ['lat'], [stop('3 × 200 m al 85%', "recupero 8'", 'lat', 3)]),
      session('s9', 9, 'Forza', ['for'], [stop('Circuito di forza', "4 giri · recupero 2'", 'for')]),
    ];
    this.events = [
      { id: 'e1', title: 'Regionali cadetti', type: 'Gara', start: add(m, 12), end: null, place: 'Torino', days: null, mine: false, called_for: ['100m', '4x100'], reserve_for: [] },
      { id: 'e2', title: 'Meeting regionale', type: 'Gara', start: add(m, 26), end: null, place: 'Fossano', days: null, mine: false, called_for: null, reserve_for: null },
      { id: 'e3', title: 'Visita medica', type: 'Visita medica', start: add(m, 8), end: null, place: 'Centro medico', days: null, mine: false, called_for: null, reserve_for: null },
    ];
    this.moods = [[0, 4], [1, 3], [2, 3], [3, 2]].map(([d, v]) => ({ day: add(m, d), sleep_quality: 3, sleep_band: d === 3 ? 3 : 4, fatigue: 3, soreness: 3, stress: 3, mood: v, health: d === 3 ? 1 : 0 }));
    this.messages = [
      { id: 'm1', kind: 'NOTICE', from: 'Marco', at: `${today}T10:00:00Z`, text: 'Domani si va al campo coperto. Portate le scarpe da pista.', workout: null, seen: false },
      { id: 'm2', kind: 'SESSION', from: 'Marco', at: `${today}T09:00:00Z`, text: 'Cura i primi 10 metri: spinta lunga.', workout: 's5', seen: false },
      { id: 'm3', kind: 'PERSONAL', from: 'Laura', at: `${add(today, -4)}T18:00:00Z`, text: 'Bel salto sabato: tieni quella rincorsa.', workout: null, seen: true },
    ];
    this.races = [
      { event: '100m', date: '2026-09-20', value: 12.54, mark: '12.54', wind: 0.4, indoor: false, place: 'Torino' },
      { event: '200m', date: '2026-09-06', value: 25.8, mark: '25.80', wind: -0.2, indoor: false, place: 'Fossano' },
    ];
  }
  get signedIn() { return true; }
  signOut() {}
  async seat() { return { team_id: 'demo', athlete_id: 'demo' }; }
  async wellness(from, to) { return this.moods.filter(w => w.day >= from && w.day <= to); }
  async reports() { return []; }
  async rpc(name, a = {}) {
    switch (name) {
      case 'accept_invites': return 0;
      case 'athlete_me': return { team: 'Squadra di prova', athlete: 'demo', first_name: 'Giulia', health_ok: true };
      case 'athlete_week': return {
        sessions: this.sessions.filter(s => s.date >= a.p_from && s.date <= a.p_to),
        events: this.events.filter(e => e.start <= a.p_to && (e.end || e.start) >= a.p_from),
      };
      case 'athlete_results': return { races: this.races };
      case 'athlete_messages': return this.messages;
      case 'athlete_message_seen': this.messages.find(m => m.id === a.p_id).seen = true; return null;
      case 'athlete_mark': Object.assign(this.sessions.find(s => s.id === a.p_workout), { did: a.p_did, rpe: a.p_rpe, note: a.p_note }); return null;
      case 'athlete_wellness': this.moods = this.moods.filter(w => w.day !== a.p_day).concat({ day: a.p_day, sleep_quality: a.p_sleep_quality, sleep_band: a.p_sleep_band, fatigue: a.p_fatigue, soreness: a.p_soreness, stress: a.p_stress, mood: a.p_mood, health: a.p_health }); return null;
      case 'athlete_absence': {
        const id = a.p_id || `a${Date.now()}`;
        this.events = this.events.filter(e => e.id !== id).concat({ id, title: a.p_reason, type: 'Assenza', start: a.p_start, end: a.p_end, place: null, days: a.p_days?.length ? a.p_days : null, mine: true, called_for: null, reserve_for: null });
        return id;
      }
      case 'athlete_absence_remove': this.events = this.events.filter(e => e.id !== a.p_id); return null;
      default: throw new Error(name);
    }
  }
}
