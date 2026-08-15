const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { VectorTile } = require('@mapbox/vector-tile');
const Protobuf = require('pbf');

const app = express();
const port = Number(process.env.PORT || 8080);
const root = __dirname;
const maplibreRoot = path.join(root, 'node_modules', 'maplibre-gl', 'dist');
const martinBaseInternal = (process.env.MARTIN_BASE_INTERNAL || 'http://martin:3000/mapas/tiles').replace(/\/$/, '');
const sessionTtlSeconds = Number(process.env.MAP_SESSION_TTL_SECONDS || 3600);
const sessionMaxBytes = process.env.MAP_SESSION_MAX_BYTES || '5mb';
const searchMaxTiles = Number(process.env.MAP_SEARCH_MAX_TILES || 26000);
const searchMaxResults = Number(process.env.MAP_SEARCH_MAX_RESULTS || 500);
const allowSearchAutoIndex = process.env.MAP_SEARCH_AUTO_INDEX === '1';
const sessions = new Map();
const searchIndexes = new Map();
const searchJobs = new Map();

const SEARCH_INDEX_PROFILES = {
  fast: {
    id: 'fast',
    label: 'Rapido',
    description: 'Poblaciones, carreteras principales y POIs basicos. Menos precision, indexado corto.',
    maxTiles: 7000,
    layers: [
      { layer: 'place', zoom: 8, maxTiles: 500 },
      { layer: 'transportation_name', zoom: 12, maxTiles: 3500 },
      { layer: 'poi', zoom: 12, maxTiles: 1500 },
      { layer: 'water_name', zoom: 10, maxTiles: 600 }
    ]
  },
  streets: {
    id: 'streets',
    label: 'Calles',
    description: 'Equilibrado para buscar ciudades, POIs y calles urbanas cerca de nucleos de poblacion.',
    maxTiles: 26000,
    layers: [
      { layer: 'place', zoom: 8, maxTiles: 500 },
      { layer: 'transportation_name', zoom: 12, maxTiles: 12000 },
      { layer: 'transportation_name', zoom: 14, maxTiles: 12000, aroundPlaces: true },
      { layer: 'poi', zoom: 12, maxTiles: 2500 },
      { layer: 'water_name', zoom: 10, maxTiles: 800 },
      { layer: 'housenumber', zoom: 13, maxTiles: 1000 }
    ]
  },
  detailed: {
    id: 'detailed',
    label: 'Detallado',
    description: 'Mas calles urbanas y numeros. Puede tardar mas y usar mas memoria en mapas grandes.',
    maxTiles: 52000,
    layers: [
      { layer: 'place', zoom: 8, maxTiles: 800 },
      { layer: 'transportation_name', zoom: 12, maxTiles: 18000 },
      { layer: 'transportation_name', zoom: 14, maxTiles: 26000, aroundPlaces: true },
      { layer: 'poi', zoom: 13, maxTiles: 4500 },
      { layer: 'water_name', zoom: 11, maxTiles: 1200 },
      { layer: 'housenumber', zoom: 14, maxTiles: 1500 }
    ]
  }
};
const DEFAULT_SEARCH_PROFILE = 'streets';
const SEARCH_NAME_FIELDS = ['name:es', 'name', 'name:en', 'addr:street', 'addr:housenumber', 'ref'];

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
  return `/maps/?session=${encodeURIComponent(id)}`;
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

function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function profileFor(value) {
  const id = typeof value === 'string' && SEARCH_INDEX_PROFILES[value] ? value : DEFAULT_SEARCH_PROFILE;
  return SEARCH_INDEX_PROFILES[id];
}

function indexKey(source, profileId = DEFAULT_SEARCH_PROFILE) {
  return `${source}:${profileId}`;
}

function availableIndexForSource(source) {
  const preferred = searchIndexes.get(indexKey(source, DEFAULT_SEARCH_PROFILE));
  if (preferred?.items) return preferred;

  for (const profile of Object.values(SEARCH_INDEX_PROFILES)) {
    const index = searchIndexes.get(indexKey(source, profile.id));
    if (index?.items) return index;
  }

  return null;
}

function publicIndex(index) {
  if (!index?.items) return null;
  return {
    source: index.source,
    profile: index.profile,
    indexed: index.items.length,
    scannedTiles: index.scannedTiles,
    builtAt: new Date(index.builtAt).toISOString()
  };
}

function jobSnapshot(job) {
  if (!job) return null;
  return {
    id: job.id,
    source: job.source,
    profile: job.profile,
    status: job.status,
    message: job.message,
    progress: job.progress,
    scannedTiles: job.scannedTiles,
    indexed: job.indexed,
    startedAt: new Date(job.startedAt).toISOString(),
    finishedAt: job.finishedAt ? new Date(job.finishedAt).toISOString() : null,
    error: job.error || null
  };
}

