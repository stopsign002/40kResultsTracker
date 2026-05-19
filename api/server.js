import express from 'express';
import session from 'express-session';
import rateLimit from 'express-rate-limit';
import connectPgSimple from 'connect-pg-simple';
import { pool, initSchema } from './lib/db.js';
import { ensureBootstrapAdmin } from './lib/auth.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import gameRoutes from './routes/games.js';
import statsRoutes from './routes/stats.js';
import referenceRoutes from './routes/reference.js';
import warmapRoutes from './routes/warmap.js';
import eventsRoutes from './routes/events.js';
import seasonsRoutes from './routes/seasons.js';

const PgSession = connectPgSimple(session);
const app = express();

app.set('trust proxy', 1);
app.use(express.json({ limit: '256kb' }));

app.use(session({
  store: new PgSession({ pool, tableName: 'session' }),
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  },
  name: 'tg40k.sid',
}));

app.get('/health', (_req, res) => res.json({ ok: true }));

// Brute-force protection on the only public auth surface. Friend-group app
// so the limit is generous; the goal is to stop credential-stuffing scripts,
// not block humans with sticky CapsLock.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too many login attempts, try again in 15 minutes' },
});
app.use('/auth/login', loginLimiter);

app.use('/auth', authRoutes);
app.use('/admin', adminRoutes);
app.use('/games', gameRoutes);
app.use('/stats', statsRoutes);
app.use('/reference', referenceRoutes);
app.use('/stats', warmapRoutes);
app.use('/events', eventsRoutes);
app.use('/seasons', seasonsRoutes);

// Standard error response shape: { error: <message>, code?: <string> }.
// Status code carries the category; message is human-readable.
app.use((err, _req, res, _next) => {
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({
    error: err.publicMessage || (status >= 500 ? 'internal error' : err.message || 'error'),
    code: err.code || undefined,
  });
});

const PORT = parseInt(process.env.PORT || '3000', 10);

(async () => {
  try {
    await initSchema();
    await ensureBootstrapAdmin();
  } catch (e) {
    console.error('Init failed:', e);
    process.exit(1);
  }
  app.listen(PORT, () => console.log(`40k tracker API listening on :${PORT}`));
})();
