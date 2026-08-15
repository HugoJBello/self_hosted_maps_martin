import {
  DEFAULT_CENTER,
  DEFAULT_SOURCE,
  DEFAULT_ZOOM,
  catalogUrl,
  fitToBoundsArray,
  mapStyle,
  normalizeBounds,
  normalizeTilejson,
  tilejsonUrl
} from './map-shared.js';

const els = {
  sourceSummary: document.getElementById('sourceSummary'),
  sourceSelect: document.getElementById('sourceSelect'),
  viewerRouteButton: document.getElementById('viewerRouteButton'),
  searchRouteButton: document.getElementById('searchRouteButton'),
  settingsRouteButton: document.getElementById('settingsRouteButton'),
  clickModeButton: document.getElementById('clickModeButton'),
  coordModeButton: document.getElementById('coordModeButton'),
  coordForm: document.getElementById('coordForm'),
  coordInput: document.getElementById('coordInput'),
  latInput: document.getElementById('latInput'),
  lonInput: document.getElementById('lonInput'),
  infoStatus: document.getElementById('infoStatus'),
  infoError: document.getElementById('infoError'),
  infoCard: document.getElementById('infoCard')
};

const state = {
  map: null,
  sourceId: DEFAULT_SOURCE,
  mode: 'click',
  marker: null
};

function appPrefix() {
  return window.location.pathname.startsWith('/maps') ? '/maps' : '';
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
  els.searchRouteButton.href = routeUrl('./search', state.sourceId);
  els.settingsRouteButton.href = routeUrl('./settings', state.sourceId);
}

function navigateToSource(sourceId) {
  const next = sourceId.trim() || DEFAULT_SOURCE;
  window.location.href = routeUrl('./info', next);
}

function setStatus(message) {
  els.infoStatus.textContent = message || '';
}

function setError(message) {
  els.infoError.hidden = !message;
  els.infoError.textContent = message || '';
}

function formatCoord(value) {
  return Number(value).toFixed(6);
}

function setMode(mode) {
  state.mode = mode;
  els.clickModeButton.classList.toggle('is-active', mode === 'click');
  els.coordModeButton.classList.toggle('is-active', mode === 'coord');
  els.coordInput.focus();
  setStatus(mode === 'click'
    ? 'Modo click activo: selecciona un punto del mapa.'
    : 'Introduce una coordenada y pulsa Ir.');
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
    els.sourceSelect.innerHTML = `<option value="${state.sourceId}">${state.sourceId}</option>`;
    els.sourceSelect.value = state.sourceId;
  }
}

function decimal(value) {
  return Number(String(value).trim().replace(',', '.'));
}

function validLatLon(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

function parseDmsNumber(deg, min = 0, sec = 0, hemi = '') {
  const sign = /^[SW]$/i.test(hemi) ? -1 : 1;
  return sign * (Math.abs(Number(deg)) + Number(min || 0) / 60 + Number(sec || 0) / 3600);
}

function parseDmsText(raw) {
  const tokens = raw.match(/[NSWE]|-?\d+(?:[.,]\d+)?/gi) || [];
  const matches = [];
  const prefixMode = /^[NSWE]$/i.test(tokens[0] || '');

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i].toUpperCase();
    if (!/^[NSWE]$/.test(token)) continue;

    let values = [];
    const nextValues = [];
    for (let j = i + 1; j < tokens.length && !/^[NSWE]$/i.test(tokens[j]); j += 1) {
      nextValues.push(decimal(tokens[j]));
    }
    const prevValues = [];
    for (let j = i - 1; j >= 0 && !/^[NSWE]$/i.test(tokens[j]); j -= 1) {
      prevValues.unshift(decimal(tokens[j]));
    }
    values = prefixMode
      ? (nextValues.length ? nextValues : prevValues)
      : (prevValues.length ? prevValues : nextValues);
    if (!values.length) continue;

    matches.push({
      hemi: token,
      value: parseDmsNumber(values[0], values[1] || 0, values[2] || 0, token)
    });
  }

  const lat = matches.find(item => item.hemi === 'N' || item.hemi === 'S')?.value;
  const lon = matches.find(item => item.hemi === 'E' || item.hemi === 'W')?.value;
  if (validLatLon(lat, lon)) return { lat, lon, format: 'DMS' };
  return null;
}

