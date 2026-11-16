import test from 'node:test';
import assert from 'node:assert/strict';
import { computeBill, playedMs, upiLink } from '../../shared/billing.js';

const t0 = Date.parse('2026-01-10T10:00:00Z');
const at = (min, sec = 0) => new Date(t0 + min * 60000 + sec * 1000);
const time = (endMin, extra = {}) => ({ mode: 'time', ratePerHour: 200, startedAt: at(0), endedAt: at(endMin), ...extra });

test('per-minute billing: 90 min at 200/hr = 300', () => {
  const b = computeBill(time(90), { roundToMinutes: 1 });
  assert.equal(b.billedMinutes, 90);
  assert.equal(b.tableCharge, 300);
  assert.equal(b.total, 300);
});

test('a started minute is charged (61s -> 2 min)', () => {
  const b = computeBill({ ...time(0), endedAt: at(1, 1) }, { roundToMinutes: 1, roundTotal: false });
  assert.equal(b.playedMinutes, 2);
  assert.equal(b.tableCharge, 6.67);
});

test('pauses are not billed', () => {
  const s = time(60, { pauses: [{ from: at(10), to: at(25) }] });
  assert.equal(playedMs(s), 45 * 60000);
  assert.equal(computeBill(s, {}).tableCharge, 150);
});

test('open pause runs until the end', () => {
  const s = { mode: 'time', ratePerHour: 120, startedAt: at(0), pauses: [{ from: at(30) }] };
  assert.equal(computeBill(s, {}, { now: at(50) }).billedMinutes, 30);
});

test('billing blocks round up, minimum applies', () => {
  assert.equal(computeBill(time(31), { roundToMinutes: 15 }).billedMinutes, 45);
  assert.equal(computeBill(time(7), { roundToMinutes: 1, minMinutes: 30 }).billedMinutes, 30);
  assert.equal(computeBill(time(0), { minMinutes: 30 }).tableCharge, 0);
});

test('frame mode ignores the clock', () => {
  const b = computeBill({ mode: 'frame', ratePerFrame: 80, frames: 3, startedAt: at(0), endedAt: at(200) }, {});
  assert.equal(b.tableCharge, 240);
  assert.equal(b.billedMinutes, 0);
});

test('snacks, discount and rounding', () => {
  const s = time(50, { items: [{ name: 'Chips', price: 20, qty: 2 }, { name: 'Tea', price: 15, qty: 1 }] });
  const b = computeBill(s, { roundTotal: true }, { discount: 10 });
  assert.equal(b.tableCharge, 166.67);
  assert.equal(b.itemsTotal, 55);
  assert.equal(b.subTotal, 221.67);
  assert.equal(b.total, 212);
  assert.equal(b.roundOff, 0.33);
  assert.equal(b.subTotal - b.discount + b.roundOff, b.total);
});

test('discount can never exceed the bill', () => {
  const b = computeBill(time(30), {}, { discount: 5000 });
  assert.equal(b.discount, 100);
  assert.equal(b.total, 0);
});

test('upi link', () => {
  const link = upiLink({ upiId: 'shop@okaxis', payeeName: 'The 8 Pool', amount: 212, note: 'Bill B-00012' });
  assert.equal(link, 'upi://pay?pa=shop%40okaxis&pn=The%208%20Pool&am=212.00&cu=INR&tn=Bill%20B-00012');
  assert.equal(upiLink({ upiId: '' }), '');
});
