// Tournaments: admin management + public registration / leaderboard page.
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { Tournament, Player, getSettings } from '../models.js';
import { auth, adminOnly, bad, notFound, needId, isId, str, num, phone, HttpError, PAY_METHODS } from '../lib.js';

const WIN_POINTS = 2;

export function leaderboard(t) {
  const rows = new Map(t.registrations.map((g) => [String(g._id), {
    id: String(g._id), name: g.name, played: 0, won: 0, lost: 0, framesFor: 0, framesAgainst: 0, points: 0,
  }]));
  for (const m of t.matches) {
    if (m.status !== 'done') continue;
    const a = rows.get(String(m.p1)); const b = rows.get(String(m.p2));
    if (!a || !b) continue;
    a.played++; b.played++;
    a.framesFor += m.score1; a.framesAgainst += m.score2;
    b.framesFor += m.score2; b.framesAgainst += m.score1;
    const w = String(m.winner) === a.id ? a : b; const l = w === a ? b : a;
    w.won++; w.points += WIN_POINTS; l.lost++;
  }
  return [...rows.values()]
    .map((x) => ({ ...x, diff: x.framesFor - x.framesAgainst }))
    .sort((x, y) => y.points - x.points || y.diff - x.diff || y.framesFor - x.framesFor || x.name.localeCompare(y.name))
    .map((x, i) => ({ rank: i + 1, ...x }));
}

const maskPhone = (p) => (p ? `${p.slice(0, 2)}******${p.slice(-2)}` : '');

function publicView(t) {
  const names = new Map(t.registrations.map((g) => [String(g._id), g.name]));
  return {
    id: t._id, name: t.name, game: t.game, date: t.date, entryFee: t.entryFee, maxPlayers: t.maxPlayers,
    prize: t.prize, description: t.description, status: t.status,
    registered: t.registrations.length,
    full: t.maxPlayers > 0 && t.registrations.length >= t.maxPlayers,
    players: t.registrations.map((g) => ({ name: g.name, phone: maskPhone(g.phone), paid: g.paid })),
    matches: t.matches.map((m) => ({
      round: m.round, p1: names.get(String(m.p1)) || '?', p2: names.get(String(m.p2)) || '?',
      score1: m.score1, score2: m.score2, status: m.status,
      winner: m.winner ? names.get(String(m.winner)) : null,
    })),
    leaderboard: leaderboard(t),
  };
}

const adminView = (t) => ({ ...t.toObject(), leaderboard: leaderboard(t) });

async function addRegistration(t, body) {
  if (t.status !== 'open') throw bad('Registration is closed for this tournament');
  if (t.maxPlayers > 0 && t.registrations.length >= t.maxPlayers) throw bad('Tournament is full');
  const name = str(body?.name, { required: true, max: 60, label: 'Name' });
  const ph = phone(body?.phone, { required: true });
  if (t.registrations.some((g) => g.phone === ph)) throw bad('This mobile number is already registered');
  // Link to (or create) the player record so the parlour's player list grows by itself.
  let player = await Player.findOne({ phone: ph });
  if (!player) player = await Player.create({ name, phone: ph });
  // $push with a size guard keeps maxPlayers correct under simultaneous sign-ups.
  const guard = { _id: t._id, status: 'open', 'registrations.phone': { $ne: ph } };
  if (t.maxPlayers > 0) guard[`registrations.${t.maxPlayers - 1}`] = { $exists: false };
  const updated = await Tournament.findOneAndUpdate(guard,
    { $push: { registrations: { name, phone: ph, player: player._id } } }, { new: true });
  if (!updated) throw bad('Could not register - tournament is full or number already registered');
  return updated;
}

// ================= public (no login) =================
export const publicRouter = Router();

publicRouter.get('/info', async (_req, res) => {
  const s = await getSettings();
  res.json({ shopName: s.shopName, address: s.address, phone: s.phone, googleMapsLink: s.googleMapsLink });
});

