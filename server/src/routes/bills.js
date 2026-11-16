// Bills: list, view, pay, discount, void, counter (snack-only) sales.
import { Router } from 'express';
import { Bill, Player, PassTxn, Product, getSettings } from '../models.js';
import { auth, adminOnly, bad, notFound, needId, isId, str, num, dayRange, escapeRx, HttpError, PAY_METHODS } from '../lib.js';
import { computeBill, r2 } from '../../../shared/billing.js';
import { createBill } from './sessions.js';

const r = Router();
r.use(auth);

const full = (q) => q.populate('player', 'name phone passBalance').populate('createdBy', 'name').populate('paidBy', 'name');

r.get('/bills', async (req, res) => {
  const { date, status, q, player } = req.query;
  const filter = {};
  if (date) {
    const s = await getSettings();
    const [from, to] = dayRange(String(date), s.billing.dayStartHour);
    filter.createdAt = { $gte: from, $lt: to };
  }
  if (['unpaid', 'paid', 'void'].includes(status)) filter.status = status;
  if (isId(player)) filter.player = player;
  if (q) {
    const rx = new RegExp(escapeRx(String(q).slice(0, 40)), 'i');
    filter.$or = [{ code: rx }, { customerName: rx }, { tableName: rx }];
  }
  res.json(await Bill.find(filter).sort({ createdAt: -1 }).limit(300).populate('player', 'name phone'));
});

r.get('/bills/:id', async (req, res) => {
  const bill = await full(Bill.findById(needId(req.params.id, 'Bill')));
  if (!bill) throw notFound('Bill');
  res.json(bill);
});

// Counter sale: snacks without a table session.
r.post('/bills/counter', async (req, res) => {
  const b = req.body || {};
  const lines = Array.isArray(b.items) ? b.items.slice(0, 50) : [];
  if (!lines.length) throw bad('Add at least one item');
  const items = [];
  const taken = [];
  try {
    for (const l of lines) {
      const qty = num(l.qty, { min: 1, max: 100, int: true, label: 'Quantity' });
      const p = await Product.findOne({ _id: needId(l.productId, 'Item'), active: true });
      if (!p) throw notFound('Item');
      if (p.stock !== null && p.stock !== undefined) {
        const ok = await Product.findOneAndUpdate({ _id: p._id, stock: { $gte: qty } }, { $inc: { stock: -qty } });
        if (!ok) throw bad(`Only ${p.stock} ${p.name} left in stock`);
        taken.push([p._id, qty]);
      }
      items.push({ product: p._id, name: p.name, price: p.price, qty });
    }
    const settings = await getSettings();
    const now = new Date();
    const calc = computeBill({ mode: 'time', startedAt: now, endedAt: now, items }, settings.billing,
      { discount: num(b.discount ?? 0, { max: 1e6, label: 'Discount' }), now });
    const player = isId(b.playerId) ? await Player.findById(b.playerId).select('name') : null;
    const bill = await createBill({
      kind: 'counter', tableName: 'Counter', items: calc.items, itemsTotal: calc.itemsTotal,
      subTotal: calc.subTotal, discount: calc.discount, roundOff: calc.roundOff, total: calc.total,
      player: player?._id, customerName: player?.name || str(b.customerName, { max: 80 }) || 'Walk-in',
      createdBy: req.user._id,
    });
    res.status(201).json(bill);
  } catch (e) {
    for (const [id, qty] of taken) await Product.updateOne({ _id: id }, { $inc: { stock: qty } });
    throw e;
  }
});

