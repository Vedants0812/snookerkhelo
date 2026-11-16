import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, post, put, del, money, fmtDate, fmtDateTime, METHOD_LABEL } from '../api.js';
import { Modal, Field, Loading, Empty, StatusBadge, PayMethodSelect, useLoad, useAction } from '../ui.jsx';
import { useApp } from '../App.jsx';

export default function Players() {
  const { settings } = useApp();
  const pass = settings.features.playerPass;
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('name');
  const [edit, setEdit] = useState(null);
  const { data, error, reload } = useLoad(() => api(`/players?sort=${sort}&q=${encodeURIComponent(q)}`), [q, sort]);

  return (
    <>
      <div className="page-head">
        <div><h1>Players</h1><p className="muted">{data ? `${data.length} players` : ''}</p></div>
        <button className="btn primary" onClick={() => setEdit({})}>+ Add player</button>
      </div>
      <div className="toolbar">
        <input className="input grow" placeholder="Search name or mobile…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="name">A–Z</option><option value="recent">Recent visit</option><option value="spent">Top spenders</option>
        </select>
      </div>
      {!data ? <Loading error={error} /> : data.length === 0 ? <Empty>No players found.</Empty> : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Name</th><th>Mobile</th><th className="num">Visits</th><th className="num">Spent</th>{pass && <th className="num">Pass balance</th>}<th>Last visit</th></tr></thead>
            <tbody>
              {data.map((p) => (
                <tr key={p._id}>
                  <td><Link to={`/players/${p._id}`}>{p.name}</Link></td>
                  <td>{p.phone || '—'}</td>
                  <td className="num">{p.visits}</td>
                  <td className="num">{money(p.totalSpent)}</td>
                  {pass && <td className="num">{p.passBalance > 0 ? <strong>{money(p.passBalance)}</strong> : '—'}</td>}
                  <td>{fmtDate(p.lastVisitAt) || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit && <PlayerForm player={edit} onClose={() => setEdit(null)} reload={reload} />}
    </>
  );
}

function PlayerForm({ player, onClose, reload }) {
  const [f, setF] = useState({ name: player.name || '', phone: player.phone || '', notes: player.notes || '' });
  const [run, busy] = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = (e) => {
    e.preventDefault();
    run(async () => {
      if (player._id) await put(`/players/${player._id}`, f); else await post('/players', f);
      await reload(); onClose();
    }, 'Saved');
  };
  return (
    <Modal title={player._id ? 'Edit player' : 'Add player'} onClose={onClose}>
      <form onSubmit={save}>
        <Field label="Name"><input className="input" required autoFocus value={f.name} onChange={set('name')} /></Field>
        <Field label="Mobile" hint="10 digits. Used for WhatsApp bills and notifications."><input className="input" inputMode="numeric" value={f.phone} onChange={set('phone')} /></Field>
        <Field label="Notes"><input className="input" value={f.notes} onChange={set('notes')} /></Field>
        <div className="modal-foot">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>Save</button>
        </div>
      </form>
    </Modal>
  );
}

export function PlayerDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { settings, user } = useApp();
  const admin = user.role === 'admin';
  const pass = settings.features.playerPass;
  const { data, error, reload } = useLoad(() => api(`/players/${id}`), [id]);
  const [modal, setModal] = useState('');
  const [run] = useAction();
  if (!data) return <Loading error={error} />;
  const { player: p, bills, txns, due } = data;

  const remove = () => window.confirm(`Remove ${p.name} from the player list?`)
    && run(async () => { await del(`/players/${p._id}`); navigate('/players'); }, 'Player removed');

  return (
    <>
      <div className="page-head">
        <div><h1>{p.name}</h1><p className="muted"><Link to="/players">← Players</Link>{p.phone ? ` · ${p.phone}` : ''}{p.notes ? ` · ${p.notes}` : ''}</p></div>
        <div className="row gap wrap">
          <button className="btn" onClick={() => setModal('edit')}>Edit</button>
          {admin && <button className="btn ghost danger-text" onClick={remove}>Remove</button>}
        </div>
      </div>

      <div className="stats">
        {pass && (
          <div className="stat accent">
            <small>Pass balance</small><strong>{money(p.passBalance)}</strong>
            <span className="row gap">
              <button className="btn sm primary" onClick={() => setModal('topup')}>Top up</button>
              {admin && <button className="btn sm" onClick={() => setModal('adjust')}>Adjust</button>}
            </span>
          </div>
        )}
        <div className="stat"><small>Visits</small><strong>{p.visits}</strong><span>last {fmtDate(p.lastVisitAt) || '—'}</span></div>
        <div className="stat"><small>Total spent</small><strong>{money(p.totalSpent)}</strong></div>
        <div className={`stat ${due > 0 ? 'warn' : ''}`}><small>Unpaid bills</small><strong>{money(due)}</strong></div>
      </div>

      <div className="two-col">
        <section>
          <h3>Bills</h3>
          {bills.length === 0 ? <Empty>No bills yet.</Empty> : (
            <div className="table-wrap"><table className="data">
              <thead><tr><th>Bill</th><th>Date</th><th>Table</th><th className="num">Amount</th><th>Status</th></tr></thead>
              <tbody>{bills.map((b) => (
                <tr key={b._id}><td><Link to={`/bills/${b._id}`}>{b.code}</Link></td><td>{fmtDate(b.createdAt)}</td><td>{b.tableName}</td>
                  <td className="num">{money(b.total)}</td><td><StatusBadge status={b.status} /></td></tr>
              ))}</tbody>
            </table></div>
          )}
        </section>
        {pass && (
          <section>
            <h3>Pass history</h3>
            {txns.length === 0 ? <Empty>No pass activity yet.</Empty> : (
              <div className="table-wrap"><table className="data">
                <thead><tr><th>When</th><th>Type</th><th className="num">Amount</th><th className="num">Balance</th></tr></thead>
                <tbody>{txns.map((t) => (
                  <tr key={t._id}>
                    <td>{fmtDateTime(t.createdAt)}</td>
                    <td>{t.type}{t.method ? ` · ${METHOD_LABEL[t.method]}` : ''}{t.note ? <small className="muted"> {t.note}</small> : ''}</td>
                    <td className={`num ${t.amount < 0 ? 'bad' : 'good'}`}>{t.amount > 0 ? '+' : '−'}{money(Math.abs(t.amount))}</td>
                    <td className="num">{money(t.balanceAfter)}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </section>
        )}
      </div>

      {modal === 'edit' && <PlayerForm player={p} onClose={() => setModal('')} reload={reload} />}
      {modal === 'topup' && <TopUp player={p} onClose={() => setModal('')} reload={reload} />}
      {modal === 'adjust' && <Adjust player={p} onClose={() => setModal('')} reload={reload} />}
    </>
  );
}

function TopUp({ player, onClose, reload }) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [run, busy] = useAction();
  const save = (e) => {
    e.preventDefault();
    run(async () => { await post(`/players/${player._id}/topup`, { amount, method }); await reload(); onClose(); }, `Pass topped up by ${money(amount)}`);
  };
  return (
    <Modal title={`Top up pass · ${player.name}`} onClose={onClose}>
      <form onSubmit={save}>
        <Field label="Amount received (₹)">
          <input className="input" type="number" min="1" required autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <div className="row gap wrap quick">
          {[500, 1000, 2000, 5000].map((a) => <button type="button" className="btn sm" key={a} onClick={() => setAmount(String(a))}>{money(a)}</button>)}
        </div>
        <Field label="Paid by"><PayMethodSelect value={method} onChange={setMethod} /></Field>
        <p className="muted small">Balance after top-up: <strong>{money(player.passBalance + (Number(amount) || 0))}</strong></p>
        <div className="modal-foot">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || !(Number(amount) > 0)}>Add to pass</button>
        </div>
      </form>
    </Modal>
  );
}

function Adjust({ player, onClose, reload }) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [run, busy] = useAction();
  const save = (e) => {
    e.preventDefault();
    run(async () => { await post(`/players/${player._id}/adjust`, { amount: Number(amount), note }); await reload(); onClose(); }, 'Balance adjusted');
  };
  return (
    <Modal title={`Adjust pass · ${player.name}`} onClose={onClose}>
      <form onSubmit={save}>
        <p className="muted small">For corrections or bonus credit only. This is not counted as money received in reports.</p>
        <Field label="Amount (use − to reduce)"><input className="input" type="number" required autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 100 or -50" /></Field>
        <Field label="Reason"><input className="input" required value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <div className="modal-foot">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>Apply</button>
        </div>
      </form>
    </Modal>
  );
}