publicRouter.get('/tournaments', async (_req, res) => {
  const list = await Tournament.find().sort({ date: -1, createdAt: -1 }).limit(50);
  res.json(list.map((t) => { const v = publicView(t); delete v.players; delete v.matches; v.leaderboard = v.leaderboard.slice(0, 3); return v; }));
});

publicRouter.get('/tournaments/:id', async (req, res) => {
  const t = await Tournament.findById(needId(req.params.id, 'Tournament'));
  if (!t) throw notFound('Tournament');
  res.json(publicView(t));
});

const registerLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 15, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many registrations from this device. Please try later.' } });

publicRouter.post('/tournaments/:id/register', registerLimiter, async (req, res) => {
  const t = await Tournament.findById(needId(req.params.id, 'Tournament'));
  if (!t) throw notFound('Tournament');
  res.status(201).json(publicView(await addRegistration(t, req.body)));
});

// ================= admin =================
const r = Router();
r.use(auth);

function fields(b, t = {}) {
  if (b.name !== undefined) t.name = str(b.name, { required: true, max: 80, label: 'Tournament name' });
  if (b.game !== undefined) t.game = str(b.game, { max: 40 }) || '8 Ball Pool';
  if (b.date !== undefined) {
    const d = b.date ? new Date(b.date) : null;
    if (d && Number.isNaN(d.getTime())) throw bad('Invalid date');
    t.date = d;
  }
  if (b.entryFee !== undefined) t.entryFee = num(b.entryFee, { max: 100000, label: 'Entry fee' });
  if (b.maxPlayers !== undefined) t.maxPlayers = num(b.maxPlayers, { max: 512, int: true, label: 'Max players' });
  if (b.prize !== undefined) t.prize = str(b.prize, { max: 200 });
  if (b.description !== undefined) t.description = str(b.description, { max: 1000 });
  if (b.status !== undefined && ['open', 'ongoing', 'completed'].includes(b.status)) t.status = b.status;
  return t;
}

async function load(id) {
  const t = await Tournament.findById(needId(id, 'Tournament'));
  if (!t) throw notFound('Tournament');
  return t;
}

r.get('/tournaments', async (_req, res) => {
  const list = await Tournament.find().sort({ date: -1, createdAt: -1 });
  res.json(list.map((t) => ({
    _id: t._id, name: t.name, game: t.game, date: t.date, entryFee: t.entryFee, maxPlayers: t.maxPlayers,
    status: t.status, registered: t.registrations.length, paidCount: t.registrations.filter((g) => g.paid).length,
    matches: t.matches.length, leader: leaderboard(t)[0]?.played ? leaderboard(t)[0].name : null,
  })));
});

r.post('/tournaments', adminOnly, async (req, res) => {
  const data = fields(req.body || {});
  if (!data.name) throw bad('Tournament name is required');
  res.status(201).json(adminView(await Tournament.create(data)));
});

r.get('/tournaments/:id', async (req, res) => res.json(adminView(await load(req.params.id))));

r.put('/tournaments/:id', adminOnly, async (req, res) => {
  const t = await load(req.params.id);
  fields(req.body || {}, t);
  await t.save();
  res.json(adminView(t));
});

r.delete('/tournaments/:id', adminOnly, async (req, res) => {
  const t = await load(req.params.id);
  if (t.registrations.some((g) => g.paid)) throw bad('Entry fees were collected - mark it completed instead of deleting');
  await t.deleteOne();
  res.json({ ok: true });
});

// ----- registrations -----
r.post('/tournaments/:id/registrations', async (req, res) => {
  res.status(201).json(adminView(await addRegistration(await load(req.params.id), req.body)));
});

