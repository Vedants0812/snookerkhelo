import { useState } from 'react';
import { api, post, fmtTime, waLink } from '../api.js';
import { Field, Loading, Empty, StatusBadge, useLoad, useAction } from '../ui.jsx';
import { useApp } from '../App.jsx';

const waited = (d) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(d)) / 60000));
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`;
};

export default function Waitlist() {
  const { settings } = useApp();
  const { data, error, reload } = useLoad(() => api('/waitlist'), [], 15000);
  const tables = useLoad(() => api('/tables'), [], 15000);
  const [f, setF] = useState({ name: '', phone: '', partySize: 2, tableType: 'any' });
  const [run, busy] = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const add = (e) => {
    e.preventDefault();
    run(async () => { await post('/waitlist', f); setF({ name: '', phone: '', partySize: 2, tableType: 'any' }); await reload(); }, 'Added to waiting list');
  };
  const setStatus = (w, status) => run(async () => { await post(`/waitlist/${w._id}/status`, { status }); await reload(); });
  const message = (w) => `Hi ${w.name}! A table is now free at ${settings.shopName}. Please come to the counter in the next 10 minutes to take it. 🎱`;

  const free = (tables.data?.tables || []).filter((t) => !t.session);
  const active = (data || []).filter((w) => ['waiting', 'notified'].includes(w.status));
  const done = (data || []).filter((w) => !['waiting', 'notified'].includes(w.status)).reverse();

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Waiting list</h1>
          <p className="muted">{active.length} waiting · {free.length ? `Free now: ${free.map((t) => t.name).join(', ')}` : 'All tables busy'}</p>
        </div>
      </div>

      <form className="card inline-form" onSubmit={add}>
        <Field label="Name"><input className="input" required value={f.name} onChange={set('name')} /></Field>
        <Field label="Mobile (for WhatsApp)"><input className="input" inputMode="numeric" value={f.phone} onChange={set('phone')} /></Field>
        <Field label="Players"><input className="input narrow" type="number" min="1" max="20" value={f.partySize} onChange={set('partySize')} /></Field>
        <Field label="Wants">
          <select className="input" value={f.tableType} onChange={set('tableType')}>
            <option value="any">Any table</option><option value="snooker">Snooker</option><option value="pool">Pool</option>
          </select>
        </Field>
        <button className="btn primary" disabled={busy}>Add to list</button>
      </form>

      {!data ? <Loading error={error} /> : active.length === 0 ? <Empty>Nobody is waiting.</Empty> : (
        <div className="wait-list">
          {active.map((w, i) => (
            <div className="card wait" key={w._id}>
              <div className="pos">{i + 1}</div>
              <div className="grow">
                <strong>{w.name}</strong> <StatusBadge status={w.status} />
                <div className="muted">{w.partySize} players · {w.tableType === 'any' ? 'any table' : w.tableType} · waiting {waited(w.createdAt)}
                  {w.notifiedAt ? ` · notified ${fmtTime(w.notifiedAt)}` : ''}</div>
              </div>
              <div className="row gap wrap">
                {w.phone ? (
                  <a className="btn primary" target="_blank" rel="noreferrer" href={waLink(w.phone, message(w))}
                    onClick={() => setStatus(w, 'notified')}>WhatsApp “Table free”</a>
                ) : (
                  <button className="btn" disabled={busy} onClick={() => setStatus(w, 'notified')}>Mark called</button>
                )}
                <button className="btn" disabled={busy} onClick={() => setStatus(w, 'seated')}>Seated</button>
                <button className="btn ghost" disabled={busy} onClick={() => setStatus(w, 'left')}>Left</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {done.length > 0 && (
        <>
          <h3 className="section-title">Earlier today</h3>
          <div className="table-wrap"><table className="data">
            <tbody>{done.map((w) => (
              <tr key={w._id}><td>{w.name}</td><td>{w.partySize} players</td><td>{fmtTime(w.createdAt)}</td><td><StatusBadge status={w.status} /></td></tr>
            ))}</tbody>
          </table></div>
        </>
      )}
    </>
  );
}
