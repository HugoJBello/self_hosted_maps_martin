import {
  DEFAULT_CENTER,
  DEFAULT_SOURCE,
  DEFAULT_ZOOM,
  catalogUrl,
  fitToBoundsArray,
  fitToCoords,
  mapStyle,
  normalizeTilejson,
  tilejsonUrl
} from './map-shared.js';

const DEFAULT_SEARCH_LAYERS = [
  'place',
  'transportation_name',
  'water_name',
  'poi',
  'housenumber',
  'building',
  'transportation',
  'waterway',
  'water'
];

const NAME_FIELDS = [
  'name:es',
  'name',
  'name:en',
  'addr:street',
  'addr:housenumber',
  'ref',
  'class',
  'type'
];

const els = {
  sourceSummary: document.getElementById('sourceSummary'),
  sourceSelect: document.getElementById('sourceSelect'),
  viewerRouteButton: document.getElementById('viewerRouteButton'),
  settingsRouteButton: document.getElementById('settingsRouteButton'),
  searchForm: document.getElementById('searchForm'),
  searchInput: document.getElementById('searchInput'),
  searchStatus: document.getElementById('searchStatus'),
  searchError: document.getElementById('searchError'),
  resultsList: document.getElementById('resultsList')
};

const state = {
  map: null,
  sourceId: DEFAULT_SOURCE,
  profileId: '',
  sourceLayers: DEFAULT_SEARCH_LAYERS,
  results: []
};

function setStatus(message) {
  els.searchStatus.textContent = message || '';
}

function setError(message) {
  els.searchError.hidden = !message;
  els.searchError.textContent = message || '';
}

function sourceFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('source') || DEFAULT_SOURCE;
}

function routeUrl(pathname, sourceId) {
  const url = new URL(pathname, window.location.href);
  url.searchParams.set('source', sourceId);
  return url.toString();
}

function updateRouteLinks() {
  els.viewerRouteButton.href = routeUrl('./', state.sourceId);
  els.settingsRouteButton.href = routeUrl('./settings', state.sourceId);
}

function navigateToSource(sourceId) {
  const next = sourceId.trim() || DEFAULT_SOURCE;
  window.location.href = routeUrl('./search', next);
}

function searchApiUrl(query) {
  const appPrefix = window.location.pathname.startsWith('/maps') ? '/maps' : '';
  const url = new URL(`${appPrefix}/api/search`, window.location.origin);
  url.searchParams.set('source', state.sourceId);
  url.searchParams.set('q', query);
  if (state.profileId) url.searchParams.set('profile', state.profileId);
  return url.toString();
}

function settingsRoute() {
  return routeUrl('./settings', state.sourceId);
}

function setIndexRequiredNotice() {
  els.searchError.hidden = false;
  els.searchError.innerHTML = '';
  const text = document.createElement('span');
  text.textContent = 'Este mapa aun no tiene indice offline preparado. ';
  const link = document.createElement('a');
  link.href = settingsRoute();
  link.textContent = 'Abrir configuracion para indexarlo';
  els.searchError.append(text, link);
}

