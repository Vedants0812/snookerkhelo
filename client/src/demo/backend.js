// Browser-only demo backend.
// Used when the client is built with VITE_DEMO=1 (the public Vercel demo). It mirrors the
// Express routes in server/src/routes so every screen works without a server or database.
// All data is SAMPLE data, kept only in this browser (localStorage). "Reset demo" restores it.
import { computeBill, isPaused, r2 } from '../../../shared/billing.js';

const KEY = 'parlour-demo-db-v1';
const IST = 330 * 60000;
const PAY_METHODS = ['cash', 'upi', 'card'];

// ---------- helpers ----------
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const bad = (m) => new HttpError(400, m);
const notFound = (w = 'Record') => new HttpError(404, `${w} not found`);
const clone = (x) => (x === undefined ? x : JSON.parse(JSON.stringify(x)));
const nowIso = () => new Date().toISOString();
let idSeq = 0;
function oid() {
  const t = Math.floor(Date.now() / 1000).toString(16).padStart(8, '0');
  idSeq = (idSeq + 1) % 0xffffff;
  const rnd = Array.from({ length: 10 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return (t + rnd + idSeq.toString(16).padStart(6, '0')).slice(0, 24);
}
const isId = (v) => typeof v === 'string' && /^[0-9a-f]{24}$/.test(v);
function str(v, { max = 200, required = false, label = 'Value' } = {}) {
  const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
  if (required && !s) throw bad(`${label} is required`);
  if (s.length > max) throw bad(`${label} is too long`);
  return s;
}
function num(v, { min = 0, max = 1e7, label = 'Value', int = false, required = true } = {}) {
  if ((v === undefined || v === null || v === '') && !required) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max || (int && !Number.isInteger(n))) throw bad(`${label} is invalid`);
  return Math.round(n * 100) / 100;
}
function phone(v, { required = false } = {}) {
  let d = String(v ?? '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (!d) { if (required) throw bad('Mobile number is required'); return ''; }
  if (!/^[6-9]\d{9}$/.test(d)) throw bad('Enter a valid 10-digit mobile number');
  return d;
}
const escapeRx = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function businessDate(d = new Date(), h = 0) {
  return new Date(new Date(d).getTime() + IST - h * 3600000).toISOString().slice(0, 10);
}
function dayRange(dateStr, h = 0) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr || '') || Number.isNaN(Date.parse(dateStr))) throw bad('Invalid date');
  const start = new Date(Date.parse(`${dateStr}T00:00:00Z`) - IST + h * 3600000);
  return [start, new Date(start.getTime() + 86400000)];
}
const inRange = (d, [from, to]) => { const t = d ? new Date(d).getTime() : NaN; return t >= from.getTime() && t < to.getTime(); };

