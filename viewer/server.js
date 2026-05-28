const express = require('express');
const path = require('path');
const crypto = require('crypto');

const app = express();
const port = Number(process.env.PORT || 8080);
const root = __dirname;
const maplibreRoot = path.join(root, 'node_modules', 'maplibre-gl', 'dist');
const martinBaseInternal = (process.env.MARTIN_BASE_INTERNAL || 'http://martin:3000/mapas/tiles').replace(/\/$/, '');
const sessionTtlSeconds = Number(process.env.MAP_SESSION_TTL_SECONDS || 3600);
const sessionMaxBytes = process.env.MAP_SESSION_MAX_BYTES || '5mb';
const sessions = new Map();

app.disable('x-powered-by');
app.use(express.json({ limit: sessionMaxBytes }));

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

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateGeoJSON(value, field = 'geojson') {
  if (!isPlainObject(value)) {
    throw new Error(`"${field}" must be a GeoJSON object`);
  }

  if (value.type === 'FeatureCollection') {
    if (!Array.isArray(value.features)) {
      throw new Error(`"${field}.features" must be an array`);
    }
    return;
  }

  if (value.type === 'Feature') {
    if (!isPlainObject(value.geometry)) {
      throw new Error(`"${field}.geometry" must be a GeoJSON geometry`);
    }
    return;
  }

  const geometryTypes = new Set([
    'Point',
    'MultiPoint',
    'LineString',
    'MultiLineString',
    'Polygon',
    'MultiPolygon',
    'GeometryCollection'
  ]);

  if (!geometryTypes.has(value.type)) {
    throw new Error(`"${field}.type" is not supported`);
  }
}

function normalizeSessionBody(body) {
  if (!isPlainObject(body)) {
    throw new Error('Body must be a JSON object');
  }

  const source = typeof body.source === 'string' && body.source.trim()
    ? body.source.trim()
    : undefined;

  if (source && !/^[a-zA-Z0-9_.-]+$/.test(source)) {
    throw new Error('"source" contains invalid characters');
  }

  const session = {
    source,
    overlay: isPlainObject(body.overlay) ? body.overlay : {},
    geojson: null,
    options: isPlainObject(body.options) ? body.options : {}
  };

  if (body.geojson !== undefined) {
    validateGeoJSON(body.geojson);
    session.geojson = body.geojson;
  }

  if (body.data !== undefined) {
    validateGeoJSON(body.data, 'data');
    session.geojson = body.data;
  }

  if (!session.geojson && !Object.keys(session.overlay).length) {
    throw new Error('Body must include "geojson", "data" or "overlay"');
  }

  return session;
}

function pruneSessions() {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(id);
  }
}

function sessionUrlForRequest(req, id) {
  const prefix = req.path.startsWith('/maps/') ? '/maps' : '';
  return `${prefix}/?session=${encodeURIComponent(id)}`;
}

function sendSessionResponse(req, res, id, session) {
  res.status(req.method === 'POST' ? 201 : 200).json({
    id,
    url: sessionUrlForRequest(req, id),
    expiresAt: new Date(session.expiresAt).toISOString(),
    ttlSeconds: Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000))
  });
}

function createSession(req, res) {
  pruneSessions();
  const payload = normalizeSessionBody(req.body);
  const id = crypto.randomUUID();
  const now = Date.now();
  const session = {
    ...payload,
    id,
    createdAt: now,
    expiresAt: now + sessionTtlSeconds * 1000
  };
  sessions.set(id, session);
  sendSessionResponse(req, res, id, session);
}

function updateSession(req, res) {
  pruneSessions();
  const current = sessions.get(req.params.id);
  if (!current) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  const payload = normalizeSessionBody(req.body);
  const session = {
    ...payload,
    id: req.params.id,
    createdAt: current.createdAt,
    expiresAt: Date.now() + sessionTtlSeconds * 1000
  };
  sessions.set(req.params.id, session);
  sendSessionResponse(req, res, req.params.id, session);
}

function getSession(req, res) {
  pruneSessions();
  const session = sessions.get(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  res.setHeader('Cache-Control', 'no-store');
  res.json({
    id: session.id,
    source: session.source,
    overlay: session.overlay,
    geojson: session.geojson,
    options: session.options,
    expiresAt: new Date(session.expiresAt).toISOString()
  });
}

function deleteSession(req, res) {
  const deleted = sessions.delete(req.params.id);
  res.status(deleted ? 204 : 404).end();
}

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

async function sendCatalog(req, res, next) {
  try {
    const upstream = await fetch(`${martinBaseInternal}/catalog`, {
      headers: { accept: 'application/json' }
    });

    if (!upstream.ok) {
      res.status(upstream.status).json({ error: `Martin returned ${upstream.status}` });
      return;
    }

    res.setHeader('Cache-Control', 'no-store');
    res.json(await upstream.json());
  } catch (error) {
    next(error);
  }
}

app.get('/api/catalog', sendCatalog);
app.get('/maps/api/catalog', sendCatalog);
app.get('/api/tilejson/:source', sendTilejson);
app.get('/maps/api/tilejson/:source', sendTilejson);
app.post('/api/session', createSession);
app.post('/maps/api/session', createSession);
app.patch('/api/session/:id', updateSession);
app.patch('/maps/api/session/:id', updateSession);
app.get('/api/session/:id', getSession);
app.get('/maps/api/session/:id', getSession);
app.delete('/api/session/:id', deleteSession);
app.delete('/maps/api/session/:id', deleteSession);

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

app.use((error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  const status = error.type === 'entity.too.large' ? 413 : 400;
  res.status(status).json({ error: error.message || 'Invalid request' });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Martin map viewer listening on ${port}`);
});
