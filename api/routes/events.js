// @ts-check
import { Router } from 'express';
import { requireAuth } from '../lib/auth.js';
import { addSubscriber } from '../lib/events.js';

const router = Router();

router.get('/', requireAuth, (req, res) => {
  // SSE handshake. trust proxy is on globally so client IP / proto are honoured.
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // Caddy: don't buffer the stream
  });
  res.flushHeaders?.();
  res.write(`: connected\n\n`); // initial comment so the browser fires `open`

  // Heartbeat every 25s so proxies don't idle-close the connection
  const hb = setInterval(() => {
    try { res.write(`: ping\n\n`); } catch { /* dead, ignored */ }
  }, 25000);

  const cleanup = addSubscriber({ res, userId: req.session.userId });
  req.on('close', () => { clearInterval(hb); cleanup(); res.end(); });
});

export default router;
