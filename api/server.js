import express from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { pool, initSchema } from './lib/db.js';
import { ensureBootstrapAdmin } from './lib/auth.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import gameRoutes from './routes/games.js';
import statsRoutes from './routes/stats.js';
import referenceRoutes from './routes/reference.js';

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

app.use('/auth', authRoutes);
app.use('/admin', adminRoutes);
app.use('/games', gameRoutes);
app.use('/stats', statsRoutes);
app.use('/reference', referenceRoutes);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'internal error' });
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
