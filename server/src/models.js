import mongoose from 'mongoose';

const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;
const money = { type: Number, default: 0, min: 0 };

// ---------- Users (owner + staff logins) ----------
export const User = model('User', new Schema({
  name: { type: String, required: true, trim: true },
  username: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['admin', 'staff'], default: 'staff' },
  active: { type: Boolean, default: true },
}, { timestamps: true }));

// ---------- Settings (single document) ----------
export const Settings = model('Settings', new Schema({
  shopName: { type: String, default: 'The 8 Pool Gaming Zone' },
  address: { type: String, default: '' },
  phone: { type: String, default: '' },
  upiId: { type: String, default: '', trim: true },
  upiPayeeName: { type: String, default: '' },
  googleReviewLink: { type: String, default: '' },
  googleMapsLink: { type: String, default: '' },
  receiptFooter: { type: String, default: 'Thank you! Visit again.' },
  billing: {
    roundToMinutes: { type: Number, default: 1, min: 1 },   // bill in blocks of N minutes
    minMinutes: { type: Number, default: 0, min: 0 },       // minimum minutes charged
    roundTotal: { type: Boolean, default: true },           // round payable to nearest rupee
    dayStartHour: { type: Number, default: 0, min: 0, max: 12 }, // business day starts at this hour (IST)
  },
  features: {
    playerPass: { type: Boolean, default: true },
    waitlist: { type: Boolean, default: true },
  },
}, { timestamps: true }));

export async function getSettings() {
  return (await Settings.findOne()) || (await Settings.create({}));
}

// ---------- Tables ----------
export const Table = model('Table', new Schema({
  name: { type: String, required: true, trim: true },
  type: { type: String, enum: ['snooker', 'pool', 'other'], default: 'snooker' },
  ratePerHour: money,
  ratePerFrame: money,
  defaultMode: { type: String, enum: ['time', 'frame'], default: 'time' },
  sortOrder: { type: Number, default: 0 },
  active: { type: Boolean, default: true },
}, { timestamps: true }));

// ---------- Snacks / products ----------
export const Product = model('Product', new Schema({
  name: { type: String, required: true, trim: true },
  category: { type: String, default: 'Snacks', trim: true },
  price: { ...money, required: true },
  stock: { type: Number, default: null }, // null = stock not tracked
  active: { type: Boolean, default: true },
}, { timestamps: true }));

// ---------- Players ----------
const playerSchema = new Schema({
  name: { type: String, required: true, trim: true },
  phone: { type: String, trim: true },
  notes: { type: String, default: '' },
  passBalance: money,
  visits: { type: Number, default: 0 },
  totalSpent: money,
  lastVisitAt: Date,
  active: { type: Boolean, default: true },
}, { timestamps: true });
playerSchema.index({ phone: 1 }, { unique: true, partialFilterExpression: { phone: { $type: 'string' } } });
playerSchema.index({ name: 1 });
export const Player = model('Player', playerSchema);

// ---------- Player pass ledger ----------
const passTxnSchema = new Schema({
  player: { type: ObjectId, ref: 'Player', required: true, index: true },
  type: { type: String, enum: ['topup', 'spend', 'refund', 'adjust'], required: true },
  amount: { type: Number, required: true }, // + credit, - debit
  balanceAfter: { type: Number, required: true },
  method: { type: String, enum: ['cash', 'upi', 'card', null], default: null }, // how a top-up was paid
  bill: { type: ObjectId, ref: 'Bill' },
  note: { type: String, default: '' },
  by: { type: ObjectId, ref: 'User' },
}, { timestamps: true });
passTxnSchema.index({ createdAt: 1 });
export const PassTxn = model('PassTxn', passTxnSchema);

// ---------- Table sessions ----------
const lineItem = new Schema({
  product: { type: ObjectId, ref: 'Product' },
  name: { type: String, required: true },
  price: { type: Number, required: true, min: 0 },
  qty: { type: Number, required: true, min: 1 },
  amount: Number,
}, { _id: false });

