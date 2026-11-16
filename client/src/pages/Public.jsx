// Public pages (no login) that the parlour shares with players:
//   /t      - all tournaments      /t/:id - registration form + live leaderboard
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, post, money, fmtDate } from '../api.js';
import { Field, Loading, Empty, StatusBadge, useLoad } from '../ui.jsx';
import { Leaderboard } from './Tournaments.jsx';
import { CueBall } from '../art.jsx';

function PublicShell({ children }) {
  const { data } = useLoad(() => api('/public/info'), []);
  return (
    <div className="public">
      <header className="public-head">
        <div className="brand big"><CueBall /><span>{data?.shopName || ' '}</span></div>
        {data?.address && <p className="muted">{data.address}{data.phone ? ` · ${data.phone}` : ''}</p>}
        {data?.googleMapsLink && <a href={data.googleMapsLink} target="_blank" rel="noreferrer">Find us on Google Maps →</a>}
      </header>
      {children}
    </div>
  );
}

export function PublicTournaments() {
  const { data, error } = useLoad(() => api('/public/tournaments'), []);
  return (
    <PublicShell>
      <h1>Tournaments</h1>
      {!data ? <Loading error={error} /> : data.length === 0 ? <Empty>No tournaments announced yet.</Empty> : (
        <div className="grid cards">
          {data.map((t) => (
            <Link className="card tcard" key={t.id} to={`/t/${t.id}`}>
              <div className="row between"><h3>{t.name}</h3><StatusBadge status={t.status} /></div>
              <p className="muted">{t.game}{t.date ? ` · ${fmtDate(t.date)}` : ''}</p>
              <div className="row gap wrap small">
                <span>{t.registered}{t.maxPlayers ? `/${t.maxPlayers}` : ''} players</span>
                <span>Entry {money(t.entryFee)}</span>
                {t.prize && <span>{t.prize}</span>}
              </div>
              <span className="btn primary block">{t.status === 'open' && !t.full ? 'Register / view' : 'View leaderboard'}</span>
            </Link>
          ))}
        </div>
      )}
    </PublicShell>
  );
}

export function PublicTournament() {
  const { id } = useParams();
  const { data: t, error, setData } = useLoad(() => api(`/public/tournaments/${id}`), [id], 30000);
  const [f, setF] = useState({ name: '', phone: '' });
  const [msg, setMsg] = useState({ ok: '', err: '' });
  const [busy, setBusy] = useState(false);

  const register = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg({ ok: '', err: '' });
    try {
      setData(await post(`/public/tournaments/${id}/register`, f));
      setMsg({ ok: `You're in, ${f.name}! Pay the entry fee at the counter to confirm your spot.`, err: '' });
      setF({ name: '', phone: '' });
    } catch (err) { setMsg({ ok: '', err: err.message }); } finally { setBusy(false); }
  };

  if (!t) return <PublicShell><Loading error={error} /></PublicShell>;
  const rounds = [...new Set(t.matches.map((m) => m.round))];
  const canRegister = t.status === 'open' && !t.full;

  return (
    <PublicShell>
      <p><Link to="/t">← All tournaments</Link></p>
      <div className="row between wrap"><h1>{t.name}</h1><StatusBadge status={t.status} /></div>
      <p className="muted">{t.game}{t.date ? ` · ${fmtDate(t.date)}` : ''} · Entry {money(t.entryFee)} · {t.registered}{t.maxPlayers ? `/${t.maxPlayers}` : ''} players</p>
      {t.prize && <p><strong>Prize:</strong> {t.prize}</p>}
      {t.description && <p className="pre">{t.description}</p>}

      {msg.ok && <div className="success">{msg.ok}</div>}
      {canRegister ? (
        <form className="card inline-form" onSubmit={register}>
          <Field label="Your name"><input className="input" required maxLength="60" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Mobile number"><input className="input" required inputMode="numeric" maxLength="13" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          <button className="btn primary" disabled={busy}>{busy ? 'Registering…' : 'Register'}</button>
          {msg.err && <div className="error full">{msg.err}</div>}
        </form>
      ) : (
        <div className="card muted">{t.full && t.status === 'open' ? 'All spots are taken.' : 'Registration is closed.'}</div>
      )}

      <h3 className="section-title">Leaderboard</h3>
      <Leaderboard rows={t.leaderboard} />

      {rounds.map((round) => (
        <section key={round}>
          <h3 className="section-title">{round}</h3>
          <div className="matches">
            {t.matches.filter((m) => m.round === round).map((m, i) => (
              <div className={`card match ${m.status}`} key={i}>
                <span className={m.winner === m.p1 ? 'win' : ''}>{m.p1}</span>
                <strong>{m.status === 'done' ? `${m.score1} – ${m.score2}` : 'vs'}</strong>
                <span className={m.winner === m.p2 ? 'win' : ''}>{m.p2}</span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </PublicShell>
  );
}