// ---------- sample data ----------
function seed() {
  const db = {
    users: [], tables: [], products: [], players: [], passTxns: [], sessions: [], bills: [],
    tournaments: [], waitlist: [], counters: { bill: 0 },
    settings: {
      _id: oid(), shopName: 'The 8 Pool Gaming Zone', address: '', phone: '', upiId: '', upiPayeeName: '',
      googleReviewLink: '', googleMapsLink: '', receiptFooter: 'Thank you! Visit again.',
      billing: { roundToMinutes: 1, minMinutes: 0, roundTotal: true, dayStartHour: 0 },
      features: { playerPass: true, waitlist: true },
    },
  };
  const at = (msAgo) => new Date(Date.now() - msAgo).toISOString();
  const owner = { _id: oid(), name: 'Owner (demo)', username: 'owner', password: 'demo123', role: 'admin', active: true, createdAt: at(30 * 86400000) };
  const staff = { _id: oid(), name: 'Counter staff (demo)', username: 'staff', password: 'staff123', role: 'staff', active: true, createdAt: at(29 * 86400000) };
  db.users.push(owner, staff);

  const T = (name, type, ratePerHour, ratePerFrame, defaultMode, sortOrder) => ({
    _id: oid(), name, type, ratePerHour, ratePerFrame, defaultMode, sortOrder, active: true, createdAt: at(30 * 86400000),
  });
  db.tables.push(
    T('Snooker 1', 'snooker', 200, 80, 'time', 1), T('Snooker 2', 'snooker', 200, 80, 'time', 2),
    T('Snooker 3', 'snooker', 220, 90, 'time', 3), T('Pool 1', 'pool', 150, 40, 'time', 4),
    T('Pool 2', 'pool', 150, 40, 'frame', 5), T('Pool 3', 'pool', 150, 40, 'time', 6),
  );
  const P = (name, category, price, stock = null) => ({ _id: oid(), name, category, price, stock, active: true });
  db.products.push(
    P('Water Bottle', 'Drinks', 20), P('Cold Drink 250ml', 'Drinks', 25, 48), P('Energy Drink', 'Drinks', 125, 12),
    P('Tea', 'Drinks', 15), P('Coffee', 'Drinks', 25), P('Chips', 'Snacks', 20, 30), P('Maggi', 'Snacks', 50),
    P('Sandwich', 'Snacks', 60), P('Chalk', 'Accessories', 30, 20),
  );
  const PL = (name, ph, extra = {}) => ({ _id: oid(), name, phone: ph, notes: '', passBalance: 0, visits: 0, totalSpent: 0, lastVisitAt: null, active: true, createdAt: at(25 * 86400000), ...extra });
  db.players.push(
    PL('Aarav Kulkarni', '9800000101', { notes: 'Sample player' }), PL('Kabir Mehta', '9800000102'),
    PL('Ishaan Joshi', '9800000103'), PL('Rehan Shaikh', '9800000104'), PL('Dev Patil', '9800000105'),
    PL('Neel Deshmukh', '9800000106'), PL('Yash Rao', '9800000107'), PL('Arjun Nair', '9800000108'),
  );
  const pl = db.players;

  // Pass top-ups for two regulars.
  for (const [p, amount, method, ago] of [[pl[0], 2000, 'upi', 5], [pl[3], 1000, 'cash', 2]]) {
    p.passBalance += amount;
    db.passTxns.push({ _id: oid(), player: p._id, type: 'topup', amount, balanceAfter: p.passBalance, method, note: '', by: owner._id, createdAt: at(ago * 86400000 + 3 * 3600000) });
  }

  // A week of paid bills so reports have something to show. Deterministic pseudo-random.
  let s = 7;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const byName = (n) => db.products.find((x) => x.name === n);
  for (let day = 6; day >= 0; day--) {
    const count = day === 0 ? 5 : 7 + Math.floor(rnd() * 6);
    const dateStr = businessDate(new Date(Date.now() - day * 86400000));
    for (let i = 0; i < count; i++) {
      const table = db.tables[Math.floor(rnd() * db.tables.length)];
      const startIst = Date.parse(`${dateStr}T00:00:00Z`) - IST + (13 + rnd() * 9) * 3600000;
      const minutes = 25 + Math.floor(rnd() * 95);
      const end = startIst + minutes * 60000;
      if (end > Date.now() - 20 * 60000) continue; // only finished games
      const frameMode = table.defaultMode === 'frame';
      const items = [];
      for (const n of ['Cold Drink 250ml', 'Chips', 'Tea', 'Maggi']) if (rnd() < 0.35) items.push({ product: byName(n)._id, name: n, price: byName(n).price, qty: 1 + Math.floor(rnd() * 3) });
      const player = rnd() < 0.55 ? pl[Math.floor(rnd() * pl.length)] : null;
      const session = {
        _id: oid(), table: table._id, tableName: table.name, mode: frameMode ? 'frame' : 'time',
        ratePerHour: table.ratePerHour, ratePerFrame: table.ratePerFrame, players: player ? [player._id] : [],
        customerName: player ? '' : 'Walk-in', startedAt: new Date(startIst).toISOString(), endedAt: new Date(end).toISOString(),
        pauses: [], frames: frameMode ? 2 + Math.floor(rnd() * 4) : 0, items, status: 'closed', startedBy: staff._id,
      };
      const calc = computeBill(session, db.settings.billing, { now: end, discount: rnd() < 0.12 ? 20 : 0 });
      const method = player?.passBalance >= calc.total && rnd() < 0.3 ? 'pass' : ['cash', 'upi', 'upi', 'card'][Math.floor(rnd() * 4)];
      const paidAt = new Date(end + 2 * 60000).toISOString();
      const bill = newBill(db, {
        kind: 'table', session: session._id, table: table._id, tableName: table.name, mode: calc.mode, rate: calc.rate,
        startedAt: session.startedAt, endedAt: session.endedAt, playedMinutes: calc.playedMinutes, billedMinutes: calc.billedMinutes,
        frames: calc.frames, tableCharge: calc.tableCharge, items: calc.items, itemsTotal: calc.itemsTotal, subTotal: calc.subTotal,
        discount: calc.discount, roundOff: calc.roundOff, total: calc.total, player: player?._id || null,
        customerName: player ? player.name : 'Walk-in', status: 'paid', paymentMethod: method, paidAt, createdBy: staff._id, paidBy: staff._id,
        createdAt: session.endedAt,
      });
      session.bill = bill._id;
      db.sessions.push(session);
      if (player) {
        player.visits++; player.totalSpent = r2(player.totalSpent + bill.total); player.lastVisitAt = paidAt;
        if (method === 'pass') {
          player.passBalance = r2(player.passBalance - bill.total);
          db.passTxns.push({ _id: oid(), player: player._id, type: 'spend', amount: -bill.total, balanceAfter: player.passBalance, bill: bill._id, note: `Bill ${bill.code}`, by: staff._id, createdAt: paidAt });
        }
      }
    }
  }
  db.bills.sort((a, b) => a.billNo - b.billNo);

  // One unpaid bill waiting at the counter.
  const unpaid = [...db.bills].reverse().find((b) => b.paymentMethod !== 'pass');
  if (unpaid) {
    const p = db.players.find((x) => x._id === unpaid.player);
    if (p) { p.visits--; p.totalSpent = r2(p.totalSpent - unpaid.total); }
    Object.assign(unpaid, { status: 'unpaid', paymentMethod: null, paidAt: null, paidBy: null });
  }

  // Tables running right now.
  const run = (table, minsAgo, extra) => db.sessions.push({
    _id: oid(), table: table._id, tableName: table.name, mode: table.defaultMode, ratePerHour: table.ratePerHour,
    ratePerFrame: table.ratePerFrame, players: [], customerName: '', startedAt: at(minsAgo * 60000), pauses: [],
    frames: 0, items: [], status: 'active', startedBy: staff._id, ...extra,
  });
  run(db.tables[0], 47, { players: [pl[0]._id, pl[1]._id], items: [{ product: byName('Cold Drink 250ml')._id, name: 'Cold Drink 250ml', price: 25, qty: 2 }] });
  run(db.tables[2], 82, { customerName: 'Walk-in group', pauses: [{ from: at(30 * 60000), to: at(22 * 60000) }] });
  run(db.tables[4], 35, { frames: 3, players: [pl[3]._id], mode: 'frame' });
  run(db.tables[5], 12, { players: [pl[5]._id], pauses: [{ from: at(3 * 60000) }] });
  byName('Cold Drink 250ml').stock -= 2;

  // Waiting list.
  db.waitlist.push(
    { _id: oid(), name: 'Rahul (sample)', phone: '9800000201', partySize: 2, tableType: 'snooker', status: 'waiting', createdAt: at(18 * 60000) },
    { _id: oid(), name: 'Sameer (sample)', phone: '', partySize: 4, tableType: 'pool', status: 'notified', notifiedAt: at(4 * 60000), createdAt: at(26 * 60000) },
  );

  // Tournament with a first round in progress.
  const regs = pl.slice(0, 8).map((p, i) => ({
    _id: oid(), name: p.name, phone: p.phone, player: p._id, paid: i < 6, paidMethod: i < 6 ? (i % 2 ? 'cash' : 'upi') : null,
    paidAmount: i < 6 ? 200 : 0, paidAt: i < 6 ? at((3 - (i % 3)) * 86400000) : null, createdAt: at(4 * 86400000),
  }));
  const M = (a, b, s1, s2) => ({ _id: oid(), round: 'Round 1', p1: regs[a]._id, p2: regs[b]._id, score1: s1 ?? 0, score2: s2 ?? 0,
    status: s1 === undefined ? 'scheduled' : 'done', winner: s1 === undefined ? null : (s1 > s2 ? regs[a]._id : regs[b]._id), createdAt: at(86400000) });
  db.tournaments.push({
    _id: oid(), name: 'Weekend 8-Ball Championship (sample)', game: '8 Ball Pool', date: new Date(Date.now() + 2 * 86400000).toISOString(),
    entryFee: 200, maxPlayers: 16, prize: 'Winner gets a trophy (sample)', description: 'Knockout format, race to 3 frames. Sample tournament for the demo.',
    status: 'ongoing', registrations: regs, matches: [M(0, 1, 3, 1), M(2, 3, 2, 3), M(4, 5), M(6, 7)], createdAt: at(5 * 86400000),
  });
  db.tournaments.push({
    _id: oid(), name: 'Monthly Snooker Open (sample)', game: 'Snooker', date: new Date(Date.now() + 12 * 86400000).toISOString(),
    entryFee: 300, maxPlayers: 12, prize: 'Trophy + free table hours (sample)', description: 'Group stage then knockouts.',
    status: 'open', registrations: [], matches: [], createdAt: at(86400000),
  });
  return db;
}

function newBill(db, fields) {
  db.counters.bill += 1;
  const billNo = db.counters.bill;
  const bill = {
    _id: oid(), billNo, code: `B-${String(billNo).padStart(5, '0')}`, kind: 'table', items: [], itemsTotal: 0, subTotal: 0,
    discount: 0, roundOff: 0, total: 0, tableCharge: 0, playedMinutes: 0, billedMinutes: 0, frames: 0, customerName: '',
    status: 'unpaid', paymentMethod: null, createdAt: nowIso(), ...fields,
  };
  bill.updatedAt = bill.createdAt;
  db.bills.push(bill);
  return bill;
}

// ---------- storage ----------
let db = null;
function getDb() {
  if (db) return db;
  try { const raw = localStorage.getItem(KEY); if (raw) db = JSON.parse(raw); } catch { db = null; }
  if (!db || !db.users) { db = seed(); save(); }
  return db;
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* storage full or blocked: keep in memory */ } }
export function resetDemo() { try { localStorage.removeItem(KEY); localStorage.removeItem('token'); } catch { /* ignore */ } db = null; }

