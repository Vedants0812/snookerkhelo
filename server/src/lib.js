import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { config } from './config.js';
import { User } from './models.js';

// ---------- errors ----------
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const bad = (msg) => new HttpError(400, msg);
export const notFound = (what = 'Record') => new HttpError(404, `${what} not found`);

// ---------- auth ----------
export const signToken = (user) => jwt.sign({ id: user._id.toString() }, config.jwtSecret, { expiresIn: '30d' });

export async function auth(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) throw new HttpError(401, 'Please log in');
  let payload;
  try { payload = jwt.verify(token, config.jwtSecret); } catch { throw new HttpError(401, 'Session expired, please log in again'); }
  const user = await User.findById(payload.id);
  if (!user || !user.active) throw new HttpError(401, 'Account disabled');
  req.user = user;
  next();
}

export function adminOnly(req, _res, next) {
  if (req.user?.role !== 'admin') throw new HttpError(403, 'Only the owner can do this');
  next();
}

// ---------- validation helpers ----------
export const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);
export function needId(v, what = 'Record') {
  if (!isId(v)) throw notFound(what);
  return v;
}
export function str(v, { max = 200, required = false, label = 'Value' } = {}) {
  const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
  if (required && !s) throw bad(`${label} is required`);
  if (s.length > max) throw bad(`${label} is too long`);
  return s;
}
export function num(v, { min = 0, max = 1e7, label = 'Value', int = false, required = true } = {}) {
  if ((v === undefined || v === null || v === '') && !required) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max || (int && !Number.isInteger(n))) throw bad(`${label} is invalid`);
  return Math.round(n * 100) / 100;
}
/** Indian mobile: returns 10 digits or '' ; throws when present but malformed. */
export function phone(v, { required = false } = {}) {
  let d = String(v ?? '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (!d) { if (required) throw bad('Mobile number is required'); return ''; }
  if (!/^[6-9]\d{9}$/.test(d)) throw bad('Enter a valid 10-digit mobile number');
  return d;
}
export const escapeRx = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const PAY_METHODS = ['cash', 'upi', 'card'];

// ---------- business-day time (India, UTC+05:30, no DST) ----------
const IST = 330 * 60000;
export function businessDate(d = new Date(), dayStartHour = 0) {
  return new Date(new Date(d).getTime() + IST - dayStartHour * 3600000).toISOString().slice(0, 10);
}
export function dayRange(dateStr, dayStartHour = 0) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr || '') || Number.isNaN(Date.parse(dateStr))) throw bad('Invalid date');
  const start = new Date(Date.parse(`${dateStr}T00:00:00Z`) - IST + dayStartHour * 3600000);
  return [start, new Date(start.getTime() + 86400000)];
}