async function loadSourceCatalog() {
  try {
    const response = await fetch(catalogUrl(), { cache: 'no-store' });
    if (!response.ok) throw new Error(`Catalogo Martin no disponible: ${response.status}`);
    const catalog = await response.json();
    const sources = Object.keys(catalog.tiles || {}).sort((a, b) => a.localeCompare(b));

    if (!sources.length) {
      els.sourceSelect.innerHTML = '<option value="">Sin mapas</option>';
      els.sourceSelect.disabled = true;
      return;
    }

    els.sourceSelect.innerHTML = '';
    for (const source of sources) {
      const option = document.createElement('option');
      option.value = source;
      option.textContent = source;
      els.sourceSelect.appendChild(option);
    }

    if (!sources.includes(state.sourceId)) {
      const option = document.createElement('option');
      option.value = state.sourceId;
      option.textContent = `${state.sourceId} (manual)`;
      els.sourceSelect.prepend(option);
    }

    els.sourceSelect.value = state.sourceId;
    els.sourceSelect.disabled = false;
  } catch (error) {
    console.warn(error);
    els.sourceSelect.innerHTML = '';
    const option = document.createElement('option');
    option.value = state.sourceId;
    option.textContent = state.sourceId;
    els.sourceSelect.appendChild(option);
  }
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function resultTitle(properties) {
  return properties['name:es'] || properties.name || properties['name:en'] || properties['addr:street'] || properties.ref || '';
}

function resultDetail(properties, sourceLayer) {
  const parts = [];
  if (properties['addr:housenumber']) parts.push(properties['addr:housenumber']);
  if (properties.class) parts.push(properties.class);
  if (properties.type) parts.push(properties.type);
  parts.push(sourceLayer);
  return parts.filter(Boolean).join(' · ');
}

function geometryCoords(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Point') return [geometry.coordinates];
  if (geometry.type === 'LineString' || geometry.type === 'MultiPoint') return geometry.coordinates || [];
  if (geometry.type === 'MultiLineString' || geometry.type === 'Polygon') return (geometry.coordinates || []).flat();
  if (geometry.type === 'MultiPolygon') return (geometry.coordinates || []).flat(2);
  if (geometry.type === 'GeometryCollection') return (geometry.geometries || []).flatMap(geometryCoords);
  return [];
}

function centerOfCoords(coords) {
  if (!coords.length) return DEFAULT_CENTER;
  const total = coords.reduce((acc, coord) => [acc[0] + coord[0], acc[1] + coord[1]], [0, 0]);
  return [total[0] / coords.length, total[1] / coords.length];
}

function featureMatches(feature, query) {
  const properties = feature.properties || {};
  const text = NAME_FIELDS
    .map(field => properties[field])
    .filter(Boolean)
    .join(' ');
  return normalizeText(text).includes(query);
}

function collectResults(rawQuery) {
  const query = normalizeText(rawQuery);
  if (!query) return [];

  const seen = new Set();
  const results = [];

  for (const sourceLayer of state.sourceLayers) {
    let features = [];
    try {
      features = state.map.querySourceFeatures('osm', { sourceLayer });
    } catch {
      continue;
    }

    for (const feature of features) {
      if (!featureMatches(feature, query)) continue;

      const title = resultTitle(feature.properties || {});
      const coords = geometryCoords(feature.geometry).filter(coord => Array.isArray(coord) && coord.length >= 2);
      if (!title || !coords.length) continue;

      const center = centerOfCoords(coords);
      const key = `${sourceLayer}:${normalizeText(title)}:${center.map(value => value.toFixed(4)).join(',')}`;
      if (seen.has(key)) continue;
      seen.add(key);

      results.push({
        id: key,
        title,
        detail: resultDetail(feature.properties || {}, sourceLayer),
        center,
        coords
      });

      if (results.length >= 80) return results;
    }
  }

  return results;
}

function setSelection(result) {
  const data = {
    type: 'FeatureCollection',
    features: result ? [{
      type: 'Feature',
      properties: { title: result.title },
      geometry: { type: 'Point', coordinates: result.center }
    }] : []
  };

  const source = state.map.getSource('search-selection-src');
  if (source) source.setData(data);
}

function focusResult(result) {
  setSelection(result);
  const coords = Array.isArray(result.coords) && result.coords.length ? result.coords : [result.center];
  if (coords.length > 1) {
    fitToCoords(state.map, coords, 16, 72);
    return;
  }

  state.map.flyTo({ center: result.center, zoom: Math.max(state.map.getZoom(), 15), duration: 350 });
}

function renderResults(results) {
  els.resultsList.innerHTML = '';
  state.results = results;

  if (!results.length) {
    setSelection(null);
    setStatus('Sin resultados en los elementos cargados del mapa.');
    return;
  }

  setStatus(`${results.length} resultado${results.length === 1 ? '' : 's'}.`);

  results.forEach((result, index) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'result-item';
    button.dataset.resultIndex = String(index);

    const title = document.createElement('span');
    title.className = 'result-title';
    title.textContent = result.title;

    const detail = document.createElement('span');
    detail.className = 'result-detail';
    detail.textContent = result.detail;

    button.append(title, detail);
    item.appendChild(button);
    els.resultsList.appendChild(item);
  });
}

