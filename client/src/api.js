// Public demo build (VITE_DEMO=1): the API runs inside the browser with sample data.
export const DEMO = import.meta.env.VITE_DEMO === '1';

const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* storage blocked */ } },
};
let token = store.get('token') || '';

export function setToken(t) {
  token = t || '';
  store.set('token', token);
}
export const hasToken = () => !!token;

async function send(path, method, body) {
  if (DEMO) {
    const { demoRequest } = await import('./demo/backend.js');
    const out = await demoRequest(path, { method, body, token });
    return { status: out.status, ok: out.status < 400, data: out.data };
  }
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('No connection to the server');
  }
  return { status: res.status, ok: res.ok, data: await res.json().catch(() => null) };
}

export async function api(path, { method = 'GET', body } = {}) {
  const res = await send(path, method, body);
  const { data } = res;
  if (res.status === 401 && token && !path.startsWith('/auth/login')) {
    setToken('');
    window.dispatchEvent(new Event('auth-expired'));
  }
  if (!res.ok) throw new Error(data?.error || 'Request failed');
  return data;
}
export const post = (path, body = {}) => api(path, { method: 'POST', body });
export const put = (path, body = {}) => api(path, { method: 'PUT', body });
export const del = (path) => api(path, { method: 'DELETE' });

// ---------- formatting (always India time) ----------
const IN = 'en-IN';
const TZ = 'Asia/Kolkata';
export const money = (n) => `₹${Number(n || 0).toLocaleString(IN, { maximumFractionDigits: 2 })}`;
export const fmtTime = (d) => (d ? new Date(d).toLocaleTimeString(IN, { timeZone: TZ, hour: '2-digit', minute: '2-digit' }) : '');
export const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(IN, { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric' }) : '');
export const fmtDateTime = (d) => (d ? `${fmtDate(d)}, ${fmtTime(d)}` : '');
export const todayIST = (offsetDays = 0) => new Date(Date.now() + 330 * 60000 + offsetDays * 86400000).toISOString().slice(0, 10);
export const mins = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m || 0}m`);
export const waLink = (phone, text) => `https://wa.me/91${phone}?text=${encodeURIComponent(text)}`;
export const METHOD_LABEL = { cash: 'Cash', upi: 'UPI', card: 'Card', pass: 'Player Pass' };
export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
