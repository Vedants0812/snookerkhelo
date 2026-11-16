import { useState } from 'react';
import { api, post, put, del, money } from '../api.js';
import { Modal, Field, Loading, Empty, useLoad, useAction } from '../ui.jsx';
import { useApp } from '../App.jsx';

export default function Settings() {
  const [tab, setTab] = useState('tables');
  const tabs = [['tables', 'Tables & rates'], ['shop', 'Shop & UPI'], ['billing', 'Billing rules'], ['staff', 'Staff logins'], ['password', 'My password']];
  return (
    <>
      <div className="page-head"><div><h1>Settings</h1></div></div>
      <div className="tabs">{tabs.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === 'tables' && <TablesTab />}
      {tab === 'shop' && <ShopTab />}
      {tab === 'billing' && <BillingTab />}
      {tab === 'staff' && <StaffTab />}
      {tab === 'password' && <PasswordTab />}
    </>
  );
}

// ---------- tables ----------
function TablesTab() {
  const { data, error, reload } = useLoad(() => api('/tables?all=1'), []);
  const [edit, setEdit] = useState(null);
  if (!data) return <Loading error={error} />;
  return (
    <>
      <div className="toolbar"><button className="btn primary" onClick={() => setEdit({})}>+ Add table</button></div>
      {data.tables.length === 0 ? <Empty>Add your first table to start billing.</Empty> : (
        <div className="table-wrap"><table className="data">
          <thead><tr><th>Table</th><th>Type</th><th className="num">Per hour</th><th className="num">Per frame</th><th>Default billing</th><th>Status</th><th /></tr></thead>
          <tbody>{data.tables.map((t) => (
            <tr key={t._id} className={t.active ? '' : 'dim'}>
              <td>{t.name}</td><td>{t.type}</td>
              <td className="num">{t.ratePerHour ? money(t.ratePerHour) : '—'}</td><td className="num">{t.ratePerFrame ? money(t.ratePerFrame) : '—'}</td>
              <td>{t.defaultMode === 'frame' ? 'Per frame' : 'By time'}</td><td>{t.active ? 'Active' : 'Hidden'}</td>
              <td className="num"><button className="btn sm" onClick={() => setEdit(t)}>Edit</button></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <p className="muted small">Changing a rate only affects sessions started after the change — running tables keep the rate they started with.</p>
      {edit && <TableForm table={edit} count={data.tables.length} onClose={() => setEdit(null)} reload={reload} />}
    </>
  );
}

function TableForm({ table, count, onClose, reload }) {
  const [f, setF] = useState({
    name: table.name || '', type: table.type || 'snooker', ratePerHour: table.ratePerHour ?? '', ratePerFrame: table.ratePerFrame ?? '',
    defaultMode: table.defaultMode || 'time', sortOrder: table.sortOrder ?? count + 1, active: table.active ?? true,
  });
  const [run, busy] = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = (e) => {
    e.preventDefault();
    run(async () => {
      const body = { ...f, ratePerHour: f.ratePerHour || 0, ratePerFrame: f.ratePerFrame || 0 };
      if (table._id) await put(`/tables/${table._id}`, body); else await post('/tables', body);
      await reload(); onClose();
    }, 'Saved');
  };
  const remove = () => window.confirm(`Remove ${table.name}? Tables with past bills are hidden instead of deleted.`)
    && run(async () => { await del(`/tables/${table._id}`); await reload(); onClose(); }, 'Removed');
  return (
    <Modal title={table._id ? 'Edit table' : 'Add table'} onClose={onClose}>
      <form onSubmit={save}>
        <div className="row gap">
          <Field label="Table name"><input className="input" required autoFocus value={f.name} onChange={set('name')} placeholder="Snooker 1" /></Field>
          <Field label="Type">
            <select className="input" value={f.type} onChange={set('type')}><option value="snooker">Snooker</option><option value="pool">Pool</option><option value="other">Other</option></select>
          </Field>
        </div>
        <div className="row gap">
          <Field label="Rate per hour (₹)" hint="0 = not offered"><input className="input" type="number" min="0" value={f.ratePerHour} onChange={set('ratePerHour')} /></Field>
          <Field label="Rate per frame (₹)" hint="0 = not offered"><input className="input" type="number" min="0" value={f.ratePerFrame} onChange={set('ratePerFrame')} /></Field>
        </div>
        <div className="row gap">
          <Field label="Default billing">
            <select className="input" value={f.defaultMode} onChange={set('defaultMode')}><option value="time">By time</option><option value="frame">Per frame</option></select>
          </Field>
          <Field label="Display order"><input className="input" type="number" min="0" value={f.sortOrder} onChange={set('sortOrder')} /></Field>
        </div>
        {table._id && <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Show on the Tables screen</label>}
        <div className="modal-foot">
          {table._id && <button type="button" className="btn ghost danger-text" onClick={remove}>Remove</button>}
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>Save</button>
        </div>
      </form>
    </Modal>
  );
}

// ---------- shop / UPI / features ----------
function ShopTab() {
  const { settings, reloadSettings } = useApp();
  const [f, setF] = useState({
    shopName: settings.shopName, address: settings.address, phone: settings.phone, upiId: settings.upiId, upiPayeeName: settings.upiPayeeName,
    googleReviewLink: settings.googleReviewLink, googleMapsLink: settings.googleMapsLink, receiptFooter: settings.receiptFooter,
    features: { ...settings.features },
  });
  const [run, busy] = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const feat = (k) => (e) => setF({ ...f, features: { ...f.features, [k]: e.target.checked } });
  const save = (e) => { e.preventDefault(); run(async () => { await put('/settings', f); await reloadSettings(); }, 'Settings saved'); };
  return (
    <form className="card form" onSubmit={save}>
      <h3>Shop details (printed on bills)</h3>
      <Field label="Shop name"><input className="input" required value={f.shopName} onChange={set('shopName')} /></Field>
      <Field label="Address"><input className="input" value={f.address} onChange={set('address')} /></Field>
      <Field label="Phone"><input className="input" value={f.phone} onChange={set('phone')} /></Field>
      <Field label="Bill footer message"><input className="input" value={f.receiptFooter} onChange={set('receiptFooter')} /></Field>

      <h3>UPI payment QR</h3>
      <div className="row gap">
        <Field label="UPI ID" hint="e.g. shopname@okhdfcbank — a QR for the exact bill amount is printed on every bill"><input className="input" value={f.upiId} onChange={set('upiId')} /></Field>
        <Field label="Payee name" hint="Name shown in the customer's UPI app"><input className="input" value={f.upiPayeeName} onChange={set('upiPayeeName')} /></Field>
      </div>

      <h3>Google profile</h3>
      <Field label="Google review link" hint="Added to WhatsApp bills so happy customers can rate you"><input className="input" value={f.googleReviewLink} onChange={set('googleReviewLink')} /></Field>
      <Field label="Google Maps link" hint="Shown on the public tournament page"><input className="input" value={f.googleMapsLink} onChange={set('googleMapsLink')} /></Field>

      <h3>Add-on features</h3>
      <label className="check"><input type="checkbox" checked={f.features.playerPass} onChange={feat('playerPass')} /> Player Pass — prepaid balance for regular players</label>
      <label className="check"><input type="checkbox" checked={f.features.waitlist} onChange={feat('waitlist')} /> Waiting list with one-tap WhatsApp “Table free” message</label>

      <div className="modal-foot"><button className="btn primary" disabled={busy}>Save settings</button></div>
    </form>
  );
}

function BillingTab() {
  const { settings, reloadSettings } = useApp();
  const [f, setF] = useState({ ...settings.billing });
  const [run, busy] = useAction();
  const save = (e) => { e.preventDefault(); run(async () => { await put('/settings', { billing: f }); await reloadSettings(); }, 'Billing rules saved'); };
  const example = Math.max(Math.ceil(37 / (Number(f.roundToMinutes) || 1)) * (Number(f.roundToMinutes) || 1), Number(f.minMinutes) || 0);
  return (
    <form className="card form" onSubmit={save}>
      <h3>How time is charged</h3>
      <div className="row gap">
        <Field label="Bill in blocks of (minutes)" hint="1 = exact per-minute billing. 15 = every started 15 minutes is charged.">
          <input className="input" type="number" min="1" max="60" value={f.roundToMinutes} onChange={(e) => setF({ ...f, roundToMinutes: e.target.value })} />
        </Field>
        <Field label="Minimum charge (minutes)" hint="e.g. 30 = at least half an hour is charged. 0 = no minimum.">
          <input className="input" type="number" min="0" max="240" value={f.minMinutes} onChange={(e) => setF({ ...f, minMinutes: e.target.value })} />
        </Field>
      </div>
      <p className="muted small">Example: a game of 37 minutes at ₹200/hr is billed as <strong>{example} minutes = {money(Math.round((example * 200) / 60 * 100) / 100)}</strong>.</p>
      <label className="check"><input type="checkbox" checked={f.roundTotal} onChange={(e) => setF({ ...f, roundTotal: e.target.checked })} /> Round the bill total to the nearest rupee</label>
      <h3>Business day</h3>
      <Field label="Day starts at (hour, 0–12)" hint="If you close after midnight, set e.g. 6 so that a bill paid at 1 AM is counted in the previous day's earnings.">
        <input className="input narrow" type="number" min="0" max="12" value={f.dayStartHour} onChange={(e) => setF({ ...f, dayStartHour: e.target.value })} />
      </Field>
      <div className="modal-foot"><button className="btn primary" disabled={busy}>Save rules</button></div>
    </form>
  );
}

// ---------- staff ----------
function StaffTab() {
  const { user } = useApp();
  const { data, error, reload } = useLoad(() => api('/users'), []);
  const [edit, setEdit] = useState(null);
  if (!data) return <Loading error={error} />;
  return (
    <>
      <div className="toolbar"><button className="btn primary" onClick={() => setEdit({})}>+ Add staff login</button></div>
      <div className="table-wrap"><table className="data">
        <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th /></tr></thead>
        <tbody>{data.map((u) => (
          <tr key={u.id} className={u.active ? '' : 'dim'}>
            <td>{u.name}{u.id === user.id ? ' (you)' : ''}</td><td>{u.username}</td><td>{u.role === 'admin' ? 'Owner' : 'Staff'}</td><td>{u.active ? 'Active' : 'Disabled'}</td>
            <td className="num"><button className="btn sm" onClick={() => setEdit(u)}>Edit</button></td>
          </tr>
        ))}</tbody>
      </table></div>
      <p className="muted small">Staff can run tables, make bills and manage players. Only owners see reports, settings, rates and can void bills.</p>
      {edit && <StaffForm u={edit} self={edit.id === user.id} onClose={() => setEdit(null)} reload={reload} />}
    </>
  );
}

function StaffForm({ u, self, onClose, reload }) {
  const [f, setF] = useState({ name: u.name || '', username: u.username || '', password: '', role: u.role || 'staff', active: u.active ?? true });
  const [run, busy] = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = (e) => {
    e.preventDefault();
    run(async () => { if (u.id) await put(`/users/${u.id}`, f); else await post('/users', f); await reload(); onClose(); }, 'Saved');
  };
  return (
    <Modal title={u.id ? 'Edit login' : 'Add staff login'} onClose={onClose}>
      <form onSubmit={save}>
        <Field label="Name"><input className="input" required autoFocus value={f.name} onChange={set('name')} /></Field>
        <Field label="Username"><input className="input" required disabled={!!u.id} autoComplete="off" value={f.username} onChange={set('username')} /></Field>
        <Field label={u.id ? 'New password (leave empty to keep)' : 'Password'} hint="At least 6 characters">
          <input className="input" type="password" autoComplete="new-password" required={!u.id} minLength="6" value={f.password} onChange={set('password')} />
        </Field>
        {!self && (
          <>
            <Field label="Role"><select className="input" value={f.role} onChange={set('role')}><option value="staff">Staff</option><option value="admin">Owner (full access)</option></select></Field>
            {u.id && <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Login enabled</label>}
          </>
        )}
        <div className="modal-foot">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>Save</button>
        </div>
      </form>
    </Modal>
  );
}

function PasswordTab() {
  const [f, setF] = useState({ current: '', next: '' });
  const [run, busy] = useAction();
  const save = (e) => { e.preventDefault(); run(async () => { await post('/auth/change-password', f); setF({ current: '', next: '' }); }, 'Password changed'); };
  return (
    <form className="card form" onSubmit={save}>
      <h3>Change my password</h3>
      <Field label="Current password"><input className="input" type="password" required autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} /></Field>
      <Field label="New password" hint="At least 6 characters"><input className="input" type="password" required minLength="6" autoComplete="new-password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} /></Field>
      <div className="modal-foot"><button className="btn primary" disabled={busy}>Change password</button></div>
    </form>
  );
}
