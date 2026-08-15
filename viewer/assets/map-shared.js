export const DEFAULT_SOURCE = 'castilla_y_leon';
export const DEFAULT_CENTER = [-4.423285, 41.6606935];
export const DEFAULT_ZOOM = 7;

export function normalizeBounds(value, name = 'bounds') {
  if (!value) return null;
  if (!Array.isArray(value) || value.length !== 4) throw new Error(`"${name}" debe ser [oeste, sur, este, norte]`);
  const bounds = value.map(Number);
  if (!bounds.every(Number.isFinite)) throw new Error(`"${name}" contiene valores invalidos`);
  return bounds;
}

export function fitToCoords(map, coords, maxZoom = 13, padding = 40) {
  if (!coords.length) return null;
  const bounds = new maplibregl.LngLatBounds(coords[0], coords[0]);
  for (const coord of coords) bounds.extend(coord);
  map.fitBounds(bounds, { padding, maxZoom, duration: 250 });
  return { bounds, maxZoom };
}

export function fitToBoundsArray(map, bounds, maxZoom = 13, padding = 40) {
  if (!bounds) return null;
  const fitBounds = new maplibregl.LngLatBounds([bounds[0], bounds[1]], [bounds[2], bounds[3]]);
  map.fitBounds(fitBounds, { padding, maxZoom, duration: 250 });
  return { bounds: fitBounds, maxZoom };
}

function appPrefix() {
  return window.location.pathname.startsWith('/maps') ? '/maps' : '';
}

function martinBase(params) {
  const explicit = params.get('martinBase');
  if (explicit) return explicit.replace(/\/$/, '');
  return '';
}

export function tilejsonUrl(params, sourceId) {
  const base = martinBase(params);
  const cacheKey = Date.now();

  if (base) {
    return `${base}/${encodeURIComponent(sourceId)}?ts=${cacheKey}`;
  }

  return `${appPrefix()}/api/tilejson/${encodeURIComponent(sourceId)}?ts=${cacheKey}`;
}

export function catalogUrl() {
  return `${appPrefix()}/api/catalog?ts=${Date.now()}`;
}

function normalizeTileTemplate(rawUrl) {
  if (typeof rawUrl !== 'string') return rawUrl;
  const currentOrigin = window.location.origin;
  const currentProtocol = window.location.protocol;
  if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
    try {
      const parsed = new URL(rawUrl);

      if (
        parsed.hostname === window.location.hostname &&
        (parsed.protocol !== currentProtocol || parsed.host !== window.location.host)
      ) {
        return `${currentOrigin}${parsed.pathname}${parsed.search}${parsed.hash}`;
      }

      return rawUrl;
    } catch {
      return rawUrl;
    }
  }
  if (rawUrl.startsWith('//')) {
    return `${currentProtocol}${rawUrl}`;
  }
  if (rawUrl.startsWith('/')) {
    return `${currentOrigin}${rawUrl}`;
  }
  return rawUrl;
}

export function normalizeTilejson(tilejson) {
  const out = { ...tilejson };
  if (Array.isArray(out.tiles)) out.tiles = out.tiles.map(normalizeTileTemplate);
  if (Array.isArray(out.data)) out.data = out.data.map(normalizeTileTemplate);
  return out;
}

export function mapStyle(tilejson, minZoom, maxZoom, bounds) {
  return {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      osm: { type: 'vector', tiles: tilejson.tiles, minzoom: minZoom, maxzoom: maxZoom, bounds }
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#edf3f1' } },
      { id: 'landcover', type: 'fill', source: 'osm', 'source-layer': 'landcover', paint: { 'fill-color': '#dbe9d5' } },
      { id: 'landuse', type: 'fill', source: 'osm', 'source-layer': 'landuse', paint: { 'fill-color': '#e9e4cf' } },
      { id: 'park', type: 'fill', source: 'osm', 'source-layer': 'park', paint: { 'fill-color': '#c9e4c6' } },
      { id: 'water', type: 'fill', source: 'osm', 'source-layer': 'water', paint: { 'fill-color': '#a7d2ef' } },
      {
        id: 'waterway',
        type: 'line',
        source: 'osm',
        'source-layer': 'waterway',
        paint: { 'line-color': '#72add7', 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.4, 8, 0.8, 12, 1.4, 14, 2] }
      },
      {
        id: 'transportation',
        type: 'line',
        source: 'osm',
        'source-layer': 'transportation',
        paint: { 'line-color': '#9b8170', 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.45, 8, 0.9, 10, 1.6, 12, 2.6, 14, 4] }
      },
      { id: 'building', type: 'fill', source: 'osm', 'source-layer': 'building', minzoom: 13, paint: { 'fill-color': '#d6cec0', 'fill-opacity': 0.9 } },
      {
        id: 'place-labels',
        type: 'symbol',
        source: 'osm',
        'source-layer': 'place',
        layout: {
          'text-field': ['coalesce', ['get', 'name:es'], ['get', 'name']],
          'text-font': ['Noto Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 4, 10, 8, 12, 12, 15]
        },
        paint: { 'text-color': '#20302c', 'text-halo-color': '#ffffff', 'text-halo-width': 1.2 }
      },
      {
        id: 'road-labels',
        type: 'symbol',
        source: 'osm',
        'source-layer': 'transportation_name',
        minzoom: 10,
        layout: {
          'symbol-placement': 'line',
          'text-field': ['coalesce', ['get', 'name:es'], ['get', 'name']],
          'text-font': ['Noto Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 10, 10, 14, 12]
        },
        paint: { 'text-color': '#5a4a3a', 'text-halo-color': '#ffffff', 'text-halo-width': 1 }
      },
      {
        id: 'water-labels',
        type: 'symbol',
        source: 'osm',
        'source-layer': 'water_name',
        minzoom: 9,
        layout: { 'text-field': ['coalesce', ['get', 'name:es'], ['get', 'name']], 'text-font': ['Noto Sans Regular'], 'text-size': 11 },
        paint: { 'text-color': '#246d9a', 'text-halo-color': '#ffffff', 'text-halo-width': 1 }
      }
    ]
  };
}
