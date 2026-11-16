// Settings, tables and snack products.
import { Router } from 'express';
import { Settings, getSettings, Table, Product, Session } from '../models.js';
import { auth, adminOnly, bad, notFound, needId, str, num } from '../lib.js';

const r = Router();
r.use(auth);

// ---------- settings ----------
r.get('/settings', async (_req, res) => res.json(await getSettings()));

r.put('/settings', adminOnly, async (req, res) => {
  const s = await getSettings();
  const b = req.body || {};
  for (const k of ['shopName', 'phone', 'upiId', 'upiPayeeName']) if (b[k] !== undefined) s[k] = str(b[k], { max: 100 });
  for (const k of ['address', 'googleReviewLink', 'googleMapsLink', 'receiptFooter']) if (b[k] !== undefined) s[k] = str(b[k], { max: 400 });
  if (s.upiId && !/^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(s.upiId)) throw bad('UPI ID looks wrong (example: name@okhdfcbank)');
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
  await s.save();
  res.json(s);
});

// ---------- tables ----------
function tableFields(b, t = {}) {
  if (b.name !== undefined) t.name = str(b.name, { required: true, max: 40, label: 'Table name' });
  if (b.type !== undefined) t.type = ['snooker', 'pool', 'other'].includes(b.type) ? b.type : 'snooker';
  if (b.ratePerHour !== undefined) t.ratePerHour = num(b.ratePerHour, { max: 100000, label: 'Rate per hour' });
  if (b.ratePerFrame !== undefined) t.ratePerFrame = num(b.ratePerFrame, { max: 100000, label: 'Rate per frame' });
  if (b.defaultMode !== undefined) t.defaultMode = b.defaultMode === 'frame' ? 'frame' : 'time';
  if (b.sortOrder !== undefined) t.sortOrder = num(b.sortOrder, { min: 0, max: 999, int: true, label: 'Order' });
  if (b.active !== undefined) t.active = !!b.active;
  return t;
}
function checkRates(t) {
  if (!(t.ratePerHour > 0) && !(t.ratePerFrame > 0)) throw bad('Set a rate per hour or a rate per frame');
  if (t.defaultMode === 'frame' && !(t.ratePerFrame > 0)) t.defaultMode = 'time';
  if (t.defaultMode === 'time' && !(t.ratePerHour > 0)) t.defaultMode = 'frame';
}

// Floor view: every table with its running session, plus server clock + billing rules.
r.get('/tables', async (req, res) => {
  const filter = req.query.all === '1' ? {} : { active: true };
  const [tables, sessions, settings] = await Promise.all([
    Table.find(filter).sort({ sortOrder: 1, name: 1 }).lean(),
    Session.find({ status: 'active' }).populate('players', 'name phone passBalance').lean(),
    getSettings(),
  ]);
  const byTable = new Map(sessions.map((s) => [String(s.table), s]));
  res.json({
    serverTime: Date.now(),
    rules: settings.billing,
    tables: tables.map((t) => ({ ...t, session: byTable.get(String(t._id)) || null })),
  });
});

r.post('/tables', adminOnly, async (req, res) => {
  const data = tableFields(req.body || {});
  if (!data.name) throw bad('Table name is required');
  const t = new Table(data);
  checkRates(t);
  await t.save();
  res.status(201).json(t);
});

r.put('/tables/:id', adminOnly, async (req, res) => {
  const t = await Table.findById(needId(req.params.id, 'Table'));
  if (!t) throw notFound('Table');
  tableFields(req.body || {}, t);
  checkRates(t);
  if (!t.active && (await Session.exists({ table: t._id, status: 'active' }))) throw bad('Stop the running session first');
  await t.save();
  res.json(t);
});

r.delete('/tables/:id', adminOnly, async (req, res) => {
  const id = needId(req.params.id, 'Table');
  if (await Session.exists({ table: id })) {
    // Keep history intact: tables that were ever used are hidden, not deleted.
    if (await Session.exists({ table: id, status: 'active' })) throw bad('Stop the running session first');
    await Table.updateOne({ _id: id }, { active: false });
    return res.json({ ok: true, archived: true });
  }
  await Table.deleteOne({ _id: id });
  res.json({ ok: true });
});

// ---------- products ----------
function productFields(b, p = {}) {
  if (b.name !== undefined) p.name = str(b.name, { required: true, max: 60, label: 'Item name' });
  if (b.category !== undefined) p.category = str(b.category, { max: 40 }) || 'Snacks';
  if (b.price !== undefined) p.price = num(b.price, { max: 100000, label: 'Price' });
  if (b.stock !== undefined) p.stock = b.stock === null || b.stock === '' ? null : num(b.stock, { max: 100000, int: true, label: 'Stock' });
  if (b.active !== undefined) p.active = !!b.active;
  return p;
}

r.get('/products', async (req, res) => {
  const filter = req.query.all === '1' ? {} : { active: true };
  res.json(await Product.find(filter).sort({ category: 1, name: 1 }));
});

r.post('/products', adminOnly, async (req, res) => {
  const data = productFields(req.body || {});
  if (!data.name || data.price === undefined) throw bad('Name and price are required');
  res.status(201).json(await Product.create(data));
});

r.put('/products/:id', adminOnly, async (req, res) => {
  const p = await Product.findById(needId(req.params.id, 'Item'));
  if (!p) throw notFound('Item');
  productFields(req.body || {}, p);
  await p.save();
  res.json(p);
});

r.delete('/products/:id', adminOnly, async (req, res) => {
  await Product.updateOne({ _id: needId(req.params.id, 'Item') }, { active: false });
  res.json({ ok: true });
});

export default r;
export { Settings };