function utmToLatLon(zone, hemisphere, easting, northing) {
  const northern = !hemisphere || hemisphere.toUpperCase() >= 'N';
  const a = 6378137;
  const e = 0.081819191;
  const e1sq = 0.006739497;
  const k0 = 0.9996;
  const x = easting - 500000;
  const y = northern ? northing : northing - 10000000;
  const m = y / k0;
  const mu = m / (a * (1 - e ** 2 / 4 - 3 * e ** 4 / 64 - 5 * e ** 6 / 256));
  const e1 = (1 - Math.sqrt(1 - e ** 2)) / (1 + Math.sqrt(1 - e ** 2));
  const j1 = 3 * e1 / 2 - 27 * e1 ** 3 / 32;
  const j2 = 21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32;
  const j3 = 151 * e1 ** 3 / 96;
  const j4 = 1097 * e1 ** 4 / 512;
  const fp = mu + j1 * Math.sin(2 * mu) + j2 * Math.sin(4 * mu) + j3 * Math.sin(6 * mu) + j4 * Math.sin(8 * mu);
  const sinFp = Math.sin(fp);
  const cosFp = Math.cos(fp);
  const tanFp = Math.tan(fp);
  const c1 = e1sq * cosFp ** 2;
  const t1 = tanFp ** 2;
  const r1 = a * (1 - e ** 2) / ((1 - e ** 2 * sinFp ** 2) ** 1.5);
  const n1 = a / Math.sqrt(1 - e ** 2 * sinFp ** 2);
  const d = x / (n1 * k0);
  const q1 = n1 * tanFp / r1;
  const q2 = d ** 2 / 2;
  const q3 = (5 + 3 * t1 + 10 * c1 - 4 * c1 ** 2 - 9 * e1sq) * d ** 4 / 24;
  const q4 = (61 + 90 * t1 + 298 * c1 + 45 * t1 ** 2 - 252 * e1sq - 3 * c1 ** 2) * d ** 6 / 720;
  const lat = (fp - q1 * (q2 - q3 + q4)) * 180 / Math.PI;
  const q5 = d;
  const q6 = (1 + 2 * t1 + c1) * d ** 3 / 6;
  const q7 = (5 - 2 * c1 + 28 * t1 - 3 * c1 ** 2 + 8 * e1sq + 24 * t1 ** 2) * d ** 5 / 120;
  const lonOrigin = (zone - 1) * 6 - 180 + 3;
  const lon = lonOrigin + (q5 - q6 + q7) / cosFp * 180 / Math.PI;
  return { lat, lon, format: 'UTM' };
}

function parseUtm(raw) {
  const match = raw.trim().match(/^(\d{1,2})([C-HJ-NP-X])?\s+(\d{5,7}(?:[.,]\d+)?)\s+(\d{6,8}(?:[.,]\d+)?)$/i);
  if (!match) return null;
  const zone = Number(match[1]);
  const easting = decimal(match[3]);
  const northing = decimal(match[4]);
  if (zone < 1 || zone > 60 || !Number.isFinite(easting) || !Number.isFinite(northing)) return null;
  const coord = utmToLatLon(zone, match[2], easting, northing);
  return validLatLon(coord.lat, coord.lon) ? coord : null;
}

function parseMercator(raw) {
  const numbers = raw.match(/-?\d+(?:[.,]\d+)?/g)?.map(decimal) || [];
  if (numbers.length !== 2) return null;
  const [x, y] = numbers;
  if (Math.abs(x) < 180 || Math.abs(y) < 180) return null;
  const lon = x / 20037508.34 * 180;
  const lat = (Math.atan(Math.exp((y / 20037508.34 * 180) * Math.PI / 180)) * 360 / Math.PI) - 90;
  return validLatLon(lat, lon) ? { lat, lon, format: 'EPSG:3857' } : null;
}

function parseDecimalPair(raw) {
  const withHemi = raw.match(/[NSWE]/i);
  if (withHemi) {
    const dms = parseDmsText(raw);
    if (dms) return dms;
  }
  const numbers = raw.match(/-?\d+(?:[.,]\d+)?/g)?.map(decimal) || [];
  if (numbers.length < 2) return null;
  let lat = numbers[0];
  let lon = numbers[1];
  if (!validLatLon(lat, lon) && validLatLon(numbers[1], numbers[0])) {
    lat = numbers[1];
    lon = numbers[0];
  }
  return validLatLon(lat, lon) ? { lat, lon, format: 'Decimal' } : null;
}

function parseCoordinateInput() {
  const lat = decimal(els.latInput.value);
  const lon = decimal(els.lonInput.value);
  if (els.latInput.value.trim() || els.lonInput.value.trim()) {
    if (!validLatLon(lat, lon)) throw new Error('Latitud o longitud invalida.');
    return { lat, lon, format: 'Decimal' };
  }

  const raw = els.coordInput.value.trim();
  if (!raw) throw new Error('Introduce una coordenada.');
  const parsed = parseUtm(raw) || parseMercator(raw) || parseDmsText(raw) || parseDecimalPair(raw);
  if (!parsed) throw new Error('Formato de coordenada no reconocido.');
  return parsed;
}

function pointInfoUrl(coord) {
  const url = new URL(`${appPrefix()}/api/point-info`, window.location.origin);
  url.searchParams.set('source', state.sourceId);
  url.searchParams.set('lat', coord.lat);
  url.searchParams.set('lon', coord.lon);
  url.searchParams.set('radius', 300);
  return url.toString();
}

