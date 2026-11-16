import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, post, money, plural, fmtTime, fmtDate, todayIST, METHOD_LABEL } from '../api.js';
import { Modal, Field, Loading, Empty, StatusBadge, PlayerPicker, useLoad, useAction } from '../ui.jsx';
import { ProductGrid } from './Tables.jsx';

export default function Bills() {
  const [date, setDate] = useState(todayIST());
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [counter, setCounter] = useState(false);
  const query = new URLSearchParams({ ...(q ? { q } : { date }), ...(status ? { status } : {}) });
  const { data, error } = useLoad(() => api(`/bills?${query}`), [date, status, q]);

  const paid = data?.filter((b) => b.status === 'paid') || [];
  const unpaid = data?.filter((b) => b.status === 'unpaid') || [];
  const sum = (list) => list.reduce((s, b) => s + b.total, 0);

  return (
    <>
      <div className="page-head">
        <div><h1>Bills</h1><p className="muted">{q ? 'Search across all dates' : fmtDate(`${date}T12:00:00+05:30`)}</p></div>
        <button className="btn primary" onClick={() => setCounter(true)}>+ Counter sale</button>
      </div>

      <div className="toolbar">
        <input className="input" type="date" value={date} max={todayIST()} disabled={!!q} onChange={(e) => e.target.value && setDate(e.target.value)} />
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All bills</option><option value="unpaid">Unpaid</option><option value="paid">Paid</option><option value="void">Void</option>
        </select>
        <input className="input grow" placeholder="Search bill no, customer or table…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {!data ? <Loading error={error} /> : (
        <>
          <div className="stats">
            <div className="stat"><small>Paid</small><strong>{money(sum(paid))}</strong><span>{plural(paid.length, 'bill')}</span></div>
            <div className={`stat ${unpaid.length ? 'warn' : ''}`}><small>Unpaid</small><strong>{money(sum(unpaid))}</strong><span>{plural(unpaid.length, 'bill')}</span></div>
          </div>
          {data.length === 0 ? <Empty>No bills found.</Empty> : (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Bill</th><th>Time</th><th>Table</th><th>Customer</th><th className="num">Amount</th><th>Payment</th><th>Status</th></tr></thead>
                <tbody>
                  {data.map((b) => (
                    <tr key={b._id}>
                      <td><Link to={`/bills/${b._id}`}>{b.code}</Link></td>
                      <td>{q ? `${fmtDate(b.createdAt)} ` : ''}{fmtTime(b.createdAt)}</td>
                      <td>{b.tableName}</td>
                      <td>{b.customerName}</td>
                      <td className="num">{money(b.total)}</td>
                      <td>{METHOD_LABEL[b.paymentMethod] || '—'}</td>
                      <td><StatusBadge status={b.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {counter && <CounterSale onClose={() => setCounter(false)} />}
    </>
  );
}

function CounterSale({ onClose }) {
  const navigate = useNavigate();
  const products = useLoad(() => api('/products'), []);
  const [cart, setCart] = useState({}); // productId -> qty
  const [players, setPlayers] = useState([]);
  const [run, busy] = useAction();
  const list = (products.data || []).filter((p) => cart[p._id]);
  const total = list.reduce((s, p) => s + p.price * cart[p._id], 0);
  const bump = (p, d) => setCart((c) => {
    const max = p.stock === null ? 100 : p.stock;
    return { ...c, [p._id]: Math.max(0, Math.min(max, (c[p._id] || 0) + d)) };
  });
  const create = () => run(async () => {
    const bill = await post('/bills/counter', {
      items: list.map((p) => ({ productId: p._id, qty: cart[p._id] })), playerId: players[0]?._id,
    });
    navigate(`/bills/${bill._id}`);
  });

  return (
    <Modal title="Counter sale (snacks only)" onClose={onClose} wide>
      <div className="split">
        <div>{products.data ? <ProductGrid products={products.data} onAdd={(p) => bump(p, 1)} /> : <Loading error={products.error} />}</div>
        <div className="order">
          <h4>Items</h4>
          {list.length === 0 && <p className="muted">Tap items to add them.</p>}
          {list.map((p) => (
            <div className="order-line" key={p._id}>
              <span>{p.name}</span>
              <span className="qty">
                <button className="btn sm" onClick={() => bump(p, -1)} aria-label={`Remove one ${p.name}`}>−</button>
                <strong>{cart[p._id]}</strong>
                <button className="btn sm" onClick={() => bump(p, 1)} aria-label={`Add one ${p.name}`}>+</button>
              </span>
            </div>
          ))}
          <Field label="Player (optional)"><PlayerPicker single selected={players} onChange={setPlayers} /></Field>
          <div className="order-total"><span>Total</span><strong>{money(total)}</strong></div>
          <button className="btn primary block" disabled={busy || !list.length} onClick={create}>Make bill</button>
        </div>
      </div>
    </Modal>
  );
}
