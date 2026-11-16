# SnookerKhelo — snooker & pool parlour manager

Snooker / pool parlour management system (MongoDB, Express, React, Node).

## Live demo (browser-only)

The public demo runs **entirely in the browser** — no server or database. It is the same React app built with
`VITE_DEMO=1` (`npm run build:demo --prefix client`): every API call is answered by `client/src/demo/backend.js`,
which mirrors the Express routes and keeps **sample data** in the visitor's own browser (localStorage).
Use "Enter as Owner" / "Enter as Staff" on the login screen; "Reset demo" in the top strip restores the sample data.
`vercel.json` builds this demo. Real parlours use the full Node + MongoDB setup below.

## What is included

| Promised to the client | Where it is |
| --- | --- |
| Table timer + automatic billing (time + snacks) | **Tables** screen: start / pause / stop, live timer and running amount, per-hour or per-frame billing, snacks added to the table |
| UPI QR code on every bill | **Bill** page: QR for the exact amount (set the UPI ID in Settings → Shop & UPI). Prints on the receipt |
| Player list management | **Players**: add / edit / search, visits, total spent, bill history |
| Tournament registration + leaderboard page | **Tournaments** (staff side) and public pages `/t` and `/t/<id>` where players register themselves and see the leaderboard |
| Daily earnings report | **Reports** (owner only): money collected by cash / UPI / card, table vs snacks income, per table, date range, CSV export |
| Player Pass with prepaid balance *(add-on)* | Player page → Top up; pay any bill with "Player Pass". Switch on/off in Settings |
| Waiting list with one-tap WhatsApp "Table free" *(add-on)* | **Waitlist**: opens WhatsApp with the message pre-written (click-to-chat, no WhatsApp API fees). Switch on/off in Settings |

Also built in: counter sales (snacks without a table), discounts, unpaid bills, void with reason,
snack stock tracking, staff logins with limited access, thermal-printer friendly receipt, WhatsApp bill share.

"Google Maps profile setup" is a service task, not software — the app only stores the Maps and review links
(Settings → Shop & UPI) and puts the review link in WhatsApp bills.

## How billing is calculated

- **By time:** played time excludes pauses. Every started minute counts, then it is rounded up to the
  billing block (Settings → Billing rules; default 1 minute) and the minimum charge is applied.
  `charge = billed minutes × hourly rate ÷ 60`.
- **By frame:** `frames × rate per frame`.
- `total = table charge + snacks − discount`, rounded to the nearest rupee (can be switched off).
- The rate is locked when a session starts, so changing rates never alters a running table.
- The server clock is the only clock used; a wrong time on a phone cannot change a bill.
- The same code (`shared/billing.js`) drives the live amount on screen and the final bill. Tests: `npm test`.
- Reports use India time. If the parlour closes after midnight, set "Day starts at" (e.g. 6) so a 1 AM bill
  counts in the previous day.
- "Money collected" = bills paid by cash/UPI/card + pass top-ups + tournament fees. Bills paid from pass
  balance are not counted again, because that money was collected at top-up.

## Run on your computer

Needs Node.js 20 or newer.

```bash
npm run install:all
```

Copy `server/.env.example` to `server/.env`, set `JWT_SECRET` and `ADMIN_PASSWORD`. Leave `MONGO_URI` empty
to use the built-in local database (stored in `server/.data`; the first start downloads MongoDB, about 600 MB).

```bash
npm run seed
```

```bash
npm run dev
```

Open http://localhost:5173 and log in with `ADMIN_USERNAME` / `ADMIN_PASSWORD` from `server/.env`.
`npm run seed` adds demo tables, snacks, players and a tournament (run it while the app is stopped).

## Go live for the client

1. Create a free MongoDB Atlas cluster and copy its connection string.
2. Deploy this repository to any Node host (Render, Railway, a VPS):
   - Build command: `npm run install:all && npm run build`
   - Start command: `npm start`
   - Environment: `NODE_ENV=production`, `MONGO_URI`, `JWT_SECRET` (long random string), `ADMIN_USERNAME`, `ADMIN_PASSWORD`
3. The one server serves both the API and the built React app.
4. First login → Settings: add the real tables and rates, UPI ID, shop address, staff logins; change the owner password.

Do not run `npm run seed` on the live database — it is demo data.

## Project layout

```
shared/billing.js     billing maths used by server and client
server/src/           Express API: models.js, routes/, lib.js (auth, validation, India-time helpers)
server/test/          billing tests
client/src/           React app: pages/, ui.jsx, art.jsx (table graphics), api.js, styles.css
client/src/demo/      in-browser demo backend (only bundled into the demo build)
```

Roles: **Owner** sees everything. **Staff** can run tables, make and collect bills, manage players, waitlist
and tournament registrations — but not reports, settings, rates, voids or session cancellation.
