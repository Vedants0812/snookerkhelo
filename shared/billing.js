// Billing maths shared by the server (final bills) and the client (live running amount).
// Pure functions only - no I/O - so both sides always agree.

export const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const ms = (d) => (d instanceof Date ? d.getTime() : new Date(d).getTime());

/** Milliseconds actually played: wall time minus pauses. */
export function playedMs(session, now = Date.now()) {
  const start = ms(session.startedAt);
  const end = session.endedAt ? ms(session.endedAt) : ms(now);
  let paused = 0;
  for (const p of session.pauses || []) {
    const from = Math.max(ms(p.from), start);
    const to = Math.min(p.to ? ms(p.to) : end, end);
    paused += Math.max(0, to - from);
  }
  return Math.max(0, end - start - paused);
}

export function isPaused(session) {
  return (session.pauses || []).some((p) => !p.to);
}

/**
 * rules: { roundToMinutes, minMinutes, roundTotal }
 *  - roundToMinutes: bill in blocks of N minutes, rounded up (1 = per minute)
 *  - minMinutes: minimum minutes charged once a time session has started
 *  - roundTotal: round the final payable amount to the nearest rupee
 */
export function computeBill(session, rules = {}, opts = {}) {
  const now = opts.now ?? Date.now();
  const mode = session.mode === 'frame' ? 'frame' : 'time';
  const frames = Math.max(0, Math.floor(Number(opts.frames ?? session.frames ?? 0)));

  const playedSeconds = Math.floor(playedMs(session, now) / 1000);
  const playedMinutes = Math.ceil(playedSeconds / 60);

  let billedMinutes = 0;
  let tableCharge = 0;
  let rate = 0;

  if (mode === 'frame') {
    rate = Number(session.ratePerFrame) || 0;
    tableCharge = r2(frames * rate);
  } else {
    rate = Number(session.ratePerHour) || 0;
    const block = Math.max(1, Math.floor(Number(rules.roundToMinutes) || 1));
    const min = Math.max(0, Math.floor(Number(rules.minMinutes) || 0));
    if (playedMinutes > 0) {
      billedMinutes = Math.max(Math.ceil(playedMinutes / block) * block, min);
    }
    tableCharge = r2((billedMinutes * rate) / 60);
  }

  const items = (session.items || []).map((i) => ({
    product: i.product,
    name: i.name,
    price: Number(i.price),
    qty: Number(i.qty),
    amount: r2(Number(i.price) * Number(i.qty)),
  }));
  const itemsTotal = r2(items.reduce((s, i) => s + i.amount, 0));
  const subTotal = r2(tableCharge + itemsTotal);
  const discount = r2(Math.min(Math.max(0, Number(opts.discount) || 0), subTotal));
  const net = r2(subTotal - discount);
  const total = rules.roundTotal === false ? net : Math.round(net);
  const roundOff = r2(total - net);

  return {
    mode, rate, frames, playedSeconds, playedMinutes, billedMinutes,
    tableCharge, items, itemsTotal, subTotal, discount, roundOff, total,
  };
}

export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

/** UPI deep link understood by every UPI app (GPay, PhonePe, Paytm, BHIM...). */
export function upiLink({ upiId, payeeName, amount, note }) {
  if (!upiId) return '';
  const q = new URLSearchParams({ pa: upiId, pn: payeeName || '', am: Number(amount).toFixed(2), cu: 'INR', tn: note || '' });
  return `upi://pay?${q.toString().replace(/\+/g, '%20')}`;
}
