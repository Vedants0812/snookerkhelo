// Player list + Player Pass (prepaid balance).
import { Router } from 'express';
import { Player, PassTxn, Bill, getSettings } from '../models.js';
import { auth, adminOnly, bad, notFound, needId, str, num, phone, escapeRx, PAY_METHODS } from '../lib.js';
import { r2 } from '../../../shared/billing.js';

const r = Router();
r.use(auth);

async function ensurePhoneFree(ph, exceptId) {
  if (!ph) return;
  const clash = await Player.findOne({ phone: ph, _id: { $ne: exceptId } }).select('name');
  if (clash) throw bad(`This mobile number already belongs to ${clash.name}`);
}

r.get('/players', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 40);
  const filter = { active: true };
  if (q) {
    const rx = new RegExp(escapeRx(q), 'i');
    filter.$or = [{ name: rx }, { phone: rx }];
  }
  const sort = req.query.sort === 'spent' ? { totalSpent: -1 } : req.query.sort === 'recent' ? { lastVisitAt: -1 } : { name: 1 };
  res.json(await Player.find(filter).sort(sort).limit(Number(req.query.limit) > 0 ? Math.min(Number(req.query.limit), 500) : 500));
});

r.post('/players', async (req, res) => {
  const b = req.body || {};
  const ph = phone(b.phone);
  await ensurePhoneFree(ph);
  const p = await Player.create({
    name: str(b.name, { required: true, max: 60, label: 'Name' }),
    phone: ph || undefined,
    notes: str(b.notes, { max: 300 }),
  });
  res.status(201).json(p);
});

r.get('/players/:id', async (req, res) => {
  const p = await Player.findById(needId(req.params.id, 'Player'));
  if (!p) throw notFound('Player');
  const [bills, txns, due] = await Promise.all([
    Bill.find({ player: p._id }).sort({ createdAt: -1 }).limit(50),
    PassTxn.find({ player: p._id }).sort({ createdAt: -1 }).limit(50).populate('by', 'name'),
    Bill.aggregate([{ $match: { player: p._id, status: 'unpaid' } }, { $group: { _id: null, total: { $sum: '$total' } } }]),
  ]);
  res.json({ player: p, bills, txns, due: due[0]?.total || 0 });
});

r.put('/players/:id', async (req, res) => {
  const p = await Player.findById(needId(req.params.id, 'Player'));
  if (!p) throw notFound('Player');
  const b = req.body || {};
  if (b.name !== undefined) p.name = str(b.name, { required: true, max: 60, label: 'Name' });
  if (b.phone !== undefined) {
    const ph = phone(b.phone);
    await ensurePhoneFree(ph, p._id);
    p.phone = ph || undefined;
  }
  if (b.notes !== undefined) p.notes = str(b.notes, { max: 300 });
  await p.save();
  res.json(p);
});

r.delete('/players/:id', adminOnly, async (req, res) => {
  const p = await Player.findById(needId(req.params.id, 'Player'));
  if (!p) throw notFound('Player');
  if (p.passBalance > 0) throw bad('Player still has pass balance - settle it first');
  p.active = false;
  p.phone = undefined; // free the number for re-use
  await p.save();
  res.json({ ok: true });
});

// ----- Player Pass -----
async function passEnabled() {
  if (!(await getSettings()).features.playerPass) throw bad('Player Pass is not enabled');
}

r.post('/players/:id/topup', async (req, res) => {
  await passEnabled();
  const amount = num(req.body?.amount, { min: 1, max: 100000, label: 'Amount' });
  const method = String(req.body?.method || '');
  if (!PAY_METHODS.includes(method)) throw bad('Choose how the top-up was paid');
  const p = await Player.findOneAndUpdate({ _id: needId(req.params.id, 'Player'), active: true },
    { $inc: { passBalance: amount } }, { new: true });
  if (!p) throw notFound('Player');
  await PassTxn.create({ player: p._id, type: 'topup', amount, balanceAfter: r2(p.passBalance), method,
    note: str(req.body?.note, { max: 120 }), by: req.user._id });
  res.json(p);
});

// Manual correction (owner): positive or negative, never below zero. Not counted as money received.
r.post('/players/:id/adjust', adminOnly, async (req, res) => {
  await passEnabled();
  const amount = Number(req.body?.amount);
  if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 100000) throw bad('Amount is invalid');
  const delta = r2(amount);
  const note = str(req.body?.note, { max: 120, required: true, label: 'Reason' });
  const p = await Player.findOneAndUpdate(
    { _id: needId(req.params.id, 'Player'), passBalance: { $gte: delta < 0 ? -delta : 0 } },
    { $inc: { passBalance: delta } }, { new: true });
  if (!p) throw bad('Balance cannot go below zero');
  await PassTxn.create({ player: p._id, type: 'adjust', amount: delta, balanceAfter: r2(p.passBalance), note, by: req.user._id });
  res.json(p);
});

export default r;
