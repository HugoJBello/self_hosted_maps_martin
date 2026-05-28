const express = require('express');
const path = require('path');

const app = express();
const port = Number(process.env.PORT || 8080);
const root = __dirname;
const maplibreRoot = path.join(root, 'node_modules', 'maplibre-gl', 'dist');
const martinBaseInternal = (process.env.MARTIN_BASE_INTERNAL || 'http://martin:3000/mapas/tiles').replace(/\/$/, '');

app.disable('x-powered-by');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer-when-downgrade');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: http: https:",
    "font-src 'self' data: https://tiles.openfreemap.org",
    "connect-src 'self' http: https: data: blob:",
    "worker-src 'self' blob:",
    "frame-ancestors *"
  ].join('; '));
  next();
});

app.get('/healthz', (req, res) => {
  res.json({ ok: true, service: 'martin-map-viewer' });
});

async function sendTilejson(req, res, next) {
  const source = req.params.source;

  if (!/^[a-zA-Z0-9_.-]+$/.test(source)) {
    res.status(400).json({ error: 'Invalid source id' });
    return;
  }

  try {
    const upstream = await fetch(`${martinBaseInternal}/${encodeURIComponent(source)}`, {
      headers: { accept: 'application/json' }
    });

    if (!upstream.ok) {
      res.status(upstream.status).json({ error: `Martin returned ${upstream.status}` });
      return;
    }

    const tilejson = await upstream.json();
    tilejson.tiles = [`/mapas/tiles/${encodeURIComponent(source)}/{z}/{x}/{y}`];
    res.setHeader('Cache-Control', 'no-store');
    res.json(tilejson);
  } catch (error) {
    next(error);
  }
}

app.get('/api/tilejson/:source', sendTilejson);
app.get('/maps/api/tilejson/:source', sendTilejson);

function sendIndex(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(root, 'index.html'));
}

app.use('/vendor/maplibre-gl', express.static(maplibreRoot, { immutable: true, maxAge: '1y' }));
app.use('/maps/vendor/maplibre-gl', express.static(maplibreRoot, { immutable: true, maxAge: '1y' }));

app.get(['/', '/index.html', '/maps', '/maps/', '/maps/index.html'], sendIndex);

app.use('/assets', express.static(path.join(root, 'assets'), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-store')
}));
app.use('/maps/assets', express.static(path.join(root, 'assets'), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-store')
}));
app.use(express.static(root, { extensions: ['html'], maxAge: '1h' }));
app.use('/maps', express.static(root, { extensions: ['html'], maxAge: '1h' }));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/assets/') || req.path.startsWith('/vendor/') || req.path.startsWith('/maps/assets/') || req.path.startsWith('/maps/vendor/')) {
    return next();
  }
  return sendIndex(req, res);
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Martin map viewer listening on ${port}`);
});