function updateJob(job, patch) {
  if (!job) return;
  Object.assign(job, patch);
}

function tileX(lon, z) {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}

function tileY(lat, z) {
  const rad = lat * Math.PI / 180;
  return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z);
}

function tilePointToLonLat(tile, point, extent) {
  const scale = 2 ** tile.z;
  const x = (tile.x + point.x / extent) / scale;
  const y = (tile.y + point.y / extent) / scale;
  const lon = x * 360 - 180;
  const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI;
  return [lon, lat];
}

function clampTile(value, z) {
  return Math.max(0, Math.min(2 ** z - 1, value));
}

function tilesForBounds(bounds, z) {
  const west = bounds[0];
  const south = Math.max(-85.0511, bounds[1]);
  const east = bounds[2];
  const north = Math.min(85.0511, bounds[3]);
  const minX = clampTile(tileX(west, z), z);
  const maxX = clampTile(tileX(east, z), z);
  const minY = clampTile(tileY(north, z), z);
  const maxY = clampTile(tileY(south, z), z);
  const tiles = [];

  for (let x = Math.min(minX, maxX); x <= Math.max(minX, maxX); x += 1) {
    for (let y = Math.min(minY, maxY); y <= Math.max(minY, maxY); y += 1) {
      tiles.push({ z, x, y });
    }
  }

  return tiles;
}

function spreadTiles(tiles, maxTiles) {
  if (!maxTiles || tiles.length <= maxTiles) return tiles;
  const selected = [];
  const step = tiles.length / maxTiles;
  for (let i = 0; i < maxTiles; i += 1) {
    selected.push(tiles[Math.floor(i * step)]);
  }
  return selected;
}

function tilesAroundCenters(centers, z, maxTiles) {
  const seen = new Set();
  const tiles = [];
  const sorted = [...centers].sort((a, b) => {
    const rankA = Number(a.rank ?? 99);
    const rankB = Number(b.rank ?? 99);
    return rankA - rankB;
  });

  for (const center of sorted) {
    const x = clampTile(tileX(center.center[0], z), z);
    const y = clampTile(tileY(center.center[1], z), z);
    const radius = center.className === 'city' ? 2 : center.className === 'town' ? 1 : 0;

    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dy = -radius; dy <= radius; dy += 1) {
        const tile = { z, x: clampTile(x + dx, z), y: clampTile(y + dy, z) };
        const key = `${tile.z}/${tile.x}/${tile.y}`;
        if (seen.has(key)) continue;
        seen.add(key);
        tiles.push(tile);
        if (tiles.length >= maxTiles) return tiles;
      }
    }
  }

  return tiles;
}

function averageCoordinate(coords) {
  if (!coords.length) return null;
  const total = coords.reduce((acc, coord) => [acc[0] + coord[0], acc[1] + coord[1]], [0, 0]);
  return [total[0] / coords.length, total[1] / coords.length];
}

function featureCenter(feature, tile) {
  const geometry = feature.loadGeometry();
  const coords = [];
  for (const line of geometry) {
    for (const point of line) {
      coords.push(tilePointToLonLat(tile, point, feature.extent || 4096));
    }
  }
  return averageCoordinate(coords);
}

function searchTitle(properties) {
  for (const field of SEARCH_NAME_FIELDS) {
    if (properties[field]) return String(properties[field]);
  }
  return '';
}

function searchDetail(properties, layer) {
  return [properties['addr:housenumber'], properties.class, properties.type, properties.ref, layer]
    .filter(Boolean)
    .join(' · ');
}

function searchRank(item, query) {
  const title = normalizeSearchText(item.title);
  const detail = normalizeSearchText(item.detail);
  if (title === query) return 0;
  if (title.startsWith(query)) return 1;
  if (title.split(/\s+/).some(part => part === query)) return 2;
  if (title.includes(query)) return 3;
  if (detail.includes(query)) return 4;
  return 5;
}

async function readTile(source, tile) {
  const url = `${martinBaseInternal}/${encodeURIComponent(source)}/${tile.z}/${tile.x}/${tile.y}`;
  const response = await fetch(url, { headers: { accept: 'application/x-protobuf' } });
  if (response.status === 204 || response.status === 404) return null;
  if (!response.ok) throw new Error(`Martin returned ${response.status} reading tile ${tile.z}/${tile.x}/${tile.y}`);
  return Buffer.from(await response.arrayBuffer());
}