async function runSearch() {
  setError('');
  const query = els.searchInput.value.trim();
  if (!query) {
    renderResults([]);
    setStatus('Escribe un texto para buscar.');
    return;
  }

  setStatus('Buscando en el indice local offline...');

  try {
    const response = await fetch(searchApiUrl(query), { cache: 'no-store' });
    if (response.status === 409) {
      setIndexRequiredNotice();
      setStatus('Indexa este mapa desde configuracion antes de buscar en todo el mapa.');
      renderResults(collectResults(query));
      return;
    }
    if (!response.ok) throw new Error(`Busqueda local no disponible: ${response.status}`);
    const payload = await response.json();
    const results = (payload.results || []).map(result => ({
      ...result,
      coords: Array.isArray(result.coords) ? result.coords : [result.center]
    }));
    renderResults(results);
    if (results.length) {
      setStatus(`${results.length} resultado${results.length === 1 ? '' : 's'} en el indice offline (${payload.indexed || 0} elementos).`);
      return;
    }
  } catch (error) {
    console.warn(error);
    setError('No se pudo consultar el indice offline. Usando solo los elementos cargados en pantalla.');
  }

  renderResults(collectResults(query));
}

function wireEvents() {
  els.sourceSelect.addEventListener('change', () => navigateToSource(els.sourceSelect.value));
  els.searchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    runSearch();
  });
  els.resultsList.addEventListener('click', (event) => {
    const button = event.target.closest('.result-item');
    if (!button) return;
    const result = state.results[Number(button.dataset.resultIndex)];
    if (result) focusResult(result);
  });
}

async function main() {
  try {
    if (!window.maplibregl) throw new Error('MapLibre GL JS no esta disponible');

    const params = new URLSearchParams(window.location.search);
    state.sourceId = sourceFromUrl();
    state.profileId = params.get('profile') || '';
    updateRouteLinks();
    wireEvents();
    loadSourceCatalog();

    setStatus(`Leyendo TileJSON de ${state.sourceId}`);
    const response = await fetch(tilejsonUrl(params, state.sourceId), { cache: 'no-store' });
    if (!response.ok) throw new Error(`No se pudo leer TileJSON de "${state.sourceId}": ${response.status}`);

    const tilejson = normalizeTilejson(await response.json());
    const bounds = tilejson.bounds || [-180, -85, 180, 85];
    const minZoom = tilejson.minzoom ?? 0;
    const maxZoom = tilejson.maxzoom ?? 14;
    if (!Array.isArray(tilejson.tiles) || !tilejson.tiles.length) {
      throw new Error(`TileJSON invalido para "${state.sourceId}": no contiene "tiles"`);
    }

    state.sourceLayers = Array.isArray(tilejson.vector_layers) && tilejson.vector_layers.length
      ? tilejson.vector_layers.map(layer => layer.id).filter(Boolean)
      : DEFAULT_SEARCH_LAYERS;

    els.sourceSummary.textContent = `Fuente ${state.sourceId} · zoom ${minZoom}-${maxZoom}`;

    const map = new maplibregl.Map({
      container: 'map',
      style: mapStyle(tilejson, minZoom, maxZoom, bounds),
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      minZoom: Math.max(minZoom, 4),
      maxZoom,
      renderWorldCopies: false
    });
    state.map = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 140, unit: 'metric' }), 'bottom-right');

    map.on('load', () => {
      fitToBoundsArray(map, bounds, 9);
      map.setMaxBounds(new maplibregl.LngLatBounds([bounds[0], bounds[1]], [bounds[2], bounds[3]]));
      map.addSource('search-selection-src', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
      map.addLayer({
        id: 'search-selection-halo',
        type: 'circle',
        source: 'search-selection-src',
        paint: {
          'circle-radius': 15,
          'circle-color': '#126c5c',
          'circle-opacity': 0.22,
          'circle-stroke-color': '#126c5c',
          'circle-stroke-width': 2
        }
      });
      map.addLayer({
        id: 'search-selection-point',
        type: 'circle',
        source: 'search-selection-src',
        paint: {
          'circle-radius': 6,
          'circle-color': '#c62f2a',
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2
        }
      });
      setStatus('Escribe un texto para buscar en los elementos cargados del mapa.');
    });

    map.on('error', (event) => {
      console.error('MapLibre error:', event);
      setError(event?.error?.message || 'Error desconocido de MapLibre');
    });
  } catch (error) {
    console.error(error);
    setError(error.message || String(error));
    setStatus('No se pudo cargar la busqueda');
  }
}

main();
