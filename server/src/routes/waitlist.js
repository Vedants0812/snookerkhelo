// Waiting list with one-tap WhatsApp "table free" message (click-to-chat link, no API cost).
import { Router } from 'express';
import { Waitlist, getSettings } from '../models.js';
import { auth, bad, notFound, needId, str, num, phone } from '../lib.js';

const r = Router();
r.use(auth);
r.use('/waitlist', async (_req, _res, next) => {
  if (!(await getSettings()).features.waitlist) throw bad('Waiting list is not enabled');
  next();
});

r.get('/waitlist', async (_req, res) => {
  const since = new Date(Date.now() - 18 * 3600000);
  res.json(await Waitlist.find({ $or: [{ status: { $in: ['waiting', 'notified'] } }, { closedAt: { $gte: since } }] })
    .sort({ createdAt: 1 }));
});

r.post('/waitlist', async (req, res) => {
  const b = req.body || {};
  res.status(201).json(await Waitlist.create({
    name: str(b.name, { required: true, max: 60, label: 'Name' }),
    phone: phone(b.phone),
    partySize: num(b.partySize ?? 2, { min: 1, max: 20, int: true, label: 'Players' }),
    tableType: ['snooker', 'pool'].includes(b.tableType) ? b.tableType : 'any',
  }));
});

r.post('/waitlist/:id/status', async (req, res) => {
  const w = await Waitlist.findById(needId(req.params.id, 'Entry'));
  if (!w) throw notFound('Entry');
  const status = String(req.body?.status || '');
  if (!['waiting', 'notified', 'seated', 'left'].includes(status)) throw bad('Invalid status');
  w.status = status;
  if (status === 'notified') w.notifiedAt = new Date();
  w.closedAt = ['seated', 'left'].includes(status) ? new Date() : undefined;
  await w.save();
  res.json(w);
});

export default r;
