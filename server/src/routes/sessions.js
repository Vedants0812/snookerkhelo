// Table sessions: start, pause/resume, frames, snacks, stop -> bill.
import { Router } from 'express';
import { Session, Table, Product, Player, Bill, getSettings, nextSeq } from '../models.js';
import { auth, adminOnly, bad, notFound, needId, isId, str, num, HttpError } from '../lib.js';
import { computeBill, isPaused } from '../../../shared/billing.js';

const r = Router();
r.use(auth);

const withPlayers = (q) => q.populate('players', 'name phone passBalance');

async function activeSession(id) {
  const s = await Session.findOne({ _id: needId(id, 'Session'), status: 'active' });
  if (!s) throw new HttpError(409, 'This session is not running any more');
  return s;
}

async function resolvePlayers(ids) {
  if (!Array.isArray(ids)) return [];
  const clean = [...new Set(ids.filter(isId))].slice(0, 8);
  const found = await Player.find({ _id: { $in: clean }, active: true }).select('_id name');
  // Keep the order they were picked in: the first player is the one the bill is filed under.
  const byId = new Map(found.map((p) => [String(p._id), p]));
  return clean.map((id) => byId.get(id)).filter(Boolean);
}

export function customerLabel(players, fallback) {
  const names = players.map((p) => p.name).join(', ');
  return names || fallback || 'Walk-in';
}

/** Build + save a bill document from computed totals. */
export async function createBill(fields) {
  const billNo = await nextSeq('bill');
  return Bill.create({ ...fields, billNo, code: `B-${String(billNo).padStart(5, '0')}` });
}

// ----- start -----
r.post('/sessions', async (req, res) => {
  const b = req.body || {};
  const table = await Table.findOne({ _id: needId(b.tableId, 'Table'), active: true });
  if (!table) throw notFound('Table');
  const mode = b.mode === 'frame' ? 'frame' : b.mode === 'time' ? 'time' : table.defaultMode;
  if (mode === 'time' && !(table.ratePerHour > 0)) throw bad('This table has no hourly rate');
  if (mode === 'frame' && !(table.ratePerFrame > 0)) throw bad('This table has no per-frame rate');
  const players = await resolvePlayers(b.playerIds);
  try {
    const s = await Session.create({
      table: table._id, tableName: table.name, mode,
      ratePerHour: table.ratePerHour, ratePerFrame: table.ratePerFrame,
      players: players.map((p) => p._id),
      customerName: str(b.customerName, { max: 80 }),
      startedAt: new Date(), startedBy: req.user._id,
    });
    res.status(201).json(await withPlayers(Session.findById(s._id)));
  } catch (e) {
    if (e?.code === 11000) throw new HttpError(409, `${table.name} is already running`);
    throw e;
  }
});

r.get('/sessions/:id', async (req, res) => {
  const s = await withPlayers(Session.findById(needId(req.params.id, 'Session')));
  if (!s) throw notFound('Session');
  res.json(s);
});

// ----- edit players / walk-in name -----
r.put('/sessions/:id', async (req, res) => {
  const s = await activeSession(req.params.id);
  const b = req.body || {};
  if (b.playerIds !== undefined) s.players = (await resolvePlayers(b.playerIds)).map((p) => p._id);
  if (b.customerName !== undefined) s.customerName = str(b.customerName, { max: 80 });
  await s.save();
  res.json(await withPlayers(Session.findById(s._id)));
});

// ----- pause / resume -----
r.post('/sessions/:id/pause', async (req, res) => {
  const s = await activeSession(req.params.id);
  if (!isPaused(s)) { s.pauses.push({ from: new Date() }); await s.save(); }
  res.json(await withPlayers(Session.findById(s._id)));
});

r.post('/sessions/:id/resume', async (req, res) => {
  const s = await activeSession(req.params.id);
  const open = s.pauses.find((p) => !p.to);
  if (open) { open.to = new Date(); await s.save(); }
  res.json(await withPlayers(Session.findById(s._id)));
});

// ----- frame counter -----
r.post('/sessions/:id/frames', async (req, res) => {
  const delta = Number(req.body?.delta);
  if (![1, -1].includes(delta)) throw bad('Invalid frame change');
  const filter = { _id: needId(req.params.id, 'Session'), status: 'active' };
  if (delta < 0) filter.frames = { $gt: 0 };
  const s = await withPlayers(Session.findOneAndUpdate(filter, { $inc: { frames: delta } }, { new: true }));
  if (!s) throw new HttpError(409, 'Could not change frames');
  res.json(s);
});

