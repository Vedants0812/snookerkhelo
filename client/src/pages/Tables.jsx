import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, post, put, money } from '../api.js';
import { Modal, Field, Loading, Empty, PlayerPicker, PromptModal, useLoad, useAction } from '../ui.jsx';
import { TableArt, Icon } from '../art.jsx';
import { useApp } from '../App.jsx';
import { computeBill, formatDuration, isPaused } from '../../../shared/billing.js';

const TYPE_LABEL = { snooker: 'Snooker', pool: 'Pool', other: 'Table' };
const who = (s) => s.players?.map((p) => p.name).join(', ') || s.customerName || 'Walk-in';

export default function Tables() {
  const { user } = useApp();
  // Timers use the server clock, so a wrong clock on a phone or PC never changes a bill.
  const { data, error, reload } = useLoad(async () => {
    const d = await api('/tables');
    return { ...d, offset: d.serverTime - Date.now() };
  }, [], 8000);
  const [tick, setTick] = useState(0);
  const [modal, setModal] = useState(null); // { kind, tableId }

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  if (!data) return <Loading error={error} />;
  const now = Date.now() + data.offset;
  const tables = data.tables;
  const busy = tables.filter((t) => t.session);
  const running = busy.reduce((s, t) => s + computeBill(t.session, data.rules, { now }).total, 0);
  const pausedCount = busy.filter((t) => isPaused(t.session)).length;
  const snacksOn = busy.reduce((n, t) => n + t.session.items.reduce((m, i) => m + i.qty, 0), 0);
  const current = modal && tables.find((t) => t._id === modal.tableId);
  const close = () => setModal(null);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="kicker">Floor · live</div>
          <h1>Tables</h1>
        </div>
      </div>

      <div className="floor-strip">
        <div className="stat hot"><small>Running</small><strong>{busy.length - pausedCount}</strong><span>of {tables.length} tables{pausedCount ? ` · ${pausedCount} paused` : ''}</span></div>
        <div className="stat"><small>Free now</small><strong>{tables.length - busy.length}</strong><span>ready to start</span></div>
        <div className="stat accent"><small>On the clock</small><strong>{money(running)}</strong><span>running bills, live</span></div>
        <div className="stat"><small>Snacks on tables</small><strong>{snacksOn}</strong><span>items not yet billed</span></div>
      </div>

      {tables.length === 0 && (
        <Empty>No tables yet. {user.role === 'admin' ? <Link to="/settings">Add your tables in Settings →</Link> : 'Ask the owner to add tables.'}</Empty>
      )}

      <div className="grid tables">
        {tables.map((t) => (
          <TableCard key={t._id} table={t} rules={data.rules} now={now} tick={tick}
            open={(kind) => setModal({ kind, tableId: t._id })} reload={reload} />
        ))}
      </div>

      {current && modal.kind === 'start' && <StartModal table={current} onClose={close} reload={reload} />}
      {current?.session && modal.kind === 'snacks' && <SnackModal session={current.session} table={current} onClose={close} reload={reload} />}
      {current?.session && modal.kind === 'players' && <PlayersModal session={current.session} table={current} onClose={close} reload={reload} />}
      {current?.session && modal.kind === 'stop' && <StopModal session={current.session} table={current} rules={data.rules} offset={data.offset} onClose={close} reload={reload} />}
    </>
  );
}