// ---------- lookups / views ----------
const find = (list, id, what) => { const x = list.find((i) => i._id === id); if (!x) throw notFound(what); return x; };
const pubUser = (u) => ({ id: u._id, name: u.name, username: u.username, role: u.role, active: u.active });
const playerLite = (id, fields = ['name', 'phone', 'passBalance']) => {
  const p = db.players.find((x) => x._id === id);
  return p ? Object.fromEntries([['_id', p._id], ...fields.map((f) => [f, p[f]])]) : null;
};
const userLite = (id) => { const u = db.users.find((x) => x._id === id); return u ? { _id: u._id, name: u.name } : null; };
const sessionView = (s) => ({ ...s, players: s.players.map((id) => playerLite(id)).filter(Boolean) });
const billFull = (b) => ({ ...b, player: b.player ? playerLite(b.player) : null, createdBy: userLite(b.createdBy), paidBy: userLite(b.paidBy) });
const settingsOf = () => db.settings;

function leaderboard(t) {
  const rows = new Map(t.registrations.map((g) => [g._id, { id: g._id, name: g.name, played: 0, won: 0, lost: 0, framesFor: 0, framesAgainst: 0, points: 0 }]));
  for (const m of t.matches) {
    if (m.status !== 'done') continue;
    const a = rows.get(m.p1); const b = rows.get(m.p2);
    if (!a || !b) continue;
    a.played++; b.played++;
    a.framesFor += m.score1; a.framesAgainst += m.score2; b.framesFor += m.score2; b.framesAgainst += m.score1;
    const w = m.winner === a.id ? a : b; const l = w === a ? b : a;
    w.won++; w.points += 2; l.lost++;
  }
  return [...rows.values()].map((x) => ({ ...x, diff: x.framesFor - x.framesAgainst }))
    .sort((x, y) => y.points - x.points || y.diff - x.diff || y.framesFor - x.framesFor || x.name.localeCompare(y.name))
    .map((x, i) => ({ rank: i + 1, ...x }));
}
const maskPhone = (p) => (p ? `${p.slice(0, 2)}******${p.slice(-2)}` : '');
function publicView(t) {
  const names = new Map(t.registrations.map((g) => [g._id, g.name]));
  return {
    id: t._id, name: t.name, game: t.game, date: t.date, entryFee: t.entryFee, maxPlayers: t.maxPlayers, prize: t.prize,
    description: t.description, status: t.status, registered: t.registrations.length,
    full: t.maxPlayers > 0 && t.registrations.length >= t.maxPlayers,
    players: t.registrations.map((g) => ({ name: g.name, phone: maskPhone(g.phone), paid: g.paid })),
    matches: t.matches.map((m) => ({ round: m.round, p1: names.get(m.p1) || '?', p2: names.get(m.p2) || '?', score1: m.score1, score2: m.score2,
      status: m.status, winner: m.winner ? names.get(m.winner) : null })),
    leaderboard: leaderboard(t),
  };
}
const adminView = (t) => ({ ...t, leaderboard: leaderboard(t) });
const byDateDesc = (k) => (a, b) => new Date(b[k] || 0) - new Date(a[k] || 0);

function addRegistration(t, body) {
  if (t.status !== 'open') throw bad('Registration is closed for this tournament');
  if (t.maxPlayers > 0 && t.registrations.length >= t.maxPlayers) throw bad('Tournament is full');
  const name = str(body?.name, { required: true, max: 60, label: 'Name' });
  const ph = phone(body?.phone, { required: true });
  if (t.registrations.some((g) => g.phone === ph)) throw bad('This mobile number is already registered');
  let player = db.players.find((p) => p.phone === ph);
  if (!player) { player = { _id: oid(), name, phone: ph, notes: '', passBalance: 0, visits: 0, totalSpent: 0, lastVisitAt: null, active: true, createdAt: nowIso() }; db.players.push(player); }
  t.registrations.push({ _id: oid(), name, phone: ph, player: player._id, paid: false, paidMethod: null, paidAmount: 0, paidAt: null, createdAt: nowIso() });
  return t;
}

