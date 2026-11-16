import { useState } from 'react';
import { Link } from 'react-router-dom';
import { post, setToken, DEMO } from '../api.js';
import { CueBall, TableArt } from '../art.jsx';

// Demo build only: the sample owner / staff logins created by src/demo/backend.js.
const DEMO_LOGINS = [
  { label: 'Owner', note: 'Everything', username: 'owner', password: 'demo123' },
  { label: 'Staff', note: 'Counter only', username: 'staff', password: 'staff123' },
];

export default function Login({ onDone }) {
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const signIn = async (creds) => {
    setBusy(true); setError('');
    try {
      const { token } = await post('/auth/login', creds);
      setToken(token);
      await onDone();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const submit = (e) => { e.preventDefault(); signIn(form); };

  return (
    <div className="login">
      <div className="login-hero">
        <div className="kicker">Snooker &amp; pool parlour software</div>
        <h1>Run the floor.<br /><em>Every table, every rupee.</em></h1>
        <p>Live table timers, automatic bills with UPI QR, player passes, waiting list and tournaments — on the counter PC or your phone.</p>
        <TableArt type="snooker" state="running" />
        <div className="login-points">
          <span>Per-minute &amp; per-frame billing</span><span>UPI QR on every bill</span><span>Daily earnings report</span>
        </div>
      </div>

      <form className="card login-card" onSubmit={submit}>
        <div className="brand big"><CueBall /><span>Parlour Manager</span></div>
        <p className="muted">Sign in to manage tables, billing and players.</p>
        {DEMO && (
          <>
            <div className="demo-logins">
              {DEMO_LOGINS.map((d) => (
                <button type="button" key={d.username} className={`btn ${d.username === 'owner' ? 'primary' : ''}`} disabled={busy}
                  onClick={() => signIn({ username: d.username, password: d.password })}>
                  Enter as {d.label}<small>{d.note}</small>
                </button>
              ))}
            </div>
            <div className="divider">or sign in</div>
          </>
        )}
        <label className="field"><span>Username</span>
          <input className="input" autoFocus={!DEMO} autoComplete="username" value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })} />
        </label>
        <label className="field"><span>Password</span>
          <input className="input" type="password" autoComplete="current-password" value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </label>
        {error && <div className="error">{error}</div>}
        <button className="btn primary block" disabled={busy || !form.username || !form.password}>{busy ? 'Signing in…' : 'Sign in'}</button>
        {DEMO && <p className="muted small" style={{ marginTop: 12 }}>Players use the public tournament page without logging in: <Link to="/t">open it →</Link></p>}
      </form>
    </div>
  );
}