function TableCard({ table, rules, now, open, reload }) {
  const s = table.session;
  const [run, busy] = useAction();
  const act = (path, body) => run(async () => { await post(`/sessions/${s._id}/${path}`, body); await reload(); });

  if (!s) {
    return (
      <div className="card table free">
        <div className="table-top">
          <div><h3>{table.name}</h3><span className="muted">{TYPE_LABEL[table.type]}</span></div>
          <span className="badge green">Free</span>
        </div>
        <TableArt type={table.type} state="free"><span>Open</span></TableArt>
        <div className="rates">
          {table.ratePerHour > 0 && <span className="rate-chip">{money(table.ratePerHour)}/hr</span>}
          {table.ratePerFrame > 0 && <span className="rate-chip">{money(table.ratePerFrame)}/frame</span>}
        </div>
        <button className="btn primary block" onClick={() => open('start')}>Start table</button>
      </div>
    );
  }

  const bill = computeBill(s, rules, { now });
  const paused = isPaused(s);
  const snackQty = s.items.reduce((n, i) => n + i.qty, 0);
  return (
    <div className={`card table busy ${paused ? 'paused' : ''}`}>
      <div className="table-top">
        <div><h3>{table.name}</h3><span className="muted">{TYPE_LABEL[table.type]} · {s.mode === 'frame' ? `${money(s.ratePerFrame)}/frame` : `${money(s.ratePerHour)}/hr`}</span></div>
        <span className={`badge ${paused ? 'amber' : 'red live'}`}>{paused ? 'Paused' : 'Running'}</span>
      </div>
      <TableArt type={table.type} state={paused ? 'paused' : 'running'}>
        <span className="timer">{formatDuration(bill.playedSeconds)}</span>
      </TableArt>
      <button className="linkish who-line" onClick={() => open('players')} title="Change players"><Icon name="user" />{who(s)}</button>

      {s.mode === 'frame' && (
        <div className="frames">
          <button className="btn sm" disabled={busy || s.frames < 1} onClick={() => act('frames', { delta: -1 })} aria-label="Remove frame">−</button>
          <span><strong>{s.frames}</strong> frame{s.frames === 1 ? '' : 's'}</span>
          <button className="btn sm" disabled={busy} onClick={() => act('frames', { delta: 1 })} aria-label="Add frame">+</button>
        </div>
      )}

      <div className="amounts">
        <div><small>Table</small><strong>{money(bill.tableCharge)}</strong></div>
        <div><small>Snacks{snackQty ? ` (${snackQty})` : ''}</small><strong>{money(bill.itemsTotal)}</strong></div>
        <div className="total"><small>Total</small><strong>{money(bill.total)}</strong></div>
      </div>

      <div className="actions">
        <button className="btn" onClick={() => open('snacks')}>+ Snacks</button>
        {s.mode === 'time' && (
          <button className="btn" disabled={busy} onClick={() => act(paused ? 'resume' : 'pause')}>{paused ? 'Resume' : 'Pause'}</button>
        )}
        <button className="btn danger" onClick={() => open('stop')}>Stop &amp; Bill</button>
      </div>
    </div>
  );
}

function StartModal({ table, onClose, reload }) {
  const both = table.ratePerHour > 0 && table.ratePerFrame > 0;
  const [mode, setMode] = useState(table.defaultMode);
  const [players, setPlayers] = useState([]);
  const [customerName, setCustomerName] = useState('');
  const [run, busy] = useAction();

  const start = () => run(async () => {
    await post('/sessions', { tableId: table._id, mode, playerIds: players.map((p) => p._id), customerName });
    await reload();
    onClose();
  }, `${table.name} started`);

  return (
    <Modal title={`Start ${table.name}`} onClose={onClose}>
      {both && (
        <Field label="Billing">
          <div className="seg">
            <button type="button" className={mode === 'time' ? 'on' : ''} onClick={() => setMode('time')}>By time · {money(table.ratePerHour)}/hr</button>
            <button type="button" className={mode === 'frame' ? 'on' : ''} onClick={() => setMode('frame')}>By frame · {money(table.ratePerFrame)}</button>
          </div>
        </Field>
      )}
      <Field label="Players (optional)" hint="Pick saved players, or leave empty for a walk-in.">
        <PlayerPicker selected={players} onChange={setPlayers} />
      </Field>
      {players.length === 0 && (
        <Field label="Walk-in name (optional)">
          <input className="input" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="e.g. Blue shirt group" />
        </Field>
      )}
      <div className="modal-foot">
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={busy} onClick={start}>Start timer</button>
      </div>
    </Modal>
  );
}

function PlayersModal({ session, table, onClose, reload }) {
  const [players, setPlayers] = useState(session.players || []);
  const [customerName, setCustomerName] = useState(session.customerName || '');
  const [run, busy] = useAction();
  const save = () => run(async () => {
    await put(`/sessions/${session._id}`, { playerIds: players.map((p) => p._id), customerName });
    await reload();
    onClose();
  }, 'Saved');
  return (
    <Modal title={`${table.name} · players`} onClose={onClose}>
      <Field label="Players"><PlayerPicker selected={players} onChange={setPlayers} /></Field>
      <Field label="Walk-in name">
        <input className="input" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
      </Field>
      <div className="modal-foot">
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={busy} onClick={save}>Save</button>
      </div>
    </Modal>
  );
}

export function ProductGrid({ products, onAdd, disabled }) {
  const groups = useMemo(() => {
    const m = new Map();
    for (const p of products) { if (!m.has(p.category)) m.set(p.category, []); m.get(p.category).push(p); }
    return [...m.entries()];
  }, [products]);
  if (!products.length) return <Empty>No snacks on the menu yet. Add them from the Snacks page.</Empty>;
  return groups.map(([cat, list]) => (
    <div key={cat} className="pgroup">
      <h4>{cat}</h4>
      <div className="pgrid">
        {list.map((p) => {
          const out = p.stock !== null && p.stock <= 0;
          return (
            <button type="button" key={p._id} className="pitem" disabled={disabled || out} onClick={() => onAdd(p)}>
              <span>{p.name}</span>
              <strong>{money(p.price)}</strong>
              {p.stock !== null && <small className={out ? 'bad' : ''}>{out ? 'Out of stock' : `${p.stock} left`}</small>}
            </button>
          );
        })}
      </div>
    </div>
  ));
}