function addSearchFeatures(items, seen, tileBuffer, tile, layerName) {
  const vectorTile = new VectorTile(new Protobuf(tileBuffer));
  const layer = vectorTile.layers[layerName];
  if (!layer) return;

  for (let i = 0; i < layer.length; i += 1) {
    const feature = layer.feature(i);
    const properties = feature.properties || {};
    const title = searchTitle(properties);
    if (!title) continue;

    const center = featureCenter(feature, tile);
    if (!center) continue;

    const key = `${layerName}:${normalizeSearchText(title)}:${center.map(value => value.toFixed(4)).join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);

    items.push({
      title,
      detail: searchDetail(properties, layerName),
      layer: layerName,
      center,
      className: properties.class || '',
      rank: properties.rank
    });
  }
}

async function readTilejson(source) {
  const upstream = await fetch(`${martinBaseInternal}/${encodeURIComponent(source)}`, {
    headers: { accept: 'application/json' }
  });
  if (!upstream.ok) throw new Error(`Martin returned ${upstream.status}`);
  return upstream.json();
}

async function buildSearchIndex(source, options = {}) {
  const profile = profileFor(options.profile);
  const key = indexKey(source, profile.id);
  const cached = searchIndexes.get(key);
  if (cached?.items) return cached;
  if (cached?.promise) return cached.promise;

  const promise = (async () => {
    const tilejson = await readTilejson(source);
    const bounds = Array.isArray(tilejson.bounds) ? tilejson.bounds : [-180, -85, 180, 85];
    const availableLayers = new Set((tilejson.vector_layers || []).map(layer => layer.id));
    const items = [];
    const seen = new Set();
    const placeCenters = [];
    let scannedTiles = 0;
    const job = options.job || null;

    updateJob(job, {
      status: 'running',
      message: `Leyendo ${profile.label}`,
      progress: 2,
      scannedTiles,
      indexed: items.length
    });

    for (const config of profile.layers) {
      if (availableLayers.size && !availableLayers.has(config.layer)) continue;
      const tiles = config.aroundPlaces
        ? tilesAroundCenters(placeCenters, config.zoom, config.maxTiles)
        : spreadTiles(tilesForBounds(bounds, config.zoom), config.maxTiles);
      let scannedLayerTiles = 0;
      for (const tile of tiles) {
        if (scannedTiles >= profile.maxTiles || scannedTiles >= searchMaxTiles) break;
        scannedTiles += 1;
        scannedLayerTiles += 1;
        const itemCount = items.length;
        const tileBuffer = await readTile(source, tile);
        if (!tileBuffer) continue;
        addSearchFeatures(items, seen, tileBuffer, tile, config.layer);
        if (config.layer === 'place' && items.length > itemCount) {
          placeCenters.push(...items.slice(itemCount).filter(item => item.layer === 'place'));
        }
        if (job && scannedTiles % 100 === 0) {
          updateJob(job, {
            message: `Indexando ${config.layer} z${config.zoom}`,
            progress: Math.min(96, Math.round((scannedTiles / Math.min(profile.maxTiles, searchMaxTiles)) * 100)),
            scannedTiles,
            indexed: items.length
          });
        }
      }
    }

    const index = {
      source,
      profile: profile.id,
      bounds,
      items,
      scannedTiles,
      builtAt: Date.now()
    };
    searchIndexes.set(key, index);
    updateJob(job, {
      status: 'complete',
      message: 'Indice listo',
      progress: 100,
      scannedTiles,
      indexed: items.length,
      finishedAt: Date.now()
    });
    return index;
  })().catch(error => {
    searchIndexes.delete(key);
    if (options.job) {
      updateJob(options.job, {
        status: 'error',
        message: 'No se pudo indexar',
        error: error.message || String(error),
        finishedAt: Date.now()
      });
    }
    throw error;
  });

  searchIndexes.set(key, { promise });
  return promise;
}

async function sendSearchResults(req, res, next) {
  const source = typeof req.query.source === 'string' && req.query.source.trim()
    ? req.query.source.trim()
    : 'castilla_y_leon';
  const query = normalizeSearchText(req.query.q);
  const limit = Math.min(searchMaxResults, Math.max(1, Number(req.query.limit || searchMaxResults)));

  if (!/^[a-zA-Z0-9_.-]+$/.test(source)) {
    res.status(400).json({ error: 'Invalid source id' });
    return;
  }

  if (!query) {
    res.json({ source, query: '', results: [] });
    return;
  }

  try {
    const hasExplicitProfile = typeof req.query.profile === 'string' && req.query.profile.trim();
    const profile = profileFor(req.query.profile);
    const key = indexKey(source, profile.id);
    const cached = hasExplicitProfile ? searchIndexes.get(key) : availableIndexForSource(source);
    const autoIndex = allowSearchAutoIndex || req.query.autoIndex === '1';

    if (!cached?.items && !cached?.promise && !autoIndex) {
      res.status(409).json({
        error: 'Search index is not ready',
        code: 'INDEX_NOT_READY',
        source,
        profile: profile.id,
        availableProfiles: Object.values(SEARCH_INDEX_PROFILES)
          .map(item => item.id)
          .filter(profileId => searchIndexes.get(indexKey(source, profileId))?.items),
        settingsUrl: `/maps/settings?source=${encodeURIComponent(source)}`
      });
      return;
    }

    const index = cached?.items ? cached : await buildSearchIndex(source, { profile: profile.id });
    const results = index.items
      .filter(item => normalizeSearchText(`${item.title} ${item.detail}`).includes(query))
      .map((item, position) => ({ item, position, rank: searchRank(item, query) }))
      .sort((a, b) => a.rank - b.rank || a.position - b.position)
      .map(entry => entry.item)
      .slice(0, limit);

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      source,
      profile: index.profile,
      query: req.query.q,
      indexed: index.items.length,
      scannedTiles: index.scannedTiles,
      results
    });
  } catch (error) {
    next(error);
  }
}

async function sendSearchSettings(req, res, next) {
  try {
    const upstream = await fetch(`${martinBaseInternal}/catalog`, {
      headers: { accept: 'application/json' }
    });
    const catalog = upstream.ok ? await upstream.json() : { tiles: {} };
    const sources = Object.keys(catalog.tiles || {}).sort((a, b) => a.localeCompare(b));

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      defaultProfile: DEFAULT_SEARCH_PROFILE,
      maxTiles: searchMaxTiles,
      sources,
      profiles: Object.values(SEARCH_INDEX_PROFILES).map(profile => ({
        id: profile.id,
        label: profile.label,
        description: profile.description,
        maxTiles: Math.min(profile.maxTiles, searchMaxTiles),
        layers: profile.layers
      }))
    });
  } catch (error) {
    next(error);
  }
}

function sendSearchIndexStatus(req, res) {
  const source = typeof req.query.source === 'string' && req.query.source.trim()
    ? req.query.source.trim()
    : 'castilla_y_leon';
  const profile = profileFor(req.query.profile);
  const key = indexKey(source, profile.id);

  res.setHeader('Cache-Control', 'no-store');
  res.json({
    source,
    profile: profile.id,
    index: publicIndex(searchIndexes.get(key)),
    job: jobSnapshot(searchJobs.get(key))
  });
}

function startSearchIndex(req, res) {
  const source = typeof req.body?.source === 'string' && req.body.source.trim()
    ? req.body.source.trim()
    : '';
  const profile = profileFor(req.body?.profile);
  const force = req.body?.force !== false;

  if (!/^[a-zA-Z0-9_.-]+$/.test(source)) {
    res.status(400).json({ error: 'Invalid source id' });
    return;
  }

  const key = indexKey(source, profile.id);
  const existingJob = searchJobs.get(key);
  if (existingJob?.status === 'running') {
    res.status(202).json({ job: jobSnapshot(existingJob), index: publicIndex(searchIndexes.get(key)) });
    return;
  }

  if (force) searchIndexes.delete(key);
  const cached = searchIndexes.get(key);
  if (!force && cached?.items) {
    res.json({ job: null, index: publicIndex(cached) });
    return;
  }

  const job = {
    id: crypto.randomUUID(),
    source,
    profile: profile.id,
    status: 'queued',
    message: 'Esperando inicio',
    progress: 0,
    scannedTiles: 0,
    indexed: 0,
    startedAt: Date.now(),
    finishedAt: null,
    error: null
  };
  searchJobs.set(key, job);

  buildSearchIndex(source, { profile: profile.id, job }).catch(error => {
    console.error(`Search index failed for ${source}/${profile.id}:`, error);
  });

  res.status(202).json({ job: jobSnapshot(job), index: null });
}

app.get('/api/catalog', sendCatalog);
app.get('/maps/api/catalog', sendCatalog);
app.get('/api/tilejson/:source', sendTilejson);
app.get('/maps/api/tilejson/:source', sendTilejson);
app.get('/api/search', sendSearchResults);
app.get('/maps/api/search', sendSearchResults);
app.get('/api/search/settings', sendSearchSettings);
app.get('/maps/api/search/settings', sendSearchSettings);
app.get('/api/search/index', sendSearchIndexStatus);
app.get('/maps/api/search/index', sendSearchIndexStatus);
app.post('/api/search/index', startSearchIndex);
app.post('/maps/api/search/index', startSearchIndex);
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

function sendSearch(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(root, 'search.html'));
}

function sendSettings(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(root, 'settings.html'));
}

app.use('/vendor/maplibre-gl', express.static(maplibreRoot, { immutable: true, maxAge: '1y' }));
app.use('/maps/vendor/maplibre-gl', express.static(maplibreRoot, { immutable: true, maxAge: '1y' }));

app.get(['/', '/index.html', '/maps', '/maps/', '/maps/index.html'], sendIndex);
app.get(['/search', '/search.html', '/maps/search', '/maps/search.html'], sendSearch);
app.get(['/settings', '/settings.html', '/maps/settings', '/maps/settings.html'], sendSettings);

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
