import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { User } from '../models.js';
import { auth, adminOnly, signToken, bad, notFound, needId, str, HttpError } from '../lib.js';

const r = Router();
const pub = (u) => ({ id: u._id, name: u.name, username: u.username, role: u.role, active: u.active });

const loginLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in a few minutes.' } });

function checkPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 6 || pw.length > 100) throw bad('Password must be at least 6 characters');
  return pw;
}

r.post('/auth/login', loginLimiter, async (req, res) => {
  const username = str(req.body?.username, { required: true, label: 'Username' }).toLowerCase();
  const password = String(req.body?.password || '');
  const user = await User.findOne({ username });
  const ok = user && user.active && (await bcrypt.compare(password, user.passwordHash));
  if (!ok) throw new HttpError(401, 'Wrong username or password');
  res.json({ token: signToken(user), user: pub(user) });
});

r.get('/auth/me', auth, (req, res) => res.json({ user: pub(req.user) }));

r.post('/auth/change-password', auth, async (req, res) => {
  const ok = await bcrypt.compare(String(req.body?.current || ''), req.user.passwordHash);
  if (!ok) throw bad('Current password is wrong');
  req.user.passwordHash = await bcrypt.hash(checkPassword(req.body?.next), 10);
  await req.user.save();
  res.json({ ok: true });
});

// ----- staff accounts (owner only) -----
r.get('/users', auth, adminOnly, async (_req, res) => {
  res.json((await User.find().sort({ createdAt: 1 })).map(pub));
});

r.post('/users', auth, adminOnly, async (req, res) => {
  const username = str(req.body?.username, { required: true, max: 30, label: 'Username' }).toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) throw bad('Username: 3-30 letters, numbers, dot, dash');
  if (await User.exists({ username })) throw bad('Username already taken');
  const user = await User.create({
    name: str(req.body?.name, { required: true, max: 60, label: 'Name' }),
    username,
    passwordHash: await bcrypt.hash(checkPassword(req.body?.password), 10),
    role: req.body?.role === 'admin' ? 'admin' : 'staff',
  });
  res.status(201).json(pub(user));
});

r.put('/users/:id', auth, adminOnly, async (req, res) => {
  const user = await User.findById(needId(req.params.id, 'User'));
  if (!user) throw notFound('User');
  const b = req.body || {};
  const self = user._id.equals(req.user._id);
  if (b.name !== undefined) user.name = str(b.name, { required: true, max: 60, label: 'Name' });
  if (b.password) user.passwordHash = await bcrypt.hash(checkPassword(b.password), 10);
  if (b.role !== undefined && !self) user.role = b.role === 'admin' ? 'admin' : 'staff';
  if (b.active !== undefined && !self) user.active = !!b.active;
  await user.save();
  res.json(pub(user));
});

export default r;
