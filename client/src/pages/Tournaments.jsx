import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, post, put, del, money, fmtDate } from '../api.js';
import { Modal, Field, Loading, Empty, StatusBadge, PayMethodSelect, useLoad, useAction, useToast } from '../ui.jsx';
import { useApp } from '../App.jsx';

const toInputDate = (d) => (d ? new Date(new Date(d).getTime() + 330 * 60000).toISOString().slice(0, 10) : '');

export default function Tournaments() {
  const admin = useApp().user.role === 'admin';
  const { data, error, reload } = useLoad(() => api('/tournaments'), []);
  const [form, setForm] = useState(false);
  return (
    <>
      <div className="page-head">
        <div><h1>Tournaments</h1><p className="muted">Registration and live leaderboard. Public page: <a href="/t" target="_blank" rel="noreferrer">/t</a></p></div>
        {admin && <button className="btn primary" onClick={() => setForm(true)}>+ New tournament</button>}
      </div>
      {!data ? <Loading error={error} /> : data.length === 0 ? <Empty>No tournaments yet.</Empty> : (
        <div className="grid cards">
          {data.map((t) => (
            <Link className="card tcard" key={t._id} to={`/tournaments/${t._id}`}>
              <div className="row between"><h3>{t.name}</h3><StatusBadge status={t.status} /></div>
              <p className="muted">{t.game}{t.date ? ` · ${fmtDate(t.date)}` : ''}</p>
              <div className="row gap wrap small">
                <span>{t.registered}{t.maxPlayers ? `/${t.maxPlayers}` : ''} players</span>
                <span>{t.paidCount} paid</span>
                <span>Entry {money(t.entryFee)}</span>
                {t.leader && <span>Leader: <strong>{t.leader}</strong></span>}
              </div>
            </Link>
          ))}
        </div>
      )}
      {form && <TournamentForm t={{}} onClose={() => setForm(false)} onSaved={reload} />}
    </>
  );
}

function TournamentForm({ t, onClose, onSaved }) {
  const [f, setF] = useState({
    name: t.name || '', game: t.game || '8 Ball Pool', date: toInputDate(t.date), entryFee: t.entryFee ?? 0,
    maxPlayers: t.maxPlayers ?? 16, prize: t.prize || '', description: t.description || '',
  });
  const [run, busy] = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = (e) => {
    e.preventDefault();
    run(async () => {
      const body = { ...f, date: f.date ? `${f.date}T12:00:00+05:30` : null };
      const out = t._id ? await put(`/tournaments/${t._id}`, body) : await post('/tournaments', body);
      await onSaved(out); onClose();
    }, 'Saved');
  };
  return (
    <Modal title={t._id ? 'Edit tournament' : 'New tournament'} onClose={onClose}>
      <form onSubmit={save}>
        <Field label="Name"><input className="input" required autoFocus value={f.name} onChange={set('name')} /></Field>
        <div className="row gap">
          <Field label="Game"><input className="input" value={f.game} onChange={set('game')} /></Field>
          <Field label="Date"><input className="input" type="date" value={f.date} onChange={set('date')} /></Field>
        </div>
        <div className="row gap">
          <Field label="Entry fee (₹)"><input className="input" type="number" min="0" value={f.entryFee} onChange={set('entryFee')} /></Field>
          <Field label="Max players" hint="0 = no limit"><input className="input" type="number" min="0" value={f.maxPlayers} onChange={set('maxPlayers')} /></Field>
        </div>
        <Field label="Prize"><input className="input" value={f.prize} onChange={set('prize')} /></Field>
        <Field label="Details / rules"><textarea className="input" rows="3" value={f.description} onChange={set('description')} /></Field>
        <div className="modal-foot">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>Save</button>
        </div>
      </form>
    </Modal>
  );
}