r.post('/tournaments/:id/registrations/:regId/paid', async (req, res) => {
  const t = await load(req.params.id);
  const g = t.registrations.id(needId(req.params.regId, 'Registration'));
  if (!g) throw notFound('Registration');
  const paid = req.body?.paid !== false;
  if (paid) {
    const method = String(req.body?.method || '');
    if (!PAY_METHODS.includes(method)) throw bad('Choose how the fee was paid');
    if (g.paid) throw new HttpError(409, 'Already marked paid');
    Object.assign(g, { paid: true, paidMethod: method, paidAmount: t.entryFee, paidAt: new Date() });
  } else {
    if (req.user.role !== 'admin') throw new HttpError(403, 'Only the owner can undo a payment');
    Object.assign(g, { paid: false, paidMethod: null, paidAmount: 0, paidAt: undefined });
  }
  await t.save();
  res.json(adminView(t));
});

r.delete('/tournaments/:id/registrations/:regId', adminOnly, async (req, res) => {
  const t = await load(req.params.id);
  const g = t.registrations.id(needId(req.params.regId, 'Registration'));
  if (!g) throw notFound('Registration');
  if (g.paid) throw bad('Undo the payment first');
  if (t.matches.some((m) => String(m.p1) === String(g._id) || String(m.p2) === String(g._id))) throw bad('Player already has matches');
  g.deleteOne();
  await t.save();
  res.json(adminView(t));
});

// ----- matches -----
r.post('/tournaments/:id/matches', adminOnly, async (req, res) => {
  const t = await load(req.params.id);
  const { p1, p2 } = req.body || {};
  if (!isId(p1) || !isId(p2) || p1 === p2 || !t.registrations.id(p1) || !t.registrations.id(p2)) throw bad('Pick two different players');
  t.matches.push({ round: str(req.body?.round, { max: 30 }) || 'Round 1', p1, p2 });
  if (t.status === 'open') t.status = 'ongoing';
  await t.save();
  res.status(201).json(adminView(t));
});

// Random draw: pairs every registered player (optionally only fee-paid ones) for a round.
r.post('/tournaments/:id/draw', adminOnly, async (req, res) => {
  const t = await load(req.params.id);
  const round = str(req.body?.round, { max: 30 }) || 'Round 1';
  if (t.matches.some((m) => m.round === round)) throw bad(`${round} already has matches`);
  let pool = t.registrations.filter((g) => (req.body?.paidOnly ? g.paid : true)).map((g) => g._id);
  if (pool.length < 2) throw bad('Need at least 2 players for a draw');
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  for (let i = 0; i + 1 < pool.length; i += 2) t.matches.push({ round, p1: pool[i], p2: pool[i + 1] });
  if (t.status === 'open') t.status = 'ongoing';
  await t.save();
  const bye = pool.length % 2 ? t.registrations.id(pool[pool.length - 1])?.name : null;
  res.status(201).json({ ...adminView(t), bye });
});

r.put('/tournaments/:id/matches/:matchId', async (req, res) => {
  const t = await load(req.params.id);
  const m = t.matches.id(needId(req.params.matchId, 'Match'));
  if (!m) throw notFound('Match');
  if (req.body?.reset) {
    Object.assign(m, { score1: 0, score2: 0, status: 'scheduled', winner: undefined });
  } else {
    const s1 = num(req.body?.score1, { max: 99, int: true, label: 'Score' });
    const s2 = num(req.body?.score2, { max: 99, int: true, label: 'Score' });
    if (s1 === s2) throw bad('A match needs a winner - scores cannot be equal');
    Object.assign(m, { score1: s1, score2: s2, status: 'done', winner: s1 > s2 ? m.p1 : m.p2 });
  }
  await t.save();
  res.json(adminView(t));
});

r.delete('/tournaments/:id/matches/:matchId', adminOnly, async (req, res) => {
  const t = await load(req.params.id);
  const m = t.matches.id(needId(req.params.matchId, 'Match'));
  if (!m) throw notFound('Match');
  m.deleteOne();
  await t.save();
  res.json(adminView(t));
});

export default r;