const sessionSchema = new Schema({
  table: { type: ObjectId, ref: 'Table', required: true },
  tableName: String,
  mode: { type: String, enum: ['time', 'frame'], required: true },
  ratePerHour: money,   // rate snapshot taken when the session starts
  ratePerFrame: money,
  players: [{ type: ObjectId, ref: 'Player' }],
  customerName: { type: String, default: '' },
  startedAt: { type: Date, required: true },
  endedAt: Date,
  pauses: [{ _id: false, from: Date, to: Date }],
  frames: { type: Number, default: 0, min: 0 },
  items: [lineItem],
  status: { type: String, enum: ['active', 'closed', 'cancelled'], default: 'active' },
  bill: { type: ObjectId, ref: 'Bill' },
  cancelReason: String,
  startedBy: { type: ObjectId, ref: 'User' },
}, { timestamps: true });
// A table can only ever have one running session.
sessionSchema.index({ table: 1 }, { unique: true, partialFilterExpression: { status: 'active' } });
sessionSchema.index({ status: 1, startedAt: -1 });
export const Session = model('Session', sessionSchema);

// ---------- Bills ----------
const billSchema = new Schema({
  billNo: { type: Number, required: true, unique: true },
  code: { type: String, required: true },
  kind: { type: String, enum: ['table', 'counter'], default: 'table' },
  session: { type: ObjectId, ref: 'Session' },
  table: { type: ObjectId, ref: 'Table' },
  tableName: String,
  mode: String,
  rate: Number,
  startedAt: Date,
  endedAt: Date,
  playedMinutes: { type: Number, default: 0 },
  billedMinutes: { type: Number, default: 0 },
  frames: { type: Number, default: 0 },
  tableCharge: money,
  items: [lineItem],
  itemsTotal: money,
  subTotal: money,
  discount: money,
  roundOff: { type: Number, default: 0 },
  total: money,
  player: { type: ObjectId, ref: 'Player' },
  customerName: { type: String, default: '' },
  status: { type: String, enum: ['unpaid', 'paid', 'void'], default: 'unpaid' },
  paymentMethod: { type: String, enum: ['cash', 'upi', 'card', 'pass', null], default: null },
  paidAt: Date,
  voidReason: String,
  createdBy: { type: ObjectId, ref: 'User' },
  paidBy: { type: ObjectId, ref: 'User' },
}, { timestamps: true });
billSchema.index({ status: 1, paidAt: 1 });
billSchema.index({ createdAt: -1 });
billSchema.index({ player: 1, createdAt: -1 });
export const Bill = model('Bill', billSchema);

// ---------- Sequential numbering ----------
const Counter = model('Counter', new Schema({ _id: String, seq: { type: Number, default: 0 } }));
export async function nextSeq(name) {
  const c = await Counter.findOneAndUpdate({ _id: name }, { $inc: { seq: 1 } }, { new: true, upsert: true });
  return c.seq;
}

// ---------- Tournaments ----------
const tournamentSchema = new Schema({
  name: { type: String, required: true, trim: true },
  game: { type: String, default: '8 Ball Pool' },
  date: Date,
  entryFee: money,
  maxPlayers: { type: Number, default: 0 }, // 0 = unlimited
  prize: { type: String, default: '' },
  description: { type: String, default: '' },
  status: { type: String, enum: ['open', 'ongoing', 'completed'], default: 'open' },
  registrations: [{
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true },
    player: { type: ObjectId, ref: 'Player' },
    paid: { type: Boolean, default: false },
    paidMethod: { type: String, enum: ['cash', 'upi', 'card', null], default: null },
    paidAmount: { type: Number, default: 0 },
    paidAt: Date,
    createdAt: { type: Date, default: Date.now },
  }],
  matches: [{
    round: { type: String, default: 'Round 1' },
    p1: ObjectId, // registration _id
    p2: ObjectId,
    score1: { type: Number, default: 0 },
    score2: { type: Number, default: 0 },
    status: { type: String, enum: ['scheduled', 'done'], default: 'scheduled' },
    winner: ObjectId,
    createdAt: { type: Date, default: Date.now },
  }],
}, { timestamps: true });
export const Tournament = model('Tournament', tournamentSchema);

// ---------- Waiting list ----------
export const Waitlist = model('Waitlist', new Schema({
  name: { type: String, required: true, trim: true },
  phone: { type: String, default: '' },
  partySize: { type: Number, default: 2, min: 1 },
  tableType: { type: String, enum: ['any', 'snooker', 'pool'], default: 'any' },
  status: { type: String, enum: ['waiting', 'notified', 'seated', 'left'], default: 'waiting' },
  notifiedAt: Date,
  closedAt: Date,
}, { timestamps: true }));