function SnackModal({ session, table, onClose, reload }) {
  const products = useLoad(() => api('/products'), []);
  const [run, busy] = useAction();
  const change = (productId, qty) => run(async () => {
    await post(`/sessions/${session._id}/items`, { productId, qty });
    await Promise.all([reload(), products.reload()]);
  });
  const total = session.items.reduce((s, i) => s + i.price * i.qty, 0);

  return (
    <Modal title={`${table.name} · snacks`} onClose={onClose} wide>
      <div className="split">
        <div>{products.data ? <ProductGrid products={products.data} onAdd={(p) => change(p._id, 1)} disabled={busy} /> : <Loading error={products.error} />}</div>
        <div className="order">
          <h4>On this table</h4>
          {session.items.length === 0 && <p className="muted">Nothing added yet.</p>}
          {session.items.map((i) => (
            <div className="order-line" key={i.product}>
              <span>{i.name}<small className="muted"> × {money(i.price)}</small></span>
              <span className="qty">
                <button className="btn sm" disabled={busy} onClick={() => change(i.product, -1)} aria-label={`Remove one ${i.name}`}>−</button>
                <strong>{i.qty}</strong>
                <button className="btn sm" disabled={busy} onClick={() => change(i.product, 1)} aria-label={`Add one ${i.name}`}>+</button>
              </span>
            </div>
          ))}
          <div className="order-total"><span>Snacks total</span><strong>{money(total)}</strong></div>
          <button className="btn primary block" onClick={onClose}>Done</button>
        </div>
      </div>
    </Modal>
  );
}

function StopModal({ session, table, rules, offset, onClose, reload }) {
  const { user } = useApp();
  const navigate = useNavigate();
  const [frozenAt] = useState(() => Date.now() + offset);
  const [frames, setFrames] = useState(session.frames);
  const [discount, setDiscount] = useState('');
  const [run, busy] = useAction();
  const bill = computeBill(session, rules, { now: frozenAt, frames, discount: Number(discount) || 0 });

  const stop = () => run(async () => {
    const created = await post(`/sessions/${session._id}/stop`, {
      discount: Number(discount) || 0, ...(session.mode === 'frame' ? { frames: Number(frames) || 0 } : {}),
    });
    navigate(`/bills/${created._id}`);
  });
  const [asking, setAsking] = useState(false);
  const cancel = (reason) => run(async () => { await post(`/sessions/${session._id}/cancel`, { reason }); await reload(); onClose(); return true; }, 'Session cancelled');

  if (asking) {
    return (
      <PromptModal title={`Cancel ${table.name} without a bill`} label="Reason" hint="Use only for a session started by mistake. No bill is made and snacks go back to stock."
        confirmLabel="Cancel session" danger onSubmit={cancel} onClose={() => setAsking(false)} />
    );
  }

  return (
    <Modal title={`Stop ${table.name}`} onClose={onClose}>
      <p className="muted">{who(session)}</p>
      <div className="summary">
        {session.mode === 'time' ? (
          <div className="line"><span>Played {formatDuration(bill.playedSeconds)} · billed {bill.billedMinutes} min × {money(bill.rate)}/hr</span><strong>{money(bill.tableCharge)}</strong></div>
        ) : (
          <div className="line">
            <span className="row gap">Frames
              <input className="input narrow" type="number" min="0" value={frames} onChange={(e) => setFrames(e.target.value)} />× {money(bill.rate)}
            </span>
            <strong>{money(bill.tableCharge)}</strong>
          </div>
        )}
        {bill.items.map((i) => (
          <div className="line" key={i.name}><span>{i.name} × {i.qty}</span><strong>{money(i.amount)}</strong></div>
        ))}
        <div className="line">
          <span className="row gap">Discount ₹
            <input className="input narrow" type="number" min="0" value={discount} placeholder="0" onChange={(e) => setDiscount(e.target.value)} />
          </span>
          <strong>{bill.discount ? `− ${money(bill.discount)}` : '—'}</strong>
        </div>
        {bill.roundOff !== 0 && <div className="line muted"><span>Round off</span><span>{bill.roundOff > 0 ? '+' : ''}{bill.roundOff.toFixed(2)}</span></div>}
        <div className="line grand"><span>To pay</span><strong>{money(bill.total)}</strong></div>
      </div>
      <p className="muted small">The final bill is calculated by the server at the moment you press the button.</p>
      <div className="modal-foot">
        {user.role === 'admin' && <button className="btn ghost danger-text" disabled={busy} onClick={() => setAsking(true)}>Cancel session</button>}
        <span className="spacer" />
        <button className="btn ghost" onClick={onClose}>Keep playing</button>
        <button className="btn danger" disabled={busy} onClick={stop}>Stop &amp; make bill</button>
      </div>
    </Modal>
  );
}
