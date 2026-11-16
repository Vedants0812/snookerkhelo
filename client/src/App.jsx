import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { api, hasToken, setToken, DEMO } from './api.js';
import { Loading } from './ui.jsx';
import { CueBall, Icon } from './art.jsx';
import Login from './pages/Login.jsx';
import Tables from './pages/Tables.jsx';
import Bills from './pages/Bills.jsx';
import BillView from './pages/BillView.jsx';
import Products from './pages/Products.jsx';
import Players, { PlayerDetail } from './pages/Players.jsx';
import Waitlist from './pages/Waitlist.jsx';
import Tournaments, { TournamentDetail } from './pages/Tournaments.jsx';
import Reports from './pages/Reports.jsx';
import Settings from './pages/Settings.jsx';
import { PublicTournaments, PublicTournament } from './pages/Public.jsx';

const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

function Shell({ children }) {
  const { user, settings, logout } = useApp();
  const admin = user.role === 'admin';
  const links = [
    ['/', 'Tables', 'tables'], ['/bills', 'Bills', 'bills'], ['/players', 'Players', 'players'],
    settings.features.waitlist && ['/waitlist', 'Waitlist', 'waitlist'],
    ['/tournaments', 'Tournaments', 'tournaments'], ['/snacks', 'Snacks', 'snacks'],
    admin && ['/reports', 'Reports', 'reports'], admin && ['/settings', 'Settings', 'settings'],
  ].filter(Boolean);
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand"><CueBall /><span className="brand-text">{settings.shopName}<small>SnookerKhelo</small></span></div>
        <nav>
          {links.map(([to, label, icon]) => <NavLink key={to} to={to} end={to === '/'}><Icon name={icon} />{label}</NavLink>)}
        </nav>
        <div className="who">
          <div><strong>{user.name}</strong><small>{admin ? 'Owner' : 'Staff'}</small></div>
          <button className="btn ghost sm" onClick={logout}>Log out</button>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}

function Private() {
  const [state, setState] = useState({ user: null, settings: null, ready: false });
  const load = useCallback(async () => {
    if (!hasToken()) return setState({ user: null, settings: null, ready: true });
    try {
      const [me, settings] = await Promise.all([api('/auth/me'), api('/settings')]);
      setState({ user: me.user, settings, ready: true });
    } catch {
      setState({ user: null, settings: null, ready: true });
    }
  }, []);
  useEffect(() => {
    load();
    const expired = () => setState({ user: null, settings: null, ready: true });
    window.addEventListener('auth-expired', expired);
    return () => window.removeEventListener('auth-expired', expired);
  }, [load]);

  if (!state.ready) return <div className="crash"><span className="muted">Loading…</span></div>;
  if (!state.user) return <Login onDone={load} />;

  const ctx = {
    ...state,
    reloadSettings: load,
    logout: () => { setToken(''); setState({ user: null, settings: null, ready: true }); },
  };
  const admin = state.user.role === 'admin';
  return (
    <AppCtx.Provider value={ctx}>
      <Shell>
        <Routes>
          <Route path="/" element={<Tables />} />
          <Route path="/bills" element={<Bills />} />
          <Route path="/bills/:id" element={<BillView />} />
          <Route path="/players" element={<Players />} />
          <Route path="/players/:id" element={<PlayerDetail />} />
          <Route path="/waitlist" element={state.settings.features.waitlist ? <Waitlist /> : <Navigate to="/" replace />} />
          <Route path="/tournaments" element={<Tournaments />} />
          <Route path="/tournaments/:id" element={<TournamentDetail />} />
          <Route path="/snacks" element={<Products />} />
          <Route path="/reports" element={admin ? <Reports /> : <Navigate to="/" replace />} />
          <Route path="/settings" element={admin ? <Settings /> : <Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Shell>
    </AppCtx.Provider>
  );
}

export default function App() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return (
    <>
    {DEMO && <DemoStrip />}
    <Routes>
      {/* Public pages shared with players - no login */}
      <Route path="/t" element={<PublicTournaments />} />
      <Route path="/t/:id" element={<PublicTournament />} />
      <Route path="*" element={<Private />} />
    </Routes>
    </>
  );
}

if (DEMO) document.body.classList.add('demo');

function DemoStrip() {
  const reset = async () => {
    if (!window.confirm('Reset the demo? Everything you changed is replaced with fresh sample data.')) return;
    const { resetDemo } = await import('./demo/backend.js');
    resetDemo();
    window.location.href = '/';
  };
  return (
    <div className="demo-strip" role="note">
      <strong>Live demo</strong>
      <span>Sample data only, saved in this browser.</span>
      <button type="button" onClick={reset}>Reset demo</button>
    </div>
  );
}