// Change discount / customer while the bill is still unpaid.
r.put('/bills/:id', async (req, res) => {
  const bill = await Bill.findOne({ _id: needId(req.params.id, 'Bill'), status: 'unpaid' });
  if (!bill) throw new HttpError(409, 'Only unpaid bills can be changed');
  const b = req.body || {};
  if (b.discount !== undefined) {
    const settings = await getSettings();
    bill.discount = r2(Math.min(num(b.discount, { max: 1e6, label: 'Discount' }), bill.subTotal));
    const net = r2(bill.subTotal - bill.discount);
    bill.total = settings.billing.roundTotal === false ? net : Math.round(net);
    bill.roundOff = r2(bill.total - net);
  }
  if (b.playerId !== undefined) {
    const p = isId(b.playerId) ? await Player.findById(b.playerId).select('name') : null;
    bill.player = p?._id;
    if (p) bill.customerName = p.name;
  }
  await bill.save();
  res.json(await full(Bill.findById(bill._id)));
});

// ----- pay -----
r.post('/bills/:id/pay', async (req, res) => {
  const id = needId(req.params.id, 'Bill');
  const method = String(req.body?.method || '');
  if (![...PAY_METHODS, 'pass'].includes(method)) throw bad('Choose a payment method');
  const bill = await Bill.findById(id);
  if (!bill) throw notFound('Bill');
  if (bill.status !== 'unpaid') throw new HttpError(409, `Bill is already ${bill.status}`);

  const paid = { status: 'paid', paymentMethod: method, paidAt: new Date(), paidBy: req.user._id };
  let passPlayer = null;

  if (method === 'pass') {
    const settings = await getSettings();
    if (!settings.features.playerPass) throw bad('Player Pass is not enabled');
    const playerId = isId(req.body?.playerId) ? req.body.playerId : bill.player;
    if (!playerId) throw bad('Select the player whose pass should be charged');
    // Debit only if the balance covers the bill - single atomic operation.
    passPlayer = await Player.findOneAndUpdate(
      { _id: playerId, passBalance: { $gte: bill.total } },
      { $inc: { passBalance: -bill.total } }, { new: true },
    );
    if (!passPlayer) throw bad('Not enough pass balance');
    paid.player = passPlayer._id;
    if (!bill.player) paid.customerName = passPlayer.name;
  }

  const done = await Bill.findOneAndUpdate({ _id: id, status: 'unpaid', total: bill.total }, paid, { new: true });
  if (!done) {
    if (passPlayer) await Player.updateOne({ _id: passPlayer._id }, { $inc: { passBalance: bill.total } });
    throw new HttpError(409, 'Bill changed while paying - please retry');
  }
  if (passPlayer) {
    await PassTxn.create({ player: passPlayer._id, type: 'spend', amount: -bill.total,
      balanceAfter: r2(passPlayer.passBalance), bill: bill._id, note: `Bill ${bill.code}`, by: req.user._id });
  }
  if (done.player) {
    await Player.updateOne({ _id: done.player }, { $inc: { visits: 1, totalSpent: done.total }, lastVisitAt: done.paidAt });
  }
  res.json(await full(Bill.findById(id)));
});

// ----- void (owner) : cancels the bill, refunds pass balance if it was used -----
r.post('/bills/:id/void', adminOnly, async (req, res) => {
  const id = needId(req.params.id, 'Bill');
  const reason = str(req.body?.reason, { max: 200, required: true, label: 'Reason' });
  const before = await Bill.findOneAndUpdate({ _id: id, status: { $ne: 'void' } }, { status: 'void', voidReason: reason });
  if (!before) throw new HttpError(409, 'Bill not found or already void');
  if (before.status === 'paid' && before.player) {
    const inc = { visits: -1, totalSpent: -before.total };
    if (before.paymentMethod === 'pass') inc.passBalance = before.total;
    const p = await Player.findByIdAndUpdate(before.player, { $inc: inc }, { new: true });
    if (p && before.paymentMethod === 'pass') {
      await PassTxn.create({ player: p._id, type: 'refund', amount: before.total, balanceAfter: r2(p.passBalance),
        bill: before._id, note: `Void ${before.code}`, by: req.user._id });
    }
  }
  for (const i of before.items) {
    if (i.product) await Product.updateOne({ _id: i.product, stock: { $ne: null } }, { $inc: { stock: i.qty } });
  }
  res.json(await full(Bill.findById(id)));
});

export default r;