export function TournamentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const admin = useApp().user.role === 'admin';
  const { data: t, error, setData } = useLoad(() => api(`/tournaments/${id}`), [id]);
  const [tab, setTab] = useState('players');
  const [modal, setModal] = useState(null);
  const [run, busy] = useAction();
  if (!t) return <Loading error={error} />;

  const base = `/tournaments/${t._id}`;
  const names = new Map(t.registrations.map((g) => [g._id, g.name]));
  const publicUrl = `${window.location.origin}/t/${t._id}`;
  const act = (fn, msg) => run(async () => setData(await fn()), msg);
  const copy = async () => {
    try { await navigator.clipboard.writeText(publicUrl); toast('Public link copied'); }
    catch { window.prompt('Copy this link:', publicUrl); }
  };
  const remove = () => window.confirm(`Delete "${t.name}"?`) && run(async () => { await del(base); navigate('/tournaments'); }, 'Deleted');
  const rounds = [...new Set(t.matches.map((m) => m.round))];
  const collected = t.registrations.reduce((s, g) => s + (g.paid ? g.paidAmount : 0), 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t.name}</h1>
          <p className="muted"><Link to="/tournaments">← Tournaments</Link> · {t.game}{t.date ? ` · ${fmtDate(t.date)}` : ''}{t.prize ? ` · ${t.prize}` : ''}</p>
        </div>
        <div className="row gap wrap">
          <button className="btn" onClick={copy}>Copy public link</button>
          {admin && (
            <>
              <select className="input" value={t.status} onChange={(e) => act(() => put(base, { status: e.target.value }))} aria-label="Status">
                <option value="open">Registration open</option><option value="ongoing">Ongoing</option><option value="completed">Completed</option>
              </select>
              <button className="btn" onClick={() => setModal({ kind: 'edit' })}>Edit</button>
              <button className="btn ghost danger-text" onClick={remove}>Delete</button>
            </>
          )}
        </div>
      </div>

      <div className="stats">
        <div className="stat"><small>Players</small><strong>{t.registrations.length}{t.maxPlayers ? ` / ${t.maxPlayers}` : ''}</strong></div>
        <div className="stat"><small>Entry fees collected</small><strong>{money(collected)}</strong><span>{t.registrations.filter((g) => g.paid).length} paid · {money(t.entryFee)} each</span></div>
        <div className="stat"><small>Matches</small><strong>{t.matches.filter((m) => m.status === 'done').length} / {t.matches.length}</strong><span>played</span></div>
      </div>

      <div className="tabs">
        {[['players', 'Players'], ['matches', 'Matches'], ['board', 'Leaderboard']].map(([k, label]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>

      {tab === 'players' && (
        <>
          {t.status === 'open' && <RegisterForm onAdd={(body) => act(() => post(`${base}/registrations`, body), 'Player registered')} busy={busy} />}
          {t.registrations.length === 0 ? <Empty>No registrations yet. Share the public link so players can register themselves.</Empty> : (
            <div className="table-wrap"><table className="data">
              <thead><tr><th>#</th><th>Name</th><th>Mobile</th><th>Entry fee</th><th /></tr></thead>
              <tbody>{t.registrations.map((g, i) => (
                <tr key={g._id}>
                  <td>{i + 1}</td><td>{g.name}</td><td>{g.phone}</td>
                  <td>{g.paid ? <span className="badge green">Paid · {g.paidMethod}</span> : <span className="badge amber">Not paid</span>}</td>
                  <td className="num">
                    {!g.paid && t.entryFee > 0 && <button className="btn sm primary" onClick={() => setModal({ kind: 'fee', reg: g })}>Collect {money(t.entryFee)}</button>}
                    {g.paid && admin && <button className="btn sm ghost" disabled={busy} onClick={() => act(() => post(`${base}/registrations/${g._id}/paid`, { paid: false }))}>Undo</button>}
                    {!g.paid && admin && <button className="btn sm ghost danger-text" disabled={busy} onClick={() => window.confirm(`Remove ${g.name}?`) && act(() => del(`${base}/registrations/${g._id}`))}>Remove</button>}
                  </td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </>
      )}

      {tab === 'matches' && (
        <>
          {admin && (
            <div className="row gap wrap toolbar">
              <button className="btn primary" onClick={() => setModal({ kind: 'match' })}>+ Add match</button>
              <button className="btn" onClick={() => setModal({ kind: 'draw' })}>Random draw</button>
            </div>
          )}
          {t.matches.length === 0 ? <Empty>No matches yet. Use “Random draw” to pair everyone for Round 1.</Empty> : rounds.map((round) => (
            <section key={round}>
              <h3 className="section-title">{round}</h3>
              <div className="matches">
                {t.matches.filter((m) => m.round === round).map((m) => (
                  <button className={`card match ${m.status}`} key={m._id} onClick={() => setModal({ kind: 'score', match: m })}>
                    <span className={m.winner === m.p1 ? 'win' : ''}>{names.get(m.p1) || '?'}</span>
                    <strong>{m.status === 'done' ? `${m.score1} – ${m.score2}` : 'vs'}</strong>
                    <span className={m.winner === m.p2 ? 'win' : ''}>{names.get(m.p2) || '?'}</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </>
      )}

      {tab === 'board' && <Leaderboard rows={t.leaderboard} />}

      {modal?.kind === 'edit' && <TournamentForm t={t} onClose={() => setModal(null)} onSaved={setData} />}
      {modal?.kind === 'fee' && <FeeModal t={t} reg={modal.reg} onClose={() => setModal(null)} onSaved={setData} />}
      {modal?.kind === 'match' && <MatchModal t={t} rounds={rounds} onClose={() => setModal(null)} onSaved={setData} />}
      {modal?.kind === 'draw' && <DrawModal t={t} rounds={rounds} onClose={() => setModal(null)} onSaved={setData} />}
      {modal?.kind === 'score' && <ScoreModal t={t} match={modal.match} names={names} admin={admin} onClose={() => setModal(null)} onSaved={setData} />}
    </>
  );
}

export function Leaderboard({ rows }) {
  if (!rows.length) return <Empty>No players yet.</Empty>;
  return (
    <div className="table-wrap"><table className="data board">
      <thead><tr><th>#</th><th>Player</th><th className="num">P</th><th className="num">W</th><th className="num">L</th><th className="num">Frames</th><th className="num">+/−</th><th className="num">Pts</th></tr></thead>
      <tbody>{rows.map((r) => (
        <tr key={r.id} className={r.rank <= 3 && r.played ? `top${r.rank}` : ''}>
          <td>{r.rank}</td><td>{r.name}</td><td className="num">{r.played}</td><td className="num">{r.won}</td><td className="num">{r.lost}</td>
          <td className="num">{r.framesFor}–{r.framesAgainst}</td><td className="num">{r.diff > 0 ? `+${r.diff}` : r.diff}</td><td className="num"><strong>{r.points}</strong></td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}

function RegisterForm({ onAdd, busy }) {
  const [f, setF] = useState({ name: '', phone: '' });
  const submit = async (e) => { e.preventDefault(); await onAdd(f); setF({ name: '', phone: '' }); };
  return (
    <form className="card inline-form" onSubmit={submit}>
      <Field label="Player name"><input className="input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label="Mobile"><input className="input" required inputMode="numeric" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
      <button className="btn primary" disabled={busy}>Register</button>
    </form>
  );
}

function FeeModal({ t, reg, onClose, onSaved }) {
  const [method, setMethod] = useState('cash');
  const [run, busy] = useAction();
  const save = () => run(async () => { onSaved(await post(`/tournaments/${t._id}/registrations/${reg._id}/paid`, { method })); onClose(); }, 'Entry fee recorded');
  return (
    <Modal title={`Entry fee · ${reg.name}`} onClose={onClose}>
      <div className="pay-total">{money(t.entryFee)}</div>
      <Field label="Paid by"><PayMethodSelect value={method} onChange={setMethod} /></Field>
      <div className="modal-foot">
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={busy} onClick={save}>Mark paid</button>
      </div>
    </Modal>
  );
}

function RoundInput({ value, onChange, rounds }) {
  return (
    <Field label="Round">
      <input className="input" list="rounds" value={value} onChange={(e) => onChange(e.target.value)} />
      <datalist id="rounds">{[...new Set([...rounds, 'Round 1', 'Quarter Final', 'Semi Final', 'Final'])].map((r) => <option key={r} value={r} />)}</datalist>
    </Field>
  );
}

function MatchModal({ t, rounds, onClose, onSaved }) {
  const [f, setF] = useState({ round: rounds[rounds.length - 1] || 'Round 1', p1: '', p2: '' });
  const [run, busy] = useAction();
  const save = () => run(async () => { onSaved(await post(`/tournaments/${t._id}/matches`, f)); onClose(); }, 'Match added');
  const options = (skip) => t.registrations.filter((g) => g._id !== skip).map((g) => <option key={g._id} value={g._id}>{g.name}</option>);
  return (
    <Modal title="Add match" onClose={onClose}>
      <RoundInput value={f.round} onChange={(round) => setF({ ...f, round })} rounds={rounds} />
      <div className="row gap">
        <Field label="Player 1"><select className="input" value={f.p1} onChange={(e) => setF({ ...f, p1: e.target.value })}><option value="">Select…</option>{options(f.p2)}</select></Field>
        <Field label="Player 2"><select className="input" value={f.p2} onChange={(e) => setF({ ...f, p2: e.target.value })}><option value="">Select…</option>{options(f.p1)}</select></Field>
      </div>
      <div className="modal-foot">
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={busy || !f.p1 || !f.p2} onClick={save}>Add match</button>
      </div>
    </Modal>
  );
}

function DrawModal({ t, rounds, onClose, onSaved }) {
  const toast = useToast();
  const [round, setRound] = useState(rounds.length ? `Round ${rounds.length + 1}` : 'Round 1');
  const [paidOnly, setPaidOnly] = useState(false);
  const [run, busy] = useAction();
  const save = () => run(async () => {
    const out = await post(`/tournaments/${t._id}/draw`, { round, paidOnly });
    onSaved(out);
    toast(out.bye ? `Draw done. ${out.bye} gets a bye.` : 'Draw done');
    onClose();
  });
  return (
    <Modal title="Random draw" onClose={onClose}>
      <p className="muted">Shuffles the registered players and pairs them into matches for this round.</p>
      <RoundInput value={round} onChange={setRound} rounds={[]} />
      <label className="check"><input type="checkbox" checked={paidOnly} onChange={(e) => setPaidOnly(e.target.checked)} /> Only players who paid the entry fee</label>
      <div className="modal-foot">
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={busy} onClick={save}>Make draw</button>
      </div>
    </Modal>
  );
}

function ScoreModal({ t, match, names, admin, onClose, onSaved }) {
  const [s1, setS1] = useState(match.status === 'done' ? match.score1 : '');
  const [s2, setS2] = useState(match.status === 'done' ? match.score2 : '');
  const [run, busy] = useAction();
  const url = `/tournaments/${t._id}/matches/${match._id}`;
  const done = (fn, msg) => run(async () => { onSaved(await fn()); onClose(); }, msg);
  return (
    <Modal title={`${match.round} · result`} onClose={onClose}>
      <div className="score-entry">
        <label><span>{names.get(match.p1)}</span><input className="input" type="number" min="0" autoFocus value={s1} onChange={(e) => setS1(e.target.value)} /></label>
        <span className="muted">frames</span>
        <label><span>{names.get(match.p2)}</span><input className="input" type="number" min="0" value={s2} onChange={(e) => setS2(e.target.value)} /></label>
      </div>
      <div className="modal-foot">
        {admin && <button className="btn ghost danger-text" disabled={busy} onClick={() => window.confirm('Delete this match?') && done(() => del(url), 'Match deleted')}>Delete</button>}
        {match.status === 'done' && <button className="btn ghost" disabled={busy} onClick={() => done(() => put(url, { reset: true }), 'Result cleared')}>Clear result</button>}
        <span className="spacer" />
        <button className="btn primary" disabled={busy || s1 === '' || s2 === ''} onClick={() => done(() => put(url, { score1: s1, score2: s2 }), 'Result saved')}>Save result</button>
      </div>
    </Modal>
  );
}
