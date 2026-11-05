const config = require('./config');
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const prisma = require('./db');

const app = express();

app.set('trust proxy', 1); // behind Railway's proxy, so rate limits see the real client IP
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
  });
  next();
});
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json({ limit: '100kb' }));

// Health check: confirms the server and database are both reachable
app.get('/api/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', database: 'connected' });
  } catch (err) {
    res.status(500).json({ status: 'error', database: 'unreachable' });
  }
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/members', require('./routes/members'));
app.use('/api/contribution-types', require('./routes/contributionTypes'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/reports', require('./routes/reports'));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// In production the same server also serves the built website (frontend/dist).
// Skipped when that folder does not exist, for example while developing with the Vite dev server.
const webRoot = path.join(__dirname, '..', '..', 'frontend', 'dist');
if (fs.existsSync(path.join(webRoot, 'index.html'))) {
  // Files in /assets have a fingerprint in their name, so browsers may keep them for a long time.
  app.use(
    '/assets',
    express.static(path.join(webRoot, 'assets'), { immutable: true, maxAge: '365d' })
  );
  app.use('/assets', (req, res) => res.status(404).type('text/plain').send('Not found'));
  app.use(express.static(webRoot, { index: false, maxAge: 0 }));
  // Any other address opens the app (it keeps its place in the part after the #).
  app.get('*', (req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(webRoot, 'index.html'));
  });
}

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON in request' });
  }
  if (err.code === 'P2002') {
    return res.status(409).json({ error: 'That record already exists' });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
});

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`API running on http://localhost:${config.port}`);
  });
}

module.exports = app;