// ---------- routes ----------
const routes = [];
const route = (method, pattern, handler, { open = false, admin = false } = {}) => {
  const keys = [];
  const rx = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}$`);
  routes.push({ method, rx, keys, handler, open, admin });
};

// --- public ---
route('GET', '/health', () => ({ ok: true, time: Date.now() }), { open: true });
route('GET', '/public/info', () => { const s = settingsOf(); return { shopName: s.shopName, address: s.address, phone: s.phone, googleMapsLink: s.googleMapsLink }; }, { open: true });
route('GET', '/public/tournaments', () => [...db.tournaments].sort(byDateDesc('date')).map((t) => {
  const v = publicView(t); delete v.players; delete v.matches; v.leaderboard = v.leaderboard.slice(0, 3); return v;
}), { open: true });
route('GET', '/public/tournaments/:id', ({ id }) => publicView(find(db.tournaments, id, 'Tournament')), { open: true });
route('POST', '/public/tournaments/:id/register', ({ id }, b) => publicView(addRegistration(find(db.tournaments, id, 'Tournament'), b)), { open: true });

// --- auth ---
route('POST', '/auth/login', (_, b) => {
  const username = str(b?.username, { required: true, label: 'Username' }).toLowerCase();
  const u = db.users.find((x) => x.username === username);
  if (!u || !u.active || u.password !== String(b?.password || '')) throw new HttpError(401, 'Wrong username or password');
  return { token: `demo.${u._id}`, user: pubUser(u) };
}, { open: true });
route('GET', '/auth/me', (_, __, ___, me) => ({ user: pubUser(me) }));
route('POST', '/auth/change-password', (_, b, __, me) => {
  if (String(b?.current || '') !== me.password) throw bad('Current password is wrong');
  if (typeof b?.next !== 'string' || b.next.length < 6) throw bad('Password must be at least 6 characters');
  me.password = b.next; return { ok: true };
});
route('GET', '/users', () => db.users.map(pubUser), { admin: true });
route('POST', '/users', (_, b) => {
  const username = str(b?.username, { required: true, max: 30, label: 'Username' }).toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) throw bad('Username: 3-30 letters, numbers, dot, dash');
  if (db.users.some((u) => u.username === username)) throw bad('Username already taken');
  if (typeof b?.password !== 'string' || b.password.length < 6) throw bad('Password must be at least 6 characters');
  const u = { _id: oid(), name: str(b?.name, { required: true, max: 60, label: 'Name' }), username, password: b.password, role: b?.role === 'admin' ? 'admin' : 'staff', active: true, createdAt: nowIso() };
  db.users.push(u); return pubUser(u);
}, { admin: true });
route('PUT', '/users/:id', ({ id }, b, _, me) => {
  const u = find(db.users, id, 'User');
  const self = u._id === me._id;
  if (b.name !== undefined) u.name = str(b.name, { required: true, max: 60, label: 'Name' });
  if (b.password) { if (b.password.length < 6) throw bad('Password must be at least 6 characters'); u.password = b.password; }
  if (b.role !== undefined && !self) u.role = b.role === 'admin' ? 'admin' : 'staff';
  if (b.active !== undefined && !self) u.active = !!b.active;
  return pubUser(u);
}, { admin: true });

// --- settings / tables / products ---
route('GET', '/settings', () => settingsOf());
route('PUT', '/settings', (_, b) => {
  const s = clone(settingsOf());
  for (const k of ['shopName', 'phone', 'upiId', 'upiPayeeName']) if (b[k] !== undefined) s[k] = str(b[k], { max: 100 });
  for (const k of ['address', 'googleReviewLink', 'googleMapsLink', 'receiptFooter']) if (b[k] !== undefined) s[k] = str(b[k], { max: 400 });
  if (s.upiId && !/^[\w.-]{2,}@[a-zA-Z]{2,}$/.test(s.upiId)) throw bad('UPI ID looks wrong (example: name@okhdfcbank)');
  if (!s.shopName) throw bad('Shop name is required');
  if (b.billing) {
    const g = b.billing;
    if (g.roundToMinutes !== undefined) s.billing.roundToMinutes = num(g.roundToMinutes, { min: 1, max: 60, int: true, label: 'Billing block' });
    if (g.minMinutes !== undefined) s.billing.minMinutes = num(g.minMinutes, { min: 0, max: 240, int: true, label: 'Minimum minutes' });
    if (g.roundTotal !== undefined) s.billing.roundTotal = !!g.roundTotal;
    if (g.dayStartHour !== undefined) s.billing.dayStartHour = num(g.dayStartHour, { min: 0, max: 12, int: true, label: 'Day start hour' });
  }
  if (b.features) {
    if (b.features.playerPass !== undefined) s.features.playerPass = !!b.features.playerPass;
    if (b.features.waitlist !== undefined) s.features.waitlist = !!b.features.waitlist;
  }
  db.settings = s; return s;
}, { admin: true });

function tableFields(b, t) {
  if (b.name !== undefined) t.name = str(b.name, { required: true, max: 40, label: 'Table name' });
  if (b.type !== undefined) t.type = ['snooker', 'pool', 'other'].includes(b.type) ? b.type : 'snooker';
  if (b.ratePerHour !== undefined) t.ratePerHour = num(b.ratePerHour, { max: 100000, label: 'Rate per hour' });
  if (b.ratePerFrame !== undefined) t.ratePerFrame = num(b.ratePerFrame, { max: 100000, label: 'Rate per frame' });
  if (b.defaultMode !== undefined) t.defaultMode = b.defaultMode === 'frame' ? 'frame' : 'time';
  if (b.sortOrder !== undefined) t.sortOrder = num(b.sortOrder, { min: 0, max: 999, int: true, label: 'Order' });
  if (b.active !== undefined) t.active = !!b.active;
  if (!(t.ratePerHour > 0) && !(t.ratePerFrame > 0)) throw bad('Set a rate per hour or a rate per frame');
  if (t.defaultMode === 'frame' && !(t.ratePerFrame > 0)) t.defaultMode = 'time';
  if (t.defaultMode === 'time' && !(t.ratePerHour > 0)) t.defaultMode = 'frame';
  return t;
}
const activeSessionOf = (tableId) => db.sessions.find((s) => s.table === tableId && s.status === 'active');
route('GET', '/tables', (_, __, q) => {
  const tables = db.tables.filter((t) => q.get('all') === '1' || t.active)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  return { serverTime: Date.now(), rules: settingsOf().billing,
    tables: tables.map((t) => { const s = activeSessionOf(t._id); return { ...t, session: s ? sessionView(s) : null }; }) };
});
route('POST', '/tables', (_, b) => {
  const t = tableFields(b, { _id: oid(), name: '', type: 'snooker', ratePerHour: 0, ratePerFrame: 0, defaultMode: 'time', sortOrder: 0, active: true, createdAt: nowIso() });
  if (!t.name) throw bad('Table name is required');
  db.tables.push(t); return t;
}, { admin: true });
route('PUT', '/tables/:id', ({ id }, b) => {
  const t = find(db.tables, id, 'Table');
  const next = tableFields(b, clone(t));
  if (!next.active && activeSessionOf(t._id)) throw bad('Stop the running session first');
  Object.assign(t, next); return t;
}, { admin: true });
route('DELETE', '/tables/:id', ({ id }) => {
  const t = find(db.tables, id, 'Table');
  if (db.sessions.some((s) => s.table === id)) {
    if (activeSessionOf(id)) throw bad('Stop the running session first');
    t.active = false; return { ok: true, archived: true };
  }
  db.tables = db.tables.filter((x) => x._id !== id); return { ok: true };
}, { admin: true });

function productFields(b, p) {
  if (b.name !== undefined) p.name = str(b.name, { required: true, max: 60, label: 'Item name' });
  if (b.category !== undefined) p.category = str(b.category, { max: 40 }) || 'Snacks';
  if (b.price !== undefined) p.price = num(b.price, { max: 100000, label: 'Price' });
  if (b.stock !== undefined) p.stock = b.stock === null || b.stock === '' ? null : num(b.stock, { max: 100000, int: true, label: 'Stock' });
  if (b.active !== undefined) p.active = !!b.active;
  return p;
}
route('GET', '/products', (_, __, q) => db.products.filter((p) => q.get('all') === '1' || p.active)
  .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)));
route('POST', '/products', (_, b) => {
  const p = productFields(b, { _id: oid(), category: 'Snacks', stock: null, active: true });
  if (!p.name || p.price === undefined) throw bad('Name and price are required');
  db.products.push(p); return p;
}, { admin: true });
route('PUT', '/products/:id', ({ id }, b) => { const p = find(db.products, id, 'Item'); Object.assign(p, productFields(b, clone(p))); return p; }, { admin: true });
route('DELETE', '/products/:id', ({ id }) => { find(db.products, id, 'Item').active = false; return { ok: true }; }, { admin: true });

// --- sessions ---
const activeSession = (id) => {
  const s = db.sessions.find((x) => x._id === id && x.status === 'active');
  if (!s) throw new HttpError(409, 'This session is not running any more');
  return s;
};
const resolvePlayers = (ids) => (Array.isArray(ids) ? [...new Set(ids.filter(isId))].slice(0, 8) : [])
  .map((id) => db.players.find((p) => p._id === id && p.active)).filter(Boolean);
route('POST', '/sessions', (_, b, __, me) => {
  const table = db.tables.find((t) => t._id === b.tableId && t.active);
  if (!table) throw notFound('Table');
  const mode = b.mode === 'frame' ? 'frame' : b.mode === 'time' ? 'time' : table.defaultMode;
  if (mode === 'time' && !(table.ratePerHour > 0)) throw bad('This table has no hourly rate');
  if (mode === 'frame' && !(table.ratePerFrame > 0)) throw bad('This table has no per-frame rate');
  if (activeSessionOf(table._id)) throw new HttpError(409, `${table.name} is already running`);
  const s = { _id: oid(), table: table._id, tableName: table.name, mode, ratePerHour: table.ratePerHour, ratePerFrame: table.ratePerFrame,
    players: resolvePlayers(b.playerIds).map((p) => p._id), customerName: str(b.customerName, { max: 80 }),
    startedAt: nowIso(), pauses: [], frames: 0, items: [], status: 'active', startedBy: me._id };
  db.sessions.push(s); return sessionView(s);
});
route('GET', '/sessions/:id', ({ id }) => sessionView(find(db.sessions, id, 'Session')));
route('PUT', '/sessions/:id', ({ id }, b) => {
  const s = activeSession(id);
  if (b.playerIds !== undefined) s.players = resolvePlayers(b.playerIds).map((p) => p._id);
  if (b.customerName !== undefined) s.customerName = str(b.customerName, { max: 80 });
  return sessionView(s);
});
route('POST', '/sessions/:id/pause', ({ id }) => { const s = activeSession(id); if (!isPaused(s)) s.pauses.push({ from: nowIso() }); return sessionView(s); });
route('POST', '/sessions/:id/resume', ({ id }) => { const s = activeSession(id); const o = s.pauses.find((p) => !p.to); if (o) o.to = nowIso(); return sessionView(s); });
route('POST', '/sessions/:id/frames', ({ id }, b) => {
  const delta = Number(b?.delta);
  if (![1, -1].includes(delta)) throw bad('Invalid frame change');
  const s = activeSession(id);
  if (delta < 0 && s.frames <= 0) throw new HttpError(409, 'Could not change frames');
  s.frames += delta; return sessionView(s);
});
route('POST', '/sessions/:id/items', ({ id }, b) => {
  const s = activeSession(id);
  const delta = num(b?.qty ?? 1, { min: -100, max: 100, int: true, label: 'Quantity' });
  if (!delta) throw bad('Quantity is invalid');
  const product = find(db.products, b?.productId, 'Item');
  const line = s.items.find((i) => i.product === product._id);
  const current = line ? line.qty : 0;
  const next = Math.max(0, current + delta);
  const change = next - current;
  if (change === 0) return sessionView(s);
  if (change > 0 && !product.active) throw bad('Item is not available');
  if (product.stock !== null && product.stock !== undefined) {
    if (change > 0 && product.stock < change) throw bad(`Only ${product.stock} ${product.name} left in stock`);
    product.stock -= change;
  }
  if (!line) s.items.push({ product: product._id, name: product.name, price: product.price, qty: next });
  else if (next === 0) s.items = s.items.filter((i) => i !== line);
  else line.qty = next;
  return sessionView(s);
});
route('POST', '/sessions/:id/stop', ({ id }, b, _, me) => {
  const discount = num(b?.discount ?? 0, { max: 1e6, label: 'Discount' });
  const s = db.sessions.find((x) => x._id === id && x.status === 'active');
  if (!s) throw new HttpError(409, 'This session is already stopped');
  const frames = s.mode === 'frame' && b?.frames !== undefined ? num(b.frames, { max: 500, int: true, label: 'Frames' }) : s.frames;
  if (s.mode === 'frame' && frames < 1 && !s.items.length) throw bad('Enter the number of frames played');
  const now = nowIso();
  s.frames = frames;
  const open = s.pauses.find((p) => !p.to); if (open) open.to = now;
  s.status = 'closed'; s.endedAt = now;
  const calc = computeBill(s, settingsOf().billing, { discount, now: Date.parse(now) });
  const players = s.players.map((pid) => db.players.find((p) => p._id === pid)).filter(Boolean);
  const bill = newBill(db, {
    kind: 'table', session: s._id, table: s.table, tableName: s.tableName, mode: calc.mode, rate: calc.rate, startedAt: s.startedAt, endedAt: now,
    playedMinutes: calc.playedMinutes, billedMinutes: calc.billedMinutes, frames: calc.frames, tableCharge: calc.tableCharge, items: calc.items,
    itemsTotal: calc.itemsTotal, subTotal: calc.subTotal, discount: calc.discount, roundOff: calc.roundOff, total: calc.total,
    player: players[0]?._id || null, customerName: players.map((p) => p.name).join(', ') || s.customerName || 'Walk-in', createdBy: me._id,
  });
  s.bill = bill._id; return bill;
});
route('POST', '/sessions/:id/cancel', ({ id }, b) => {
  const s = activeSession(id);
  for (const i of s.items) { const p = db.products.find((x) => x._id === i.product); if (p && p.stock !== null) p.stock += i.qty; }
  s.status = 'cancelled'; s.endedAt = nowIso(); s.cancelReason = str(b?.reason, { max: 200 }); return { ok: true };
}, { admin: true });

// --- bills ---
route('GET', '/bills', (_, __, q) => {
  let list = db.bills;
  if (q.get('date')) { const r = dayRange(q.get('date'), settingsOf().billing.dayStartHour); list = list.filter((b) => inRange(b.createdAt, r)); }
  if (['unpaid', 'paid', 'void'].includes(q.get('status'))) list = list.filter((b) => b.status === q.get('status'));
  if (isId(q.get('player'))) list = list.filter((b) => b.player === q.get('player'));
  if (q.get('q')) { const rx = new RegExp(escapeRx(q.get('q').slice(0, 40)), 'i'); list = list.filter((b) => rx.test(b.code) || rx.test(b.customerName) || rx.test(b.tableName)); }
  return [...list].sort(byDateDesc('createdAt')).slice(0, 300).map((b) => ({ ...b, player: b.player ? playerLite(b.player, ['name', 'phone']) : null }));
});
route('GET', '/bills/:id', ({ id }) => billFull(find(db.bills, id, 'Bill')));
route('POST', '/bills/counter', (_, b, __, me) => {
  const lines = Array.isArray(b?.items) ? b.items.slice(0, 50) : [];
  if (!lines.length) throw bad('Add at least one item');
  const items = []; const taken = [];
  try {
    for (const l of lines) {
      const qty = num(l.qty, { min: 1, max: 100, int: true, label: 'Quantity' });
      const p = db.products.find((x) => x._id === l.productId && x.active);
      if (!p) throw notFound('Item');
      if (p.stock !== null && p.stock !== undefined) { if (p.stock < qty) throw bad(`Only ${p.stock} ${p.name} left in stock`); p.stock -= qty; taken.push([p, qty]); }
      items.push({ product: p._id, name: p.name, price: p.price, qty });
    }
  } catch (e) { for (const [p, qty] of taken) p.stock += qty; throw e; }
  const now = Date.now();
  const calc = computeBill({ mode: 'time', startedAt: now, endedAt: now, items }, settingsOf().billing, { discount: num(b.discount ?? 0, { max: 1e6, label: 'Discount' }), now });
  const player = isId(b.playerId) ? db.players.find((p) => p._id === b.playerId) : null;
  return newBill(db, { kind: 'counter', tableName: 'Counter', items: calc.items, itemsTotal: calc.itemsTotal, subTotal: calc.subTotal,
    discount: calc.discount, roundOff: calc.roundOff, total: calc.total, player: player?._id || null,
    customerName: player?.name || str(b.customerName, { max: 80 }) || 'Walk-in', createdBy: me._id });
});
route('PUT', '/bills/:id', ({ id }, b) => {
  const bill = db.bills.find((x) => x._id === id && x.status === 'unpaid');
  if (!bill) throw new HttpError(409, 'Only unpaid bills can be changed');
  if (b.discount !== undefined) {
    bill.discount = r2(Math.min(num(b.discount, { max: 1e6, label: 'Discount' }), bill.subTotal));
    const net = r2(bill.subTotal - bill.discount);
    bill.total = settingsOf().billing.roundTotal === false ? net : Math.round(net);
    bill.roundOff = r2(bill.total - net);
  }
  if (b.playerId !== undefined) { const p = isId(b.playerId) ? db.players.find((x) => x._id === b.playerId) : null; bill.player = p?._id || null; if (p) bill.customerName = p.name; }
  return billFull(bill);
});
route('POST', '/bills/:id/pay', ({ id }, b, _, me) => {
  const method = String(b?.method || '');
  if (![...PAY_METHODS, 'pass'].includes(method)) throw bad('Choose a payment method');
  const bill = find(db.bills, id, 'Bill');
  if (bill.status !== 'unpaid') throw new HttpError(409, `Bill is already ${bill.status}`);
  const paidAt = nowIso();
  if (method === 'pass') {
    if (!settingsOf().features.playerPass) throw bad('Player Pass is not enabled');
    const pid = isId(b?.playerId) ? b.playerId : bill.player;
    if (!pid) throw bad('Select the player whose pass should be charged');
    const p = db.players.find((x) => x._id === pid);
    if (!p || p.passBalance < bill.total) throw bad('Not enough pass balance');
    p.passBalance = r2(p.passBalance - bill.total);
    bill.player = p._id; if (!bill.customerName || bill.customerName === 'Walk-in') bill.customerName = p.name;
    db.passTxns.push({ _id: oid(), player: p._id, type: 'spend', amount: -bill.total, balanceAfter: p.passBalance, bill: bill._id, note: `Bill ${bill.code}`, by: me._id, createdAt: paidAt });
  }
  Object.assign(bill, { status: 'paid', paymentMethod: method, paidAt, paidBy: me._id });
  if (bill.player) { const p = db.players.find((x) => x._id === bill.player); if (p) { p.visits++; p.totalSpent = r2(p.totalSpent + bill.total); p.lastVisitAt = paidAt; } }
  return billFull(bill);
});
route('POST', '/bills/:id/void', ({ id }, b, _, me) => {
  const reason = str(b?.reason, { max: 200, required: true, label: 'Reason' });
  const bill = db.bills.find((x) => x._id === id && x.status !== 'void');
  if (!bill) throw new HttpError(409, 'Bill not found or already void');
  const wasPaid = bill.status === 'paid';
  bill.status = 'void'; bill.voidReason = reason;
  if (wasPaid && bill.player) {
    const p = db.players.find((x) => x._id === bill.player);
    if (p) {
      p.visits = Math.max(0, p.visits - 1); p.totalSpent = r2(p.totalSpent - bill.total);
      if (bill.paymentMethod === 'pass') {
        p.passBalance = r2(p.passBalance + bill.total);
        db.passTxns.push({ _id: oid(), player: p._id, type: 'refund', amount: bill.total, balanceAfter: p.passBalance, bill: bill._id, note: `Void ${bill.code}`, by: me._id, createdAt: nowIso() });
      }
    }
  }
  for (const i of bill.items) { const p = db.products.find((x) => x._id === i.product); if (p && p.stock !== null) p.stock += i.qty; }
  return billFull(bill);
}, { admin: true });

// --- players ---
const ensurePhoneFree = (ph, exceptId) => {
  if (!ph) return;
  const clash = db.players.find((p) => p.phone === ph && p._id !== exceptId);
  if (clash) throw bad(`This mobile number already belongs to ${clash.name}`);
};
route('GET', '/players', (_, __, q) => {
  let list = db.players.filter((p) => p.active);
  const term = String(q.get('q') || '').trim().slice(0, 40);
  if (term) { const rx = new RegExp(escapeRx(term), 'i'); list = list.filter((p) => rx.test(p.name) || rx.test(p.phone || '')); }
  const sort = q.get('sort');
  list = [...list].sort(sort === 'spent' ? (a, b) => b.totalSpent - a.totalSpent : sort === 'recent' ? byDateDesc('lastVisitAt') : (a, b) => a.name.localeCompare(b.name));
  const limit = Number(q.get('limit')) > 0 ? Math.min(Number(q.get('limit')), 500) : 500;
  return list.slice(0, limit);
});
route('POST', '/players', (_, b) => {
  const ph = phone(b.phone); ensurePhoneFree(ph);
  const p = { _id: oid(), name: str(b.name, { required: true, max: 60, label: 'Name' }), phone: ph || undefined, notes: str(b.notes, { max: 300 }),
    passBalance: 0, visits: 0, totalSpent: 0, lastVisitAt: null, active: true, createdAt: nowIso() };
  db.players.push(p); return p;
});
route('GET', '/players/:id', ({ id }) => {
  const p = find(db.players, id, 'Player');
  const bills = db.bills.filter((b) => b.player === id).sort(byDateDesc('createdAt')).slice(0, 50);
  const txns = db.passTxns.filter((t) => t.player === id).sort(byDateDesc('createdAt')).slice(0, 50).map((t) => ({ ...t, by: userLite(t.by) }));
  const due = r2(db.bills.filter((b) => b.player === id && b.status === 'unpaid').reduce((s, b) => s + b.total, 0));
  return { player: p, bills, txns, due };
});
route('PUT', '/players/:id', ({ id }, b) => {
  const p = find(db.players, id, 'Player');
  if (b.name !== undefined) p.name = str(b.name, { required: true, max: 60, label: 'Name' });
  if (b.phone !== undefined) { const ph = phone(b.phone); ensurePhoneFree(ph, p._id); p.phone = ph || undefined; }
  if (b.notes !== undefined) p.notes = str(b.notes, { max: 300 });
  return p;
});
route('DELETE', '/players/:id', ({ id }) => {
  const p = find(db.players, id, 'Player');
  if (p.passBalance > 0) throw bad('Player still has pass balance - settle it first');
  p.active = false; p.phone = undefined; return { ok: true };
}, { admin: true });
const passEnabled = () => { if (!settingsOf().features.playerPass) throw bad('Player Pass is not enabled'); };
route('POST', '/players/:id/topup', ({ id }, b, _, me) => {
  passEnabled();
  const amount = num(b?.amount, { min: 1, max: 100000, label: 'Amount' });
  const method = String(b?.method || '');
  if (!PAY_METHODS.includes(method)) throw bad('Choose how the top-up was paid');
  const p = db.players.find((x) => x._id === id && x.active);
  if (!p) throw notFound('Player');
  p.passBalance = r2(p.passBalance + amount);
  db.passTxns.push({ _id: oid(), player: p._id, type: 'topup', amount, balanceAfter: p.passBalance, method, note: str(b?.note, { max: 120 }), by: me._id, createdAt: nowIso() });
  return p;
});
route('POST', '/players/:id/adjust', ({ id }, b, _, me) => {
  passEnabled();
  const amount = Number(b?.amount);
  if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 100000) throw bad('Amount is invalid');
  const delta = r2(amount);
  const note = str(b?.note, { max: 120, required: true, label: 'Reason' });
  const p = find(db.players, id, 'Player');
  if (p.passBalance + delta < 0) throw bad('Balance cannot go below zero');
  p.passBalance = r2(p.passBalance + delta);
  db.passTxns.push({ _id: oid(), player: p._id, type: 'adjust', amount: delta, balanceAfter: p.passBalance, note, by: me._id, createdAt: nowIso() });
  return p;
}, { admin: true });

// --- tournaments ---
function tFields(b, t) {
  if (b.name !== undefined) t.name = str(b.name, { required: true, max: 80, label: 'Tournament name' });
  if (b.game !== undefined) t.game = str(b.game, { max: 40 }) || '8 Ball Pool';
  if (b.date !== undefined) { const d = b.date ? new Date(b.date) : null; if (d && Number.isNaN(d.getTime())) throw bad('Invalid date'); t.date = d ? d.toISOString() : null; }
  if (b.entryFee !== undefined) t.entryFee = num(b.entryFee, { max: 100000, label: 'Entry fee' });
  if (b.maxPlayers !== undefined) t.maxPlayers = num(b.maxPlayers, { max: 512, int: true, label: 'Max players' });
  if (b.prize !== undefined) t.prize = str(b.prize, { max: 200 });
  if (b.description !== undefined) t.description = str(b.description, { max: 1000 });
  if (b.status !== undefined && ['open', 'ongoing', 'completed'].includes(b.status)) t.status = b.status;
  return t;
}
const tour = (id) => find(db.tournaments, id, 'Tournament');
route('GET', '/tournaments', () => [...db.tournaments].sort(byDateDesc('date')).map((t) => {
  const lb = leaderboard(t);
  return { _id: t._id, name: t.name, game: t.game, date: t.date, entryFee: t.entryFee, maxPlayers: t.maxPlayers, status: t.status,
    registered: t.registrations.length, paidCount: t.registrations.filter((g) => g.paid).length, matches: t.matches.length, leader: lb[0]?.played ? lb[0].name : null };
}));
route('POST', '/tournaments', (_, b) => {
  const t = tFields(b, { _id: oid(), game: '8 Ball Pool', date: null, entryFee: 0, maxPlayers: 0, prize: '', description: '', status: 'open', registrations: [], matches: [], createdAt: nowIso() });
  if (!t.name) throw bad('Tournament name is required');
  db.tournaments.push(t); return adminView(t);
}, { admin: true });
route('GET', '/tournaments/:id', ({ id }) => adminView(tour(id)));
route('PUT', '/tournaments/:id', ({ id }, b) => { const t = tour(id); Object.assign(t, tFields(b, clone(t))); return adminView(t); }, { admin: true });
route('DELETE', '/tournaments/:id', ({ id }) => {
  const t = tour(id);
  if (t.registrations.some((g) => g.paid)) throw bad('Entry fees were collected - mark it completed instead of deleting');
  db.tournaments = db.tournaments.filter((x) => x._id !== id); return { ok: true };
}, { admin: true });
route('POST', '/tournaments/:id/registrations', ({ id }, b) => adminView(addRegistration(tour(id), b)));
route('POST', '/tournaments/:id/registrations/:regId/paid', ({ id, regId }, b, _, me) => {
  const t = tour(id);
  const g = find(t.registrations, regId, 'Registration');
  if (b?.paid !== false) {
    const method = String(b?.method || '');
    if (!PAY_METHODS.includes(method)) throw bad('Choose how the fee was paid');
    if (g.paid) throw new HttpError(409, 'Already marked paid');
    Object.assign(g, { paid: true, paidMethod: method, paidAmount: t.entryFee, paidAt: nowIso() });
  } else {
    if (me.role !== 'admin') throw new HttpError(403, 'Only the owner can undo a payment');
    Object.assign(g, { paid: false, paidMethod: null, paidAmount: 0, paidAt: null });
  }
  return adminView(t);
});
route('DELETE', '/tournaments/:id/registrations/:regId', ({ id, regId }) => {
  const t = tour(id);
  const g = find(t.registrations, regId, 'Registration');
  if (g.paid) throw bad('Undo the payment first');
  if (t.matches.some((m) => m.p1 === g._id || m.p2 === g._id)) throw bad('Player already has matches');
  t.registrations = t.registrations.filter((x) => x !== g); return adminView(t);
}, { admin: true });
route('POST', '/tournaments/:id/matches', ({ id }, b) => {
  const t = tour(id);
  const { p1, p2 } = b || {};
  if (!p1 || !p2 || p1 === p2 || !t.registrations.some((g) => g._id === p1) || !t.registrations.some((g) => g._id === p2)) throw bad('Pick two different players');
  t.matches.push({ _id: oid(), round: str(b?.round, { max: 30 }) || 'Round 1', p1, p2, score1: 0, score2: 0, status: 'scheduled', winner: null, createdAt: nowIso() });
  if (t.status === 'open') t.status = 'ongoing';
  return adminView(t);
}, { admin: true });
route('POST', '/tournaments/:id/draw', ({ id }, b) => {
  const t = tour(id);
  const round = str(b?.round, { max: 30 }) || 'Round 1';
  if (t.matches.some((m) => m.round === round)) throw bad(`${round} already has matches`);
  const pool = t.registrations.filter((g) => (b?.paidOnly ? g.paid : true)).map((g) => g._id);
  if (pool.length < 2) throw bad('Need at least 2 players for a draw');
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  for (let i = 0; i + 1 < pool.length; i += 2) t.matches.push({ _id: oid(), round, p1: pool[i], p2: pool[i + 1], score1: 0, score2: 0, status: 'scheduled', winner: null, createdAt: nowIso() });
  if (t.status === 'open') t.status = 'ongoing';
  const bye = pool.length % 2 ? t.registrations.find((g) => g._id === pool[pool.length - 1])?.name : null;
  return { ...adminView(t), bye };
}, { admin: true });
route('PUT', '/tournaments/:id/matches/:matchId', ({ id, matchId }, b) => {
  const t = tour(id);
  const m = find(t.matches, matchId, 'Match');
  if (b?.reset) Object.assign(m, { score1: 0, score2: 0, status: 'scheduled', winner: null });
  else {
    const s1 = num(b?.score1, { max: 99, int: true, label: 'Score' });
    const s2 = num(b?.score2, { max: 99, int: true, label: 'Score' });
    if (s1 === s2) throw bad('A match needs a winner - scores cannot be equal');
    Object.assign(m, { score1: s1, score2: s2, status: 'done', winner: s1 > s2 ? m.p1 : m.p2 });
  }
  return adminView(t);
});
route('DELETE', '/tournaments/:id/matches/:matchId', ({ id, matchId }) => {
  const t = tour(id); find(t.matches, matchId, 'Match');
  t.matches = t.matches.filter((m) => m._id !== matchId); return adminView(t);
}, { admin: true });

// --- waitlist ---
const waitlistOn = () => { if (!settingsOf().features.waitlist) throw bad('Waiting list is not enabled'); };
route('GET', '/waitlist', () => {
  waitlistOn();
  const since = Date.now() - 18 * 3600000;
  return db.waitlist.filter((w) => ['waiting', 'notified'].includes(w.status) || (w.closedAt && Date.parse(w.closedAt) >= since))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
});
route('POST', '/waitlist', (_, b) => {
  waitlistOn();
  const w = { _id: oid(), name: str(b.name, { required: true, max: 60, label: 'Name' }), phone: phone(b.phone),
    partySize: num(b.partySize ?? 2, { min: 1, max: 20, int: true, label: 'Players' }),
    tableType: ['snooker', 'pool'].includes(b.tableType) ? b.tableType : 'any', status: 'waiting', createdAt: nowIso() };
  db.waitlist.push(w); return w;
});
route('POST', '/waitlist/:id/status', ({ id }, b) => {
  waitlistOn();
  const w = find(db.waitlist, id, 'Entry');
  const status = String(b?.status || '');
  if (!['waiting', 'notified', 'seated', 'left'].includes(status)) throw bad('Invalid status');
  w.status = status;
  if (status === 'notified') w.notifiedAt = nowIso();
  w.closedAt = ['seated', 'left'].includes(status) ? nowIso() : null;
  return w;
});

// --- reports (owner) ---
const METHODS = ['cash', 'upi', 'card', 'pass'];
const feesBetween = (r) => db.tournaments.flatMap((t) => t.registrations.filter((g) => g.paid && inRange(g.paidAt, r))
  .map((g) => ({ name: t.name, amount: g.paidAmount, method: g.paidMethod, at: g.paidAt, player: g.name })));
const roundAll = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? r2(v) : v]));
route('GET', '/reports/daily', (_, __, q) => {
  const h = settingsOf().billing.dayStartHour;
  const date = String(q.get('date') || businessDate(new Date(), h));
  const r = dayRange(date, h);
  const paid = db.bills.filter((b) => b.status === 'paid' && inRange(b.paidAt, r)).sort((a, b) => new Date(a.paidAt) - new Date(b.paidAt));
  const unpaidToday = db.bills.filter((b) => b.status === 'unpaid' && inRange(b.createdAt, r));
  const outstandingList = db.bills.filter((b) => b.status === 'unpaid');
  const topups = db.passTxns.filter((t) => t.type === 'topup' && inRange(t.createdAt, r));
  const fees = feesBetween(r);
  const sales = { total: 0, tableCharge: 0, snacks: 0, discount: 0, count: paid.length, byMethod: Object.fromEntries(METHODS.map((m) => [m, 0])) };
  const tables = new Map(); const items = new Map(); let playedMinutes = 0;
  for (const b of paid) {
    sales.total += b.total; sales.tableCharge += b.tableCharge; sales.snacks += b.itemsTotal; sales.discount += b.discount;
    sales.byMethod[b.paymentMethod] += b.total; playedMinutes += b.playedMinutes || 0;
    if (b.kind === 'table') {
      const t = tables.get(b.tableName) || { name: b.tableName, bills: 0, minutes: 0, frames: 0, tableCharge: 0, total: 0 };
      t.bills++; t.minutes += b.playedMinutes || 0; t.frames += b.frames || 0; t.tableCharge += b.tableCharge; t.total += b.total; tables.set(b.tableName, t);
    }
    for (const i of b.items) { const it = items.get(i.name) || { name: i.name, qty: 0, amount: 0 }; it.qty += i.qty; it.amount += i.amount ?? i.price * i.qty; items.set(i.name, it); }
  }
  const collected = { cash: sales.byMethod.cash, upi: sales.byMethod.upi, card: sales.byMethod.card };
  const topupTotal = { total: 0, cash: 0, upi: 0, card: 0 };
  for (const t of topups) { topupTotal.total += t.amount; topupTotal[t.method] += t.amount; collected[t.method] += t.amount; }
  const feeTotal = { total: 0, cash: 0, upi: 0, card: 0 };
  for (const f of fees) { feeTotal.total += f.amount; feeTotal[f.method] += f.amount; collected[f.method] += f.amount; }
  return {
    date, from: r[0], to: r[1],
    sales: { ...roundAll(sales), byMethod: roundAll(sales.byMethod) },
    collected: { ...roundAll(collected), total: r2(collected.cash + collected.upi + collected.card) },
    topups: roundAll(topupTotal), tournamentFees: roundAll(feeTotal),
    unpaid: { count: unpaidToday.length, total: r2(unpaidToday.reduce((s, b) => s + b.total, 0)) },
    outstanding: { count: outstandingList.length, total: r2(outstandingList.reduce((s, b) => s + b.total, 0)) },
    voided: db.bills.filter((b) => b.status === 'void' && inRange(b.createdAt, r)).length,
    sessions: db.sessions.filter((s) => s.status !== 'cancelled' && inRange(s.startedAt, r)).length,
    playedMinutes,
    tables: [...tables.values()].map(roundAll).sort((a, b) => b.total - a.total),
    items: [...items.values()].map(roundAll).sort((a, b) => b.amount - a.amount),
    bills: paid.map((b) => ({ _id: b._id, code: b.code, tableName: b.tableName, customerName: b.customerName, tableCharge: b.tableCharge,
      itemsTotal: b.itemsTotal, discount: b.discount, total: b.total, paymentMethod: b.paymentMethod, paidAt: b.paidAt })),
    topupList: topups.map((t) => ({ player: db.players.find((p) => p._id === t.player)?.name || '-', amount: t.amount, method: t.method, at: t.createdAt })),
    feeList: fees.map((f) => ({ tournament: f.name, player: f.player, amount: f.amount, method: f.method, at: f.at })),
  };
}, { admin: true });
route('GET', '/reports/range', (_, __, q) => {
  const h = settingsOf().billing.dayStartHour;
  const [from] = dayRange(String(q.get('from')), h);
  const [, to] = dayRange(String(q.get('to')), h);
  const days = Math.round((to - from) / 86400000);
  if (days < 1 || days > 92) throw bad('Choose a range of 1 to 92 days');
  const r = [from, to];
  const rows = new Map();
  for (let i = 0; i < days; i++) {
    const d = businessDate(new Date(from.getTime() + i * 86400000), h);
    rows.set(d, { date: d, bills: 0, sales: 0, tableCharge: 0, snacks: 0, passSpend: 0, topups: 0, fees: 0, collected: 0 });
  }
  for (const b of db.bills.filter((x) => x.status === 'paid' && inRange(x.paidAt, r))) {
    const row = rows.get(businessDate(b.paidAt, h)); if (!row) continue;
    row.bills++; row.sales += b.total; row.tableCharge += b.tableCharge; row.snacks += b.itemsTotal;
    if (b.paymentMethod === 'pass') row.passSpend += b.total; else row.collected += b.total;
  }
  for (const t of db.passTxns.filter((x) => x.type === 'topup' && inRange(x.createdAt, r))) { const row = rows.get(businessDate(t.createdAt, h)); if (row) { row.topups += t.amount; row.collected += t.amount; } }
  for (const f of feesBetween(r)) { const row = rows.get(businessDate(f.at, h)); if (row) { row.fees += f.amount; row.collected += f.amount; } }
  const list = [...rows.values()].map(roundAll);
  const sum = (k) => r2(list.reduce((s, x) => s + x[k], 0));
  return { from: q.get('from'), to: q.get('to'), days: list,
    totals: { bills: sum('bills'), sales: sum('sales'), tableCharge: sum('tableCharge'), snacks: sum('snacks'), passSpend: sum('passSpend'), topups: sum('topups'), fees: sum('fees'), collected: sum('collected') } };
}, { admin: true });

// ---------- entry point used by api.js ----------
export async function demoRequest(path, { method = 'GET', body, token } = {}) {
  await new Promise((r) => setTimeout(r, 60)); // feel like a network call
  getDb();
  const url = new URL(path, 'http://demo.local');
  const match = routes.map((r) => ({ r, m: r.method === method && url.pathname.match(r.rx) })).find((x) => x.m);
  if (!match) return { status: 404, data: { error: 'Not found' } };
  const { r, m } = match;
  const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
  try {
    let me = null;
    if (!r.open) {
      const uid = String(token || '').startsWith('demo.') ? token.slice(5) : '';
      me = db.users.find((u) => u._id === uid && u.active);
      if (!me) throw new HttpError(401, 'Please log in');
      if (r.admin && me.role !== 'admin') throw new HttpError(403, 'Only the owner can do this');
    }
    const snapshot = method === 'GET' ? null : JSON.stringify(db);
    try {
      const out = r.handler(params, clone(body) || {}, url.searchParams, me);
      if (method !== 'GET') save();
      return { status: method === 'POST' && /^\/(sessions|players|tables|products|users|tournaments|waitlist|bills\/counter)$/.test(url.pathname) ? 201 : 200, data: clone(out) };
    } catch (e) {
      if (snapshot) db = JSON.parse(snapshot); // roll back half-done changes, like a DB transaction
      throw e;
    }
  } catch (e) {
    return { status: e.status || 500, data: { error: e.message || 'Something went wrong' } };
  }
}
