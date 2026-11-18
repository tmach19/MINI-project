import express from 'express';
import cors from 'cors';
import { env } from './config/env.js';
import { getDbMode, initDatabase } from './db/pool.js';
import authRouter from './routes/auth.js';
import adminRouter from './routes/admin.js';
import aiRouter from './routes/ai.js';
import lessonsRouter from './routes/lessons.js';
import progressRouter from './routes/progress.js';
import ttsRouter from './routes/tts.js';

const app = express();

app.use(
  cors({
    origin: env.corsOrigin.split(',').map((s) => s.trim()),
    credentials: true,
  })
);
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, dbMode: getDbMode(), timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/ai', aiRouter);
app.use('/api', ttsRouter);
app.use('/api', lessonsRouter);
app.use('/api', progressRouter);

app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error('[API Error]', err);
    res.status(500).json({ error: err.message || 'Lỗi máy chủ nội bộ.' });
  }
);

initDatabase()
  .then((mode) => {
    app.listen(env.port, () => {
      console.log(`[Server] Backend chạy tại http://localhost:${env.port} (DB mode: ${mode})`);
    });
  })
  .catch((err) => {
    console.error('[Startup Error]', err);
    process.exit(1);
  });