// ----- snacks: qty is a delta (+1 / -1 / +n) -----
r.post('/sessions/:id/items', async (req, res) => {
  const s = await activeSession(req.params.id);
  const delta = num(req.body?.qty ?? 1, { min: -100, max: 100, int: true, label: 'Quantity' });
  if (!delta) throw bad('Quantity is invalid');
  const product = await Product.findById(needId(req.body?.productId, 'Item'));
  if (!product) throw notFound('Item');

  const line = s.items.find((i) => String(i.product) === String(product._id));
  const current = line ? line.qty : 0;
  const next = Math.max(0, current + delta);
  const change = next - current;
  if (change === 0) return res.json(await withPlayers(Session.findById(s._id)));
  if (change > 0 && !product.active) throw bad('Item is not available');

  if (product.stock !== null && product.stock !== undefined) {
    // Atomic stock movement so two counters cannot oversell the last packet.
    const ok = await Product.findOneAndUpdate(
      change > 0 ? { _id: product._id, stock: { $gte: change } } : { _id: product._id },
      { $inc: { stock: -change } },
    );
    if (!ok) throw bad(`Only ${product.stock} ${product.name} left in stock`);
  }
  if (!line) s.items.push({ product: product._id, name: product.name, price: product.price, qty: next });
  else if (next === 0) s.items = s.items.filter((i) => i !== line);
  else line.qty = next;
  await s.save();
  res.json(await withPlayers(Session.findById(s._id)));
});

// ----- stop & generate bill -----
r.post('/sessions/:id/stop', async (req, res) => {
  const b = req.body || {};
  const discount = num(b.discount ?? 0, { max: 1e6, label: 'Discount' });
  const now = new Date();
  const id = needId(req.params.id, 'Session');

  const pre = await Session.findOne({ _id: id, status: 'active' });
  if (!pre) throw new HttpError(409, 'This session is already stopped');
  if (pre.mode === 'frame' && b.frames !== undefined) {
    pre.frames = num(b.frames, { max: 500, int: true, label: 'Frames' });
  }
  if (pre.mode === 'frame' && pre.frames < 1 && !pre.items.length) throw bad('Enter the number of frames played');
  const open = pre.pauses.find((p) => !p.to);
  if (open) open.to = now;

  // Atomically claim the session so a double tap cannot create two bills.
  const s = await Session.findOneAndUpdate(
    { _id: id, status: 'active' },
    { status: 'closed', endedAt: now, frames: pre.frames, pauses: pre.pauses },
    { new: true },
  ).populate('players', 'name');
  if (!s) throw new HttpError(409, 'This session is already stopped');

  try {
    const settings = await getSettings();
    const calc = computeBill(s.toObject(), settings.billing, { discount, now });
    const bill = await createBill({
      kind: 'table', session: s._id, table: s.table, tableName: s.tableName,
      mode: calc.mode, rate: calc.rate, startedAt: s.startedAt, endedAt: now,
      playedMinutes: calc.playedMinutes, billedMinutes: calc.billedMinutes, frames: calc.frames,
      tableCharge: calc.tableCharge, items: calc.items, itemsTotal: calc.itemsTotal,
      subTotal: calc.subTotal, discount: calc.discount, roundOff: calc.roundOff, total: calc.total,
      player: s.players[0]?._id, customerName: customerLabel(s.players, s.customerName),
      createdBy: req.user._id,
    });
    s.bill = bill._id;
    await s.save();
    res.status(201).json(bill);
  } catch (e) {
    await Session.updateOne({ _id: id }, { status: 'active', $unset: { endedAt: 1 } }); // roll back
    throw e;
  }
});

// ----- cancel without billing (started by mistake) -----
r.post('/sessions/:id/cancel', adminOnly, async (req, res) => {
  const s = await activeSession(req.params.id);
  for (const i of s.items) {
    if (i.product) await Product.updateOne({ _id: i.product, stock: { $ne: null } }, { $inc: { stock: i.qty } });
  }
  s.status = 'cancelled';
  s.endedAt = new Date();
  s.cancelReason = str(req.body?.reason, { max: 200 });
  await s.save();
  res.json({ ok: true });
});

export default r;
