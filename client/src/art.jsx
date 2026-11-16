// Graphics for the arena theme: brand mark, top-down table drawing, nav icons.
import { useId } from 'react';

/** Brand mark: a cue ball with a neon ring. */
export function CueBall({ className = 'cueball' }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true">
      <defs>
        <radialGradient id={`cb${id}`} cx="35%" cy="30%" r="70%">
          <stop offset="0" stopColor="#ffffff" /><stop offset=".6" stopColor="#e4e6ee" /><stop offset="1" stopColor="#8d92a3" />
        </radialGradient>
      </defs>
      <circle cx="24" cy="24" r="22.5" fill="none" stroke="#1fd67f" strokeWidth="1.5" opacity=".9" />
      <circle cx="24" cy="24" r="18" fill={`url(#cb${id})`} />
      <circle cx="24" cy="24" r="7" fill="#1fd67f" />
      <text x="24" y="27.6" textAnchor="middle" fontSize="10" fontWeight="800" fontFamily="Chakra Petch, sans-serif" fill="#03140b">8</text>
    </svg>
  );
}

const RED = '#d81e2a';
const SNOOKER_COLOURS = [['#ffd23a', 98, 70], ['#2bb24c', 98, 130], ['#8a5a2b', 98, 100], ['#2f6bff', 200, 100], ['#ff8fb3', 278, 100], ['#121212', 355, 100]];
const POOL = ['#ffd23a', '#2f6bff', '#ff4040', '#7a3cff', '#ff8a1f', '#22b14c', '#8c1d1d', '#121212'];

function rack(cx, cy, r, rows, colourOf) {
  const out = [];
  let n = 0;
  for (let row = 0; row < rows; row++) {
    for (let i = 0; i <= row; i++) out.push({ x: cx + row * r * 1.75, y: cy - row * r + i * r * 2, c: colourOf(n++) });
  }
  return out;
}

/** Top-down drawing of a snooker or pool table. state: free | running | paused. */
export function TableArt({ type = 'snooker', state = 'free', children }) {
  const id = useId().replace(/:/g, '');
  const pool = type === 'pool';
  const lit = state !== 'free';
  const felt = pool ? ['#1f8fb0', '#0b4459'] : ['#1db46b', '#0a4d30'];
  const r = pool ? 7 : 6;
  let balls;
  if (state === 'free') {
    balls = pool
      ? [...rack(276, 100, 7, 5, (n) => POOL[n % POOL.length]), { x: 110, y: 100, c: '#f4f4f4' }]
      : [...rack(290, 100, 6, 5, () => RED), ...SNOOKER_COLOURS.map(([c, x, y]) => ({ x, y, c })), { x: 84, y: 112, c: '#f4f4f4' }];
  } else {
    const spread = pool
      ? [[150, 70, POOL[0]], [232, 128, POOL[1]], [300, 60, POOL[2]], [268, 142, POOL[4]], [196, 96, POOL[7]], [120, 140, '#f4f4f4']]
      : [[250, 66, RED], [318, 126, RED], [286, 88, RED], [214, 140, RED], [355, 100, '#121212'], [278, 100, '#ff8fb3'], [98, 70, '#ffd23a'], [98, 130, '#2bb24c'], [160, 80, '#f4f4f4']];
    balls = spread.map(([x, y, c]) => ({ x, y, c }));
  }
  const edge = state === 'running' ? '#ff3d71' : state === 'paused' ? '#ffc23d' : '#2b3246';
  return (
    <div className="table-art">
      <svg viewBox="0 0 400 200" role="img" aria-label={`${pool ? 'Pool' : 'Snooker'} table, ${state}`}>
        <defs>
          <linearGradient id={`rail${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#3a2416" /><stop offset="1" stopColor="#170c06" />
          </linearGradient>
          <radialGradient id={`felt${id}`} cx="50%" cy="45%" r="65%">
            <stop offset="0" stopColor={felt[0]} /><stop offset="1" stopColor={felt[1]} />
          </radialGradient>
          <radialGradient id={`lamp${id}`} cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor="#fff" stopOpacity=".2" /><stop offset="1" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`shine${id}`} cx="35%" cy="30%" r="70%">
            <stop offset="0" stopColor="#fff" stopOpacity=".75" /><stop offset=".45" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect x="2" y="2" width="396" height="196" rx="20" fill={`url(#rail${id})`} stroke={edge} strokeWidth="2.5" />
        <rect x="20" y="20" width="360" height="160" rx="6" fill={`url(#felt${id})`} opacity={lit ? 1 : 0.5} />
        {lit && <ellipse cx="200" cy="100" rx="190" ry="95" fill={`url(#lamp${id})`} />}
        {!pool && (
          <g stroke="#fff" strokeOpacity=".28" fill="none" strokeWidth="1.2">
            <line x1="98" y1="20" x2="98" y2="180" />
            <path d="M98 70 A30 30 0 0 0 98 130" />
          </g>
        )}
        {[[22, 22], [200, 17], [378, 22], [22, 178], [200, 183], [378, 178]].map(([x, y]) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r="11" fill="#030303" stroke="#000" strokeWidth="2" />
        ))}
        <g opacity={lit ? 1 : 0.65}>
          {balls.map((b, i) => (
            <g key={i}>
              <circle cx={b.x} cy={b.y + 1.6} r={r} fill="#000" opacity=".35" />
              <circle cx={b.x} cy={b.y} r={r} fill={b.c} />
              <circle cx={b.x} cy={b.y} r={r} fill={`url(#shine${id})`} />
            </g>
          ))}
        </g>
      </svg>
      {children && <div className="art-label">{children}</div>}
    </div>
  );
}

const ICONS = {
  tables: 'M3 7h18v10H3zM12 7v10M3 7l2-2M21 7l-2-2M3 17l2 2M21 17l-2 2',
  bills: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3',
  players: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21c0-4 3-6 7-6s7 2 7 6M16 3.5a4 4 0 0 1 0 7.5M18 15c2.5.5 4 2.5 4 6',
  waitlist: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  tournaments: 'M7 4h10v4a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4M12 13v4M8 21h8M9 17h6v4H9z',
  snacks: 'M5 8h14l-1.5 13h-11zM9 8V5a3 3 0 0 1 6 0v3',
  reports: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  settings: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 3.5-6.5 8-6.5s8 2.5 8 6.5',
};
export function Icon({ name }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}
