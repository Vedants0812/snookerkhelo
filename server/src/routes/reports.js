// Earnings reports (owner only). All day boundaries are India time, shifted by the
// configured business-day start hour so late-night bills land on the right day.
import { Router } from 'express';
import { Bill, PassTxn, Tournament, Session, getSettings } from '../models.js';
import { auth, adminOnly, bad, dayRange, businessDate } from '../lib.js';
import { r2 } from '../../../shared/billing.js';

const r = Router();
r.use(auth, adminOnly);

const METHODS = ['cash', 'upi', 'card', 'pass'];
const zero = () => Object.fromEntries(METHODS.map((m) => [m, 0]));

async function feesBetween(from, to) {
  const rows = await Tournament.aggregate([
    { $unwind: '$registrations' },
    { $match: { 'registrations.paid': true, 'registrations.paidAt': { $gte: from, $lt: to } } },
    { $project: { name: 1, amount: '$registrations.paidAmount', method: '$registrations.paidMethod', at: '$registrations.paidAt', player: '$registrations.name' } },
  ]);
  return rows;
}

r.get('/reports/daily', async (req, res) => {
  const settings = await getSettings();
  const h = settings.billing.dayStartHour;
  const date = String(req.query.date || businessDate(new Date(), h));
  const [from, to] = dayRange(date, h);

  const [paid, unpaidToday, outstanding, voided, topups, fees, sessions] = await Promise.all([
    Bill.find({ status: 'paid', paidAt: { $gte: from, $lt: to } }).sort({ paidAt: 1 }).lean(),
    Bill.find({ status: 'unpaid', createdAt: { $gte: from, $lt: to } }).lean(),
    Bill.aggregate([{ $match: { status: 'unpaid' } }, { $group: { _id: null, total: { $sum: '$total' }, count: { $sum: 1 } } }]),
    Bill.countDocuments({ status: 'void', createdAt: { $gte: from, $lt: to } }),
    PassTxn.find({ type: 'topup', createdAt: { $gte: from, $lt: to } }).populate('player', 'name').lean(),
    feesBetween(from, to),
    Session.countDocuments({ status: { $ne: 'cancelled' }, startedAt: { $gte: from, $lt: to } }),
  ]);

  const sales = { total: 0, tableCharge: 0, snacks: 0, discount: 0, count: paid.length, byMethod: zero() };
  const tables = new Map();
  const items = new Map();
  let playedMinutes = 0;
  for (const b of paid) {
    sales.total += b.total; sales.tableCharge += b.tableCharge; sales.snacks += b.itemsTotal; sales.discount += b.discount;
    sales.byMethod[b.paymentMethod] += b.total;
    playedMinutes += b.playedMinutes || 0;
    if (b.kind === 'table') {
      const t = tables.get(b.tableName) || { name: b.tableName, bills: 0, minutes: 0, frames: 0, tableCharge: 0, total: 0 };
      t.bills++; t.minutes += b.playedMinutes || 0; t.frames += b.frames || 0; t.tableCharge += b.tableCharge; t.total += b.total;
      tables.set(b.tableName, t);
    }
    for (const i of b.items) {
      const it = items.get(i.name) || { name: i.name, qty: 0, amount: 0 };
      it.qty += i.qty; it.amount += i.amount ?? i.price * i.qty;
      items.set(i.name, it);
    }
  }

  // Money that actually came in today, by how it was paid. Pass spends are NOT new money
  // (it was collected when the pass was topped up), so they are excluded here.
  const collected = { cash: 0, upi: 0, card: 0 };
  for (const m of Object.keys(collected)) collected[m] += sales.byMethod[m];
  const topupTotal = { total: 0, cash: 0, upi: 0, card: 0 };
  for (const t of topups) { topupTotal.total += t.amount; topupTotal[t.method] += t.amount; collected[t.method] += t.amount; }
  const feeTotal = { total: 0, cash: 0, upi: 0, card: 0 };
  for (const f of fees) { feeTotal.total += f.amount; feeTotal[f.method] += f.amount; collected[f.method] += f.amount; }

  const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? r2(v) : v]));
  res.json({
    date, from, to,
    sales: { ...round(sales), byMethod: round(sales.byMethod) },
    collected: { ...round(collected), total: r2(collected.cash + collected.upi + collected.card) },
    topups: round(topupTotal), tournamentFees: round(feeTotal),
    unpaid: { count: unpaidToday.length, total: r2(unpaidToday.reduce((s, b) => s + b.total, 0)) },
    outstanding: { count: outstanding[0]?.count || 0, total: r2(outstanding[0]?.total || 0) },
    voided, sessions, playedMinutes,
    tables: [...tables.values()].map(round).sort((a, b) => b.total - a.total),
    items: [...items.values()].map(round).sort((a, b) => b.amount - a.amount),
    bills: paid.map((b) => ({ _id: b._id, code: b.code, tableName: b.tableName, customerName: b.customerName,
      tableCharge: b.tableCharge, itemsTotal: b.itemsTotal, discount: b.discount, total: b.total,
      paymentMethod: b.paymentMethod, paidAt: b.paidAt })),
    topupList: topups.map((t) => ({ player: t.player?.name || '-', amount: t.amount, method: t.method, at: t.createdAt })),
    feeList: fees.map((f) => ({ tournament: f.name, player: f.player, amount: f.amount, method: f.method, at: f.at })),
  });
});

// Day-by-day totals for a date range (max 92 days).
r.get('/reports/range', async (req, res) => {
  const settings = await getSettings();
  const h = settings.billing.dayStartHour;
  const [from] = dayRange(String(req.query.from), h);
  const [, to] = dayRange(String(req.query.to), h);
  const days = Math.round((to - from) / 86400000);
  if (days < 1 || days > 92) throw bad('Choose a range of 1 to 92 days');

  const [paid, topups, fees] = await Promise.all([
    Bill.find({ status: 'paid', paidAt: { $gte: from, $lt: to } }).select('total tableCharge itemsTotal paymentMethod paidAt').lean(),
    PassTxn.find({ type: 'topup', createdAt: { $gte: from, $lt: to } }).select('amount createdAt').lean(),
    feesBetween(from, to),
  ]);
  const rows = new Map();
  for (let i = 0; i < days; i++) {
    const d = businessDate(new Date(from.getTime() + i * 86400000), h);
    rows.set(d, { date: d, bills: 0, sales: 0, tableCharge: 0, snacks: 0, passSpend: 0, topups: 0, fees: 0, collected: 0 });
  }
  for (const b of paid) {
    const row = rows.get(businessDate(b.paidAt, h)); if (!row) continue;
    row.bills++; row.sales += b.total; row.tableCharge += b.tableCharge; row.snacks += b.itemsTotal;
    if (b.paymentMethod === 'pass') row.passSpend += b.total; else row.collected += b.total;
  }
  for (const t of topups) { const row = rows.get(businessDate(t.createdAt, h)); if (row) { row.topups += t.amount; row.collected += t.amount; } }
  for (const f of fees) { const row = rows.get(businessDate(f.at, h)); if (row) { row.fees += f.amount; row.collected += f.amount; } }

  const list = [...rows.values()].map((x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, typeof v === 'number' ? r2(v) : v])));
  const sum = (k) => r2(list.reduce((s, x) => s + x[k], 0));
  res.json({ from: req.query.from, to: req.query.to, days: list,
    totals: { bills: sum('bills'), sales: sum('sales'), tableCharge: sum('tableCharge'), snacks: sum('snacks'),
      passSpend: sum('passSpend'), topups: sum('topups'), fees: sum('fees'), collected: sum('collected') } });
});

export default r;
