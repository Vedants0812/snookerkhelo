import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import authRoutes from './routes/auth.js';
import catalogRoutes from './routes/catalog.js';
import sessionRoutes from './routes/sessions.js';
import billRoutes from './routes/bills.js';
import playerRoutes from './routes/players.js';
import tournamentRoutes, { publicRouter } from './routes/tournaments.js';
import waitlistRoutes from './routes/waitlist.js';
import reportRoutes from './routes/reports.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1); // behind Render/Railway/Nginx
  app.use(helmet({ contentSecurityPolicy: { directives: { 'img-src': ["'self'", 'data:'] } } }));
  if (!config.isProd) app.use(cors());
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true, time: Date.now() }));

  // Order matters: open routes first, then everything that requires a login.
  app.use('/api/public', publicRouter);
  app.use('/api', authRoutes);
  app.use('/api', catalogRoutes, sessionRoutes, billRoutes, playerRoutes, tournamentRoutes, waitlistRoutes, reportRoutes);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  // Production: serve the built React app from the same server.
  const dist = fileURLToPath(new URL('../../client/dist', import.meta.url));
  if (existsSync(dist)) {
    app.use(express.static(dist, { maxAge: '7d', index: false }));
    app.get(/.*/, (_req, res) => res.sendFile('index.html', { root: dist }));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    let status = err.status || 500;
    let message = err.message || 'Something went wrong';
    if (err.name === 'ValidationError') { status = 400; message = Object.values(err.errors)[0]?.message || message; }
    else if (err.name === 'CastError') { status = 400; message = 'Invalid value'; }
    else if (err.type === 'entity.parse.failed') { status = 400; message = 'Invalid request'; }
    else if (err.code === 11000) { status = 409; message = 'Already exists'; }
    if (status >= 500) { console.error(err); if (config.isProd) message = 'Something went wrong'; }
    res.status(status).json({ error: message });
  });
  return app;
}
