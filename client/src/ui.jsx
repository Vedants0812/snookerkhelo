import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, post, money } from './api.js';

// ---------- toasts ----------
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const toast = useCallback((text, kind = 'ok') => {
    const id = Math.random();
    setItems((x) => [...x, { id, text, kind }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), kind === 'error' ? 4500 : 2500);
  }, []);
  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className="toasts" role="status">
        {items.map((i) => <div key={i.id} className={`toast ${i.kind}`}>{i.text}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}

/** Wraps an async action: disables while running, shows errors as a toast. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn, okMsg) => {
    setBusy(true);
    try { const out = await fn(); if (okMsg) toast(okMsg); return out; }
    catch (e) { toast(e.message, 'error'); return undefined; }
    finally { setBusy(false); }
  }, [toast]);
  return [run, busy];
}

/** Load data, with reload() and optional polling. */
export function useLoad(loader, deps = [], pollMs = 0) {
  const [state, setState] = useState({ data: null, error: '', loading: true });
  const ref = useRef(loader);
  ref.current = loader;
  const reload = useCallback(async () => {
    try { const data = await ref.current(); setState({ data, error: '', loading: false }); return data; }
    catch (e) { setState((s) => ({ ...s, error: e.message, loading: false })); return null; }
  }, []);
  useEffect(() => {
    setState((s) => ({ ...s, loading: true }));
    reload();
    if (!pollMs) return undefined;
    const id = setInterval(() => { if (!document.hidden) reload(); }, pollMs);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { ...state, reload, setData: (data) => setState({ data, error: '', loading: false }) };
}

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="btn ghost sm" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, hint, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export const Loading = ({ error }) => <div className="empty">{error || 'Loading…'}</div>;
export const Empty = ({ children }) => <div className="empty">{children}</div>;

export function StatusBadge({ status }) {
  const cls = { paid: 'green', unpaid: 'amber', void: 'red', open: 'green', ongoing: 'amber', completed: 'gray',
    waiting: 'amber', notified: 'blue', seated: 'green', left: 'gray' }[status] || 'gray';
  return <span className={`badge ${cls}`}>{status}</span>;
}

/** Search existing players, or add a new one on the spot. */
export function PlayerPicker({ selected, onChange, single, showBalance }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [newPhone, setNewPhone] = useState('');
  const [run, busy] = useAction();

  useEffect(() => {
    const id = setTimeout(() => {
      api(`/players?limit=6&q=${encodeURIComponent(q.trim())}`).then(setResults).catch(() => {});
    }, 200);
    return () => clearTimeout(id);
  }, [q]);

  const pick = (p) => { onChange(single ? [p] : [...selected.filter((x) => x._id !== p._id), p]); setQ(''); };
  const create = () => run(async () => {
    const p = await post('/players', { name: q.trim(), phone: newPhone });
    setNewPhone('');
    pick(p);
  }, 'Player added');
  const chosen = new Set(selected.map((p) => p._id));
  const list = results.filter((p) => !chosen.has(p._id));

  return (
    <div className="picker">
      {selected.length > 0 && (
        <div className="chips">
          {selected.map((p) => (
            <span className="chip" key={p._id}>
              {p.name}{showBalance ? ` · ${money(p.passBalance)}` : ''}
              <button type="button" onClick={() => onChange(selected.filter((x) => x._id !== p._id))} aria-label={`Remove ${p.name}`}>✕</button>
            </span>
          ))}
        </div>
      )}
      <input className="input" placeholder="Search player by name or mobile…" value={q} onChange={(e) => setQ(e.target.value)} />
      {(q.trim() || !selected.length) && list.length > 0 && (
        <div className="picker-list">
          {list.map((p) => (
            <button type="button" key={p._id} onClick={() => pick(p)}>
              <span>{p.name}</span>
              <span className="muted">{p.phone || ''}{showBalance ? ` · ${money(p.passBalance)}` : ''}</span>
            </button>
          ))}
        </div>
      )}
      {q.trim().length >= 2 && (
        <div className="row gap picker-new">
          <input className="input" placeholder="Mobile (optional)" inputMode="numeric" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
          <button type="button" className="btn sm" disabled={busy} onClick={create}>+ Add “{q.trim()}”</button>
        </div>
      )}
    </div>
  );
}

/**
 * In-app replacement for window.prompt: asks for one value, then calls onSubmit(value).
 * onSubmit should return the useAction() result: undefined means it failed, so the dialog stays open.
 */
export function PromptModal({ title, label, hint, initial = '', type = 'text', confirmLabel = 'Save', danger, onSubmit, onClose }) {
  const [value, setValue] = useState(String(initial));
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const ok = await onSubmit(value);
    setBusy(false);
    if (ok !== undefined) onClose();
  };
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit}>
        <Field label={label} hint={hint}>
          <input className="input" autoFocus type={type} min={type === 'number' ? 0 : undefined} required
            value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
        <div className="modal-foot">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className={`btn ${danger ? 'danger' : 'primary'}`} disabled={busy || !value.trim()}>{confirmLabel}</button>
        </div>
      </form>
    </Modal>
  );
}

export function PayMethodSelect({ value, onChange }) {
  return (
    <div className="seg">
      {['cash', 'upi', 'card'].map((m) => (
        <button type="button" key={m} className={value === m ? 'on' : ''} onClick={() => onChange(m)}>{m === 'upi' ? 'UPI' : m[0].toUpperCase() + m.slice(1)}</button>
      ))}
    </div>
  );
}