function setMarker(coord) {
  const lngLat = [coord.lon, coord.lat];
  if (!state.marker) {
    state.marker = new maplibregl.Marker({ color: '#c62f2a' }).setLngLat(lngLat).addTo(state.map);
  } else {
    state.marker.setLngLat(lngLat);
  }
}

function renderInfo(payload, format) {
  els.infoCard.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'point-info-header';
  const title = document.createElement('h2');
  title.textContent = 'Punto seleccionado';
  const coords = document.createElement('p');
  coords.textContent = `${formatCoord(payload.coord.lat)}, ${formatCoord(payload.coord.lon)} - WGS84`;
  header.append(title, coords);

  const grid = document.createElement('dl');
  grid.className = 'point-info-grid';
  for (const [label, value] of [
    ['Latitud', formatCoord(payload.coord.lat)],
    ['Longitud', formatCoord(payload.coord.lon)],
    ['Formato', format],
    ['Radio', `${payload.radiusMeters} m`],
    ['Indice', payload.indexProfile || 'sin indice']
  ]) {
    const item = document.createElement('div');
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = label;
    dd.textContent = value;
    item.append(dt, dd);
    grid.appendChild(item);
  }

  const list = document.createElement('div');
  list.className = 'nearby-list';
  const listTitle = document.createElement('div');
  listTitle.className = 'section-title';
  listTitle.textContent = 'Datos cercanos';
  list.appendChild(listTitle);

  if (!payload.features.length) {
    const empty = document.createElement('p');
    empty.textContent = 'No se encontraron elementos cercanos en los tiles consultados.';
    list.appendChild(empty);
  } else {
    for (const feature of payload.features) {
      const row = document.createElement('article');
      row.className = 'nearby-item';
      const name = document.createElement('strong');
      name.textContent = feature.title || feature.layer;
      const meta = document.createElement('span');
      meta.textContent = [
        `${feature.distanceMeters} m`,
        feature.layer,
        feature.className || feature.type || '',
        feature.source === 'index' ? 'indice' : 'tile'
      ].filter(Boolean).join(' - ');
      const detail = document.createElement('small');
      detail.textContent = feature.detail || '';
      row.append(name, meta, detail);
      list.appendChild(row);
    }
  }

  els.infoCard.append(header, grid, list);
}

async function inspectPoint(coord, options = {}) {
  setError('');
  setStatus('Consultando datos cercanos...');
  setMarker(coord);
  if (options.fly !== false) {
    state.map.flyTo({ center: [coord.lon, coord.lat], zoom: Math.max(state.map.getZoom(), 15), duration: 350 });
  }

  const response = await fetch(pointInfoUrl(coord), { cache: 'no-store' });
  if (!response.ok) throw new Error(`Info no disponible: ${response.status}`);
  const payload = await response.json();
  renderInfo(payload, coord.format || 'Click mapa');
  setStatus(`${payload.features.length} elemento${payload.features.length === 1 ? '' : 's'} cercano${payload.features.length === 1 ? '' : 's'}.`);
}

function wireEvents() {
  els.sourceSelect.addEventListener('change', () => navigateToSource(els.sourceSelect.value));
  els.clickModeButton.addEventListener('click', () => setMode('click'));
  els.coordModeButton.addEventListener('click', () => setMode('coord'));
  els.coordForm.addEventListener('submit', event => {
    event.preventDefault();
    setMode('coord');
    try {
      inspectPoint(parseCoordinateInput()).catch(error => setError(error.message || String(error)));
    } catch (error) {
      setError(error.message || String(error));
    }
  });
}

async function main() {
  try {
    const params = new URLSearchParams(window.location.search);
    state.sourceId = sourceFromUrl();
    updateRouteLinks();
    await loadSourceCatalog();

    const response = await fetch(tilejsonUrl(params, state.sourceId), { cache: 'no-store' });
    if (!response.ok) throw new Error(`No se pudo leer TileJSON de "${state.sourceId}": ${response.status}`);
    const tilejson = normalizeTilejson(await response.json());
    const bounds = normalizeBounds(tilejson.bounds);
    const minZoom = tilejson.minzoom ?? 0;
    const maxZoom = tilejson.maxzoom ?? 14;

    state.map = new maplibregl.Map({
      container: 'map',
      style: mapStyle(tilejson, minZoom, maxZoom, bounds),
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      attributionControl: true
    });
    state.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    state.map.on('load', () => {
      if (bounds) fitToBoundsArray(state.map, bounds, 9, 24);
      els.sourceSummary.textContent = `${state.sourceId} listo`;
      setStatus('Modo click activo: selecciona un punto del mapa.');
    });
    state.map.on('click', event => {
      if (state.mode !== 'click') return;
      inspectPoint({ lat: event.lngLat.lat, lon: event.lngLat.lng, format: 'Click mapa' }, { fly: false })
        .catch(error => setError(error.message || String(error)));
    });

    wireEvents();
  } catch (error) {
    setError(error.message || String(error));
  }
}

main();
