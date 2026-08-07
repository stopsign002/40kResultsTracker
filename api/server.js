import express from 'express';
import session from 'express-session';
import rateLimit from 'express-rate-limit';
import connectPgSimple from 'connect-pg-simple';
import { pool, initSchema } from './lib/db.js';
import { ensureBootstrapAdmin } from './lib/auth.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import gameRoutes from './routes/games.js';
import imageRoutes, { mapRouter } from './routes/images.js';
import statsRoutes from './routes/stats.js';
import referenceRoutes from './routes/reference.js';
import warmapRoutes from './routes/warmap.js';
import eventsRoutes from './routes/events.js';
import seasonsRoutes from './routes/seasons.js';
import ratingsRoutes from './routes/ratings.js';
import draftRoutes from './routes/drafts.js';

const PgSession = connectPgSimple(session);
const app = express();

app.set('trust proxy', 1);
// Small default body limit for the whole API. The photo-upload route needs a
// far bigger one, and because this parser runs BEFORE the routers it would
// reject the body with a 413 before the route's own parser ever saw it — so
// that one path is skipped here and parses itself (see routes/images.js).
const jsonBody = express.json({ limit: '256kb' });
const IMAGE_UPLOAD_PATH = /^\/(?:games\/\d+\/images|maps\/\d+\/image|drafts\/\d+\/images)\/?$/;
app.use((req, res, next) => {
  if (req.method === 'POST' && IMAGE_UPLOAD_PATH.test(req.path)) return next();
  return jsonBody(req, res, next);
});

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
app.use('/maps', mapRouter);
app.use('/games', imageRoutes);
app.use('/games', gameRoutes);
app.use('/stats', statsRoutes);
app.use('/reference', referenceRoutes);
app.use('/stats', warmapRoutes);
app.use('/events', eventsRoutes);
app.use('/seasons', seasonsRoutes);
app.use('/ratings', ratingsRoutes);
app.use('/drafts', draftRoutes);

// Standard error response shape: { error: <message>, code?: <string> }.
// Status code carries the category; message is human-readable.
app.use((err, _req, res, _next) => {
  console.error(err);
  const status = err.status || 500;
  // body-parser's raw "request entity too large" says nothing actionable.
  const tooLarge = status === 413 || err.type === 'entity.too.large';
  res.status(status).json({
    error: tooLarge
      ? 'that file is too large to upload — try a smaller image'
      : (err.publicMessage || (status >= 500 ? 'internal error' : err.message || 'error')),
    code: err.code || (tooLarge ? 'too_large' : undefined),
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
