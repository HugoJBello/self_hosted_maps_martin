import {
  DEFAULT_CENTER,
  DEFAULT_SOURCE,
  DEFAULT_ZOOM,
  catalogUrl,
  fitToBoundsArray,
  fitToCoords,
  mapStyle,
  normalizeBounds,
  normalizeTilejson,
  tilejsonUrl
} from './map-shared.js';

const els = {
  shell: document.querySelector('.app-shell'),
  sourceSummary: document.getElementById('sourceSummary'),
  sourceSelect: document.getElementById('sourceSelect'),
  sourceInput: document.getElementById('sourceInput'),
  sourceButton: document.getElementById('sourceButton'),
  sourcePanel: document.getElementById('sourcePanel'),
  sourcePanelButton: document.getElementById('sourcePanelButton'),
  searchRouteButton: document.getElementById('searchRouteButton'),
  infoRouteButton: document.getElementById('infoRouteButton'),
  settingsRouteButton: document.getElementById('settingsRouteButton'),
  controlPanel: document.getElementById('controlPanel'),
  status: document.getElementById('status'),
  error: document.getElementById('error'),
  markerCount: document.getElementById('markerCount'),
  routeCount: document.getElementById('routeCount'),
  polygonCount: document.getElementById('polygonCount'),
  markersToggle: document.getElementById('markersToggle'),
  routesToggle: document.getElementById('routesToggle'),
  polygonsToggle: document.getElementById('polygonsToggle'),
  fitButton: document.getElementById('fitButton'),
  panelButton: document.getElementById('panelButton'),
  compactButton: document.getElementById('compactButton'),
  copyEmbedButton: document.getElementById('copyEmbedButton'),
  compactBadge: document.getElementById('compactBadge'),
  compactTitle: document.getElementById('compactTitle'),
  showPanelButton: document.getElementById('showPanelButton')
};

const state = {
  map: null,
  sourceBounds: null,
  contentCoords: [],
  layerGroups: {
    markers: ['points-layer', 'markers-layer', 'marker-clusters', 'marker-cluster-count'],
    routes: ['route-line'],
    polygons: ['poly-fill', 'poly-line', 'area-fill', 'area-line']
  }
};

function setStatus(message) {
  els.status.textContent = message || '';
}

function setError(message) {
  els.error.hidden = !message;
  els.error.textContent = message || '';
}

function parseLatLonList(raw) {
  if (!raw) return [];
  return raw.split(';').map(s => s.trim()).filter(Boolean).map(pair => {
    const [latStr, lonStr] = pair.split(',');
    const lat = Number(latStr);
    const lon = Number(lonStr);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw new Error(`Coordenada invalida: ${pair}`);
    }
    return [lon, lat];
  });
}

function parseListParam(raw) {
  if (!raw) return [];
  return raw.split(';').map(s => s.trim()).filter(Boolean);
}

function parseJsonParam(raw, name) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    try {
      const normalized = raw.replace(/-/g, '+').replace(/_/g, '/');
      const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
      const decoded = decodeURIComponent(
        Array.from(atob(padded), c => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join('')
      );
      return JSON.parse(decoded);
    } catch {
      throw new Error(`JSON invalido en "${name}"`);
    }
  }
}

function parseLatLon(value, label = 'coordenada') {
  if (Array.isArray(value) && value.length >= 2) {
    const lon = Number(value[0]);
    const lat = Number(value[1]);
    if (Number.isFinite(lat) && Number.isFinite(lon)) return [lon, lat];
  }

  if (value && typeof value === 'object') {
    if (Array.isArray(value.coord)) return parseLatLon(value.coord, label);
    if (Array.isArray(value.coordinates)) return parseLatLon(value.coordinates, label);
    const lat = Number(value.lat ?? value.latitude);
    const lon = Number(value.lon ?? value.lng ?? value.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lon)) return [lon, lat];
  }

  throw new Error(`${label} invalida`);
}

function normalizeCoordList(value, name) {
  if (!value) return [];
  if (!Array.isArray(value)) throw new Error(`"${name}" debe ser una lista`);
  return value.map((item, i) => parseLatLon(item, `${name}[${i}]`));
}

function normalizeRoutes(value, name) {
  if (!value) return [];
  if (!Array.isArray(value)) throw new Error(`"${name}" debe ser una lista de rutas`);
  return value.map((item, i) => normalizeCoordList(item, `${name}[${i}]`));
}

function looksLikeRouteList(value) {
  return Array.isArray(value) && value.some(item => Array.isArray(item) && Array.isArray(item[0]));
}

function normalizeLineCoords(value, name) {
  const coords = normalizeCoordList(value, name);
  if (coords.length < 2) throw new Error(`"${name}" debe tener al menos dos coordenadas`);
  return coords;
}

function normalizeLineGeometry(geometry, name) {
  if (!geometry || typeof geometry !== 'object') throw new Error(`"${name}" debe ser una geometria GeoJSON`);
  if (geometry.type === 'LineString') {
    return { type: 'LineString', coordinates: normalizeLineCoords(geometry.coordinates, `${name}.coordinates`) };
  }
  if (geometry.type === 'MultiLineString') {
    if (!Array.isArray(geometry.coordinates)) throw new Error(`"${name}.coordinates" debe ser una lista de rutas`);
    return {
      type: 'MultiLineString',
      coordinates: geometry.coordinates.map((line, i) => normalizeLineCoords(line, `${name}.coordinates[${i}]`))
    };
  }
  throw new Error(`"${name}" debe ser LineString o MultiLineString`);
}

function normalizeRouteGeoJSON(value, name = 'routeGeoJSON') {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (value.type === 'FeatureCollection' && Array.isArray(value.features)) {
    return {
      type: 'FeatureCollection',
      features: value.features.map((feature, i) => ({
        type: 'Feature',
        properties: feature.properties || {},
        geometry: normalizeLineGeometry(feature.geometry, `${name}.features[${i}].geometry`)
      }))
    };
  }
  if (value.type === 'Feature') {
    return {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: value.properties || {},
        geometry: normalizeLineGeometry(value.geometry, `${name}.geometry`)
      }]
    };
  }
  if (value.type === 'LineString' || value.type === 'MultiLineString') {
    return {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: normalizeLineGeometry(value, name) }]
    };
  }
  throw new Error(`"${name}" debe ser FeatureCollection, Feature, LineString, MultiLineString o URL`);
}

function normalizeAreaGeometry(geometry, name) {
  if (!geometry || typeof geometry !== 'object') {
    throw new Error(`"${name}" debe ser una geometria GeoJSON`);
  }

  if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon' || geometry.type === 'LineString' || geometry.type === 'MultiLineString') {
    return geometry;
  }

  throw new Error(`"${name}" debe ser Polygon, MultiPolygon, LineString o MultiLineString`);
}

function normalizeAreaGeoJSON(value, name = 'areaGeoJSON') {
  if (!value) return null;
  if (typeof value === 'string') return value;

  if (value.type === 'FeatureCollection' && Array.isArray(value.features)) {
    return {
      type: 'FeatureCollection',
      features: value.features.map((feature, i) => ({
        type: 'Feature',
        properties: feature.properties || {},
        geometry: normalizeAreaGeometry(feature.geometry, `${name}.features[${i}].geometry`)
      }))
    };
  }

  if (value.type === 'Feature') {
    return {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: value.properties || {},
        geometry: normalizeAreaGeometry(value.geometry, `${name}.geometry`)
      }]
    };
  }

  if (value.type === 'Polygon' || value.type === 'MultiPolygon' || value.type === 'LineString' || value.type === 'MultiLineString') {
    return {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: normalizeAreaGeometry(value, name) }]
    };
  }

  throw new Error(`"${name}" debe ser FeatureCollection, Feature, Polygon, MultiPolygon, LineString, MultiLineString o URL`);
}

function markerProperties(item) {
  return {
    title: item?.title ?? '',
    label: item?.label ?? item?.text ?? item?.name ?? '',
    message: item?.message ?? item?.mensaje ?? '',
    detail: item?.detail ?? item?.details ?? item?.detalle ?? '',
    icon: item?.icon ?? '',
    html: item?.html ?? '',
    popup: item?.popup ?? '',
    description: item?.description ?? '',
    url: item?.url ?? '',
    href: item?.href ?? '',
    linkLabel: item?.linkLabel ?? item?.link_label ?? ''
  };
}

function normalizeMarkers(value, name = 'markers') {
  if (!value) return [];
  if (typeof value === 'string') return value;
  if (value.type === 'FeatureCollection' && Array.isArray(value.features)) {
    return value.features.filter(feature => feature?.geometry?.type === 'Point').map((feature, i) => ({
      coord: parseLatLon(feature.geometry.coordinates, `${name}.features[${i}]`),
      ...markerProperties(feature.properties)
    }));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return [{ coord: parseLatLon(value, name), ...markerProperties(value) }];
  }
  if (!Array.isArray(value)) throw new Error(`"${name}" debe ser una lista o un FeatureCollection de puntos`);
  return value.map((item, i) => ({ coord: parseLatLon(item, `${name}[${i}]`), ...markerProperties(item) }));
}

function markersToFeatureCollection(markers) {
  return {
    type: 'FeatureCollection',
    features: markers.map((marker, i) => ({
      type: 'Feature',
      properties: {
        index: i + 1,
        title: marker.title || '',
        label: marker.label || '',
        message: marker.message || '',
        detail: marker.detail || '',
        icon: marker.icon || '',
        html: marker.html || '',
        popup: marker.popup || '',
        description: marker.description || '',
        url: marker.url || '',
        href: marker.href || '',
        linkLabel: marker.linkLabel || ''
      },
      geometry: { type: 'Point', coordinates: marker.coord }
    }))
  };
}

function normalizeFeatureCollection(value, name) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (value.type === 'FeatureCollection' && Array.isArray(value.features)) {
    return {
      type: 'FeatureCollection',
      features: value.features.filter((feature, i) => {
        if (feature?.geometry?.type !== 'Point') return false;
        parseLatLon(feature.geometry.coordinates, `${name}.features[${i}]`);
        return true;
      })
    };
  }
  return markersToFeatureCollection(normalizeMarkers(value, name));
}

function markersFromPoints(points, labels, icons) {
  return points.map((coord, i) => ({ coord, label: labels[i] || '', icon: icons[i] || '' }));
}

function createMarkerElement(icon) {
  const el = document.createElement('div');
  el.className = 'map-marker';
  if (!icon) return el;
  if (icon === 'pin' || icon === 'pin.svg') {
    el.classList.add('with-image', 'with-svg');
    el.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" aria-hidden="true"><path fill="#c62f2a" d="M16 2C10.5 2 6 6.5 6 12c0 7.5 10 18 10 18s10-10.5 10-18C26 6.5 21.5 2 16 2z"/><circle cx="16" cy="12" r="4" fill="#fff"/></svg>';
    return el;
  }
  if (/^(https?:)?\/\//i.test(icon) || icon.startsWith('/') || icon.startsWith('data:image/') || /\.(svg|png|jpe?g|gif|webp)([?#].*)?$/i.test(icon)) {
    el.classList.add('with-image');
    const img = document.createElement('img');
    img.src = icon.startsWith('data:image/') ? icon : new URL(icon, document.baseURI).href;
    img.alt = '';
    img.onerror = () => {
      el.classList.remove('with-image');
      el.textContent = '';
    };
    el.appendChild(img);
    return el;
  }
  el.classList.add('with-text');
  el.textContent = icon;
  return el;
}

async function readOverlay(params) {
  const inline = parseJsonParam(params.get('markers'), 'markers');
  const overlayUrl = params.get('overlay');
  const overlay = {};
  if (overlayUrl) {
    const response = await fetch(overlayUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error(`No se pudo leer overlay "${overlayUrl}": ${response.status}`);
    Object.assign(overlay, await response.json());
  }
  if (inline) {
    if (overlay.markers) {
      const current = normalizeMarkers(overlay.markers, 'overlay.markers');
      if (typeof current === 'string') throw new Error('No se puede combinar "overlay.markers" por URL con "markers" inline');
      overlay.markers = [...current, ...normalizeMarkers(inline, 'markers')];
    } else {
      overlay.markers = inline;
    }
  }
  return overlay;
}

function sessionUrl(id) {
  const appPrefix = window.location.pathname.startsWith('/maps') ? '/maps' : '';
  return `${appPrefix}/api/session/${encodeURIComponent(id)}?ts=${Date.now()}`;
}

async function readSession(params) {
  const sessionId = params.get('session');
  if (!sessionId) return null;

  const response = await fetch(sessionUrl(sessionId), { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`No se pudo leer sesion "${sessionId}": ${response.status}`);
  }

  return response.json();
}

function featureCollection(features) {
  return { type: 'FeatureCollection', features };
}

function pushPointFeature(features, coordinates, properties = {}) {
  parseLatLon(coordinates, 'geojson Point');
  features.push({
    type: 'Feature',
    properties,
    geometry: { type: 'Point', coordinates }
  });
}

function pushLineFeature(features, geometry, properties = {}) {
  normalizeLineGeometry(geometry, 'geojson line');
  features.push({ type: 'Feature', properties, geometry });
}

function pushAreaFeature(features, geometry, properties = {}) {
  normalizeAreaGeometry(geometry, 'geojson area');
  features.push({ type: 'Feature', properties, geometry });
}

function collectGeoJSONFeatures(value, pointFeatures, lineFeatures, areaFeatures, inheritedProperties = {}) {
  if (!value) return;

  if (value.type === 'FeatureCollection') {
    (value.features || []).forEach(feature => collectGeoJSONFeatures(feature, pointFeatures, lineFeatures, areaFeatures));
    return;
  }

  if (value.type === 'Feature') {
    collectGeoJSONFeatures(value.geometry, pointFeatures, lineFeatures, areaFeatures, value.properties || {});
    return;
  }

  if (value.type === 'Point') {
    pushPointFeature(pointFeatures, value.coordinates, inheritedProperties);
    return;
  }

  if (value.type === 'MultiPoint') {
    (value.coordinates || []).forEach(coordinates => pushPointFeature(pointFeatures, coordinates, inheritedProperties));
    return;
  }

  if (value.type === 'LineString' || value.type === 'MultiLineString') {
    pushLineFeature(lineFeatures, value, inheritedProperties);
    return;
  }

  if (value.type === 'Polygon' || value.type === 'MultiPolygon') {
    pushAreaFeature(areaFeatures, value, inheritedProperties);
    return;
  }

  if (value.type === 'GeometryCollection') {
    (value.geometries || []).forEach(geometry => collectGeoJSONFeatures(geometry, pointFeatures, lineFeatures, areaFeatures, inheritedProperties));
  }
}

function overlayFromGeoJSON(value, options = {}) {
  if (!value) return {};

  const pointFeatures = [];
  const lineFeatures = [];
  const areaFeatures = [];
  collectGeoJSONFeatures(value, pointFeatures, lineFeatures, areaFeatures);

  const overlay = {};
  if (pointFeatures.length) overlay.markers = featureCollection(pointFeatures);
  if (lineFeatures.length) overlay.routeGeoJSON = featureCollection(lineFeatures);
  if (areaFeatures.length) overlay.areaGeoJSON = featureCollection(areaFeatures);
  if (Array.isArray(options.bounds)) overlay.bounds = options.bounds;
  if (Array.isArray(options.markersBounds)) overlay.markersBounds = options.markersBounds;
  if (Array.isArray(options.routeBounds)) overlay.routeBounds = options.routeBounds;
  if (options.markerOptions && typeof options.markerOptions === 'object') {
    overlay.markerOptions = options.markerOptions;
  } else if ('cluster' in options || 'clusterMaxZoom' in options || 'clusterRadius' in options || 'render' in options) {
    overlay.markerOptions = {
      cluster: options.cluster,
      clusterMaxZoom: options.clusterMaxZoom,
      clusterRadius: options.clusterRadius,
      render: options.render
    };
  }

  return overlay;
}

function mergeOverlay(...items) {
  const out = {};

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    Object.assign(out, item);

    if (out.markerOptions || item.markerOptions) {
      out.markerOptions = {
        ...(out.markerOptions || {}),
        ...(item.markerOptions || {})
      };
    }
  }

  return out;
}

function ensureClosedRing(coords) {
  if (!coords.length) return coords;
  const first = coords[0];
  const last = coords[coords.length - 1];
  return first[0] === last[0] && first[1] === last[1] ? coords : [...coords, first];
}

function isDisabled(value) {
  return value === '0' || value === 'false' || value === 'no';
}

function isFalseValue(value) {
  return value === false || value === 0 || isDisabled(String(value).toLowerCase());
}

function numberStyleExpression(properties, fallback) {
  if (!properties.length) return fallback;
  const [first, ...rest] = properties;
  return [
    'case',
    ['has', first],
    ['to-number', ['get', first]],
    numberStyleExpression(rest, fallback)
  ];
}

function areaFillPaint() {
  return {
    'fill-color': ['coalesce', ['get', 'fillColor'], ['get', 'fill'], ['get', 'color'], '#246db8'],
    'fill-opacity': numberStyleExpression(['fillOpacity', 'fillAlpha', 'alpha', 'opacity'], 0.18)
  };
}

function areaLinePaint() {
  return {
    'line-color': ['coalesce', ['get', 'strokeColor'], ['get', 'stroke'], ['get', 'lineColor'], ['get', 'color'], '#246db8'],
    'line-width': numberStyleExpression(['strokeWidth', 'lineWidth', 'width'], 2),
    'line-opacity': numberStyleExpression(['strokeOpacity', 'lineOpacity'], 1)
  };
}

function routeLinePaint() {
  return {
    'line-color': ['coalesce', ['get', 'strokeColor'], ['get', 'stroke'], ['get', 'lineColor'], ['get', 'color'], '#d93d36'],
    'line-width': numberStyleExpression(['strokeWidth', 'lineWidth', 'width'], 4),
    'line-opacity': numberStyleExpression(['strokeOpacity', 'lineOpacity'], 0.92)
  };
}

function polygonStyleProperties(params, overlay) {
  const polygonOptions = overlay.polygonOptions && typeof overlay.polygonOptions === 'object' ? overlay.polygonOptions : {};
  const properties = { ...polygonOptions };

  const fillColor = params.get('polygonFillColor') || params.get('polygonColor');
  const fillOpacity = params.get('polygonFillOpacity') || params.get('polygonAlpha');
  const strokeColor = params.get('polygonStrokeColor') || params.get('polygonColor');
  const strokeWidth = params.get('polygonStrokeWidth');

  if (fillColor) properties.fillColor = fillColor;
  if (fillOpacity && Number.isFinite(Number(fillOpacity))) properties.fillOpacity = Number(fillOpacity);
  if (strokeColor) properties.strokeColor = strokeColor;
  if (strokeWidth && Number.isFinite(Number(strokeWidth))) properties.strokeWidth = Number(strokeWidth);

  return properties;
}

function getPopupHtml(props) {
  return props?.popup || props?.html || props?.description || '';
}

function getPopupUrl(props) {
  return props?.url || props?.href || '';
}

function createPopupContent(props) {
  const title = props?.title || '';
  const label = props?.label || props?.text || props?.name || '';
  const message = props?.message || props?.mensaje || '';
  const detail = props?.detail || props?.details || props?.detalle || '';
  const html = getPopupHtml(props);
  const url = getPopupUrl(props);
  const linkLabel = props?.linkLabel || props?.link_label || 'Ver mensaje';
  if (!title && !label && !message && !detail && !html && !url) return null;

  const wrapper = document.createElement('div');
  wrapper.className = 'marker-popup';
  const appendText = (className, text) => {
    if (!text) return;
    const node = document.createElement('div');
    node.className = className;
    node.textContent = text;
    wrapper.appendChild(node);
  };
  appendText('marker-popup-title', title);
  appendText('marker-popup-label', label);
  appendText('marker-popup-message', message);
  appendText('marker-popup-detail', detail);
  if (html) {
    const htmlNode = document.createElement('div');
    htmlNode.className = 'marker-popup-html';
    htmlNode.innerHTML = html;
    wrapper.appendChild(htmlNode);
  } else if (url) {
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = linkLabel;
    wrapper.appendChild(link);
  }
  return wrapper;
}

function getFeatureCollectionCoords(value) {
  if (!value || typeof value === 'string' || value.type !== 'FeatureCollection') return [];
  return value.features.filter(feature => feature?.geometry?.type === 'Point').map(feature => feature.geometry.coordinates);
}

function getGeometryCoords(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Point') return [geometry.coordinates];
  if (geometry.type === 'LineString' || geometry.type === 'MultiPoint') return geometry.coordinates || [];
  if (geometry.type === 'MultiLineString' || geometry.type === 'Polygon') return (geometry.coordinates || []).flat();
  if (geometry.type === 'MultiPolygon') return (geometry.coordinates || []).flat(2);
  if (geometry.type === 'GeometryCollection') return (geometry.geometries || []).flatMap(getGeometryCoords);
  return [];
}

function getGeoJSONCoords(value) {
  if (!value || typeof value === 'string') return [];
  if (value.type === 'FeatureCollection') return value.features.flatMap(feature => getGeometryCoords(feature.geometry));
  if (value.type === 'Feature') return getGeometryCoords(value.geometry);
  return getGeometryCoords(value);
}

function addDomMarkers(map, markers) {
  for (const marker of markers) {
    const mapMarker = new maplibregl.Marker({ element: createMarkerElement(marker.icon), anchor: 'center' }).setLngLat(marker.coord);
    const popupContent = createPopupContent(marker);
    if (popupContent) mapMarker.setPopup(new maplibregl.Popup({ offset: 18 }).setDOMContent(popupContent));
    mapMarker.addTo(map);
  }
}

function addMarkerLayers(map, markerData, options = {}) {
  const cluster = options.cluster !== false;
  map.addSource('markers-src', {
    type: 'geojson',
    data: markerData,
    cluster,
    clusterMaxZoom: Number(options.clusterMaxZoom ?? 14),
    clusterRadius: Number(options.clusterRadius ?? 50)
  });

  if (cluster) {
    map.addLayer({
      id: 'marker-clusters',
      type: 'circle',
      source: 'markers-src',
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': ['step', ['get', 'point_count'], '#126c5c', 100, '#b7791f', 1000, '#c62f2a'],
        'circle-radius': ['step', ['get', 'point_count'], 17, 100, 23, 1000, 31],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2
      }
    });
    map.addLayer({
      id: 'marker-cluster-count',
      type: 'symbol',
      source: 'markers-src',
      filter: ['has', 'point_count'],
      layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Noto Sans Regular'], 'text-size': 12 },
      paint: { 'text-color': '#ffffff' }
    });
    map.on('click', 'marker-clusters', async (e) => {
      const features = map.queryRenderedFeatures(e.point, { layers: ['marker-clusters'] });
      const clusterId = features[0]?.properties?.cluster_id;
      if (clusterId === undefined) return;
      const zoom = await map.getSource('markers-src').getClusterExpansionZoom(clusterId);
      map.easeTo({ center: features[0].geometry.coordinates, zoom });
    });
    bindPointer(map, 'marker-clusters');
  }

  map.addLayer({
    id: 'markers-layer',
    type: 'circle',
    source: 'markers-src',
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 4, 12, 7, 16, 10],
      'circle-color': '#c62f2a',
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1.5
    }
  });
  map.on('click', 'markers-layer', (e) => {
    const feature = e.features?.[0];
    const popupContent = createPopupContent(feature?.properties || {});
    if (!popupContent) return;
    new maplibregl.Popup({ offset: 12 }).setLngLat(feature.geometry.coordinates).setDOMContent(popupContent).addTo(map);
  });
  bindPointer(map, 'markers-layer');
}

function bindPointer(map, layerId) {
  map.on('mouseenter', layerId, () => {
    map.getCanvas().style.cursor = 'pointer';
  });
  map.on('mouseleave', layerId, () => {
    map.getCanvas().style.cursor = '';
  });
}

function setLayerVisibility(group, visible) {
  if (!state.map) return;
  for (const layerId of state.layerGroups[group] || []) {
    if (state.map.getLayer(layerId)) {
      state.map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
    }
  }
}

function applyChromeMode(params) {
  const compact = params.get('chrome') === '0' || params.get('embed') === '1';
  els.shell.dataset.chrome = compact ? 'compact' : 'full';
}

function navigateToSource(sourceId) {
  const next = sourceId.trim() || DEFAULT_SOURCE;
  const url = new URL(window.location.href);
  url.searchParams.set('source', next);
  window.location.href = url.toString();
}

function searchUrl(sourceId) {
  const url = new URL('./search', window.location.href);
  url.searchParams.set('source', sourceId || DEFAULT_SOURCE);
  return url.toString();
}

function settingsUrl(sourceId) {
  const url = new URL('./settings', window.location.href);
  url.searchParams.set('source', sourceId || DEFAULT_SOURCE);
  return url.toString();
}

function infoUrl(sourceId) {
  const url = new URL('./info', window.location.href);
  url.searchParams.set('source', sourceId || DEFAULT_SOURCE);
  return url.toString();
}

async function loadSourceCatalog(currentSource) {
  if (!els.sourceSelect) return;

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

    els.sourceSelect.innerHTML = sources
      .map(source => `<option value="${source}">${source}</option>`)
      .join('');

    if (!sources.includes(currentSource)) {
      const option = document.createElement('option');
      option.value = currentSource;
      option.textContent = `${currentSource} (manual)`;
      els.sourceSelect.prepend(option);
    }

    els.sourceSelect.value = currentSource;
    els.sourceSelect.disabled = false;
  } catch (error) {
    console.warn(error);
    els.sourceSelect.innerHTML = `<option value="${currentSource}">${currentSource}</option>`;
    els.sourceSelect.value = currentSource;
  }
}

function copyEmbedCode() {
  const url = new URL(window.location.href);
  url.searchParams.set('embed', '1');
  const code = `<iframe src="${url.toString()}" width="100%" height="520" style="border:0" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>`;
  navigator.clipboard?.writeText(code);
  setStatus('Codigo iframe copiado al portapapeles');
}

function prepareControls(params, activeSource = DEFAULT_SOURCE) {
  const sourceId = activeSource || params.get('source') || DEFAULT_SOURCE;
  els.sourceInput.value = sourceId;
  if (els.searchRouteButton) els.searchRouteButton.href = searchUrl(sourceId);
  if (els.infoRouteButton) els.infoRouteButton.href = infoUrl(sourceId);
  if (els.settingsRouteButton) els.settingsRouteButton.href = settingsUrl(sourceId);
  loadSourceCatalog(sourceId);
  els.sourceSelect.addEventListener('change', () => navigateToSource(els.sourceSelect.value));
  els.sourceButton.addEventListener('click', () => navigateToSource(els.sourceInput.value));
  els.sourceInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') els.sourceButton.click();
  });
  els.sourcePanelButton.addEventListener('click', () => {
    els.controlPanel.hidden = false;
    els.sourcePanel.hidden = !els.sourcePanel.hidden;
    if (!els.sourcePanel.hidden) els.sourceInput.focus();
  });
  els.markersToggle.addEventListener('change', () => setLayerVisibility('markers', els.markersToggle.checked));
  els.routesToggle.addEventListener('change', () => setLayerVisibility('routes', els.routesToggle.checked));
  els.polygonsToggle.addEventListener('change', () => setLayerVisibility('polygons', els.polygonsToggle.checked));
  els.fitButton.addEventListener('click', () => {
    if (state.contentCoords.length) fitToCoords(state.map, state.contentCoords, 13);
    else if (state.sourceBounds) fitToBoundsArray(state.map, state.sourceBounds, 9);
  });
  els.panelButton.addEventListener('click', () => {
    if (els.shell.dataset.chrome === 'compact') {
      els.shell.dataset.chrome = 'full';
      els.controlPanel.hidden = false;
      return;
    }

    els.controlPanel.hidden = !els.controlPanel.hidden;
  });
  els.showPanelButton.addEventListener('click', () => {
    els.shell.dataset.chrome = 'full';
    els.controlPanel.hidden = false;
  });
  els.compactButton.addEventListener('click', () => {
    const url = new URL(window.location.href);
    url.searchParams.set('embed', '1');
    window.history.replaceState({}, '', url);
    applyChromeMode(url.searchParams);
  });
  els.copyEmbedButton.addEventListener('click', copyEmbedCode);
}

async function main() {
  try {
    if (!window.maplibregl) throw new Error('MapLibre GL JS no esta disponible');
    const params = new URLSearchParams(window.location.search);
    const session = await readSession(params);
    const sourceId = params.get('source') || session?.source || DEFAULT_SOURCE;
    prepareControls(params, sourceId);
    applyChromeMode(params);

    const overlay = mergeOverlay(
      await readOverlay(params),
      session?.overlay,
      overlayFromGeoJSON(session?.geojson, session?.options)
    );
    const sourceTilejsonUrl = tilejsonUrl(params, sourceId);
    setStatus(`Leyendo TileJSON de ${sourceId}`);

    const r = await fetch(sourceTilejsonUrl, { cache: 'no-store' });
    if (!r.ok) throw new Error(`No se pudo leer TileJSON de "${sourceId}": ${r.status}`);
    const tilejson = normalizeTilejson(await r.json());
    const bounds = tilejson.bounds || [-180, -85, 180, 85];
    const minZoom = tilejson.minzoom ?? 0;
    const maxZoom = tilejson.maxzoom ?? 14;
    if (!Array.isArray(tilejson.tiles) || !tilejson.tiles.length) {
      throw new Error(`TileJSON invalido para "${sourceId}": no contiene "tiles"`);
    }

    els.sourceSummary.textContent = `Fuente ${sourceId} · zoom ${minZoom}-${maxZoom}`;
    els.compactTitle.textContent = sourceId;
    state.sourceBounds = bounds;

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

    const points = [...parseLatLonList(params.get('points')), ...normalizeCoordList(overlay.points, 'overlay.points')];
    const polygon = [...parseLatLonList(params.get('polygon')), ...normalizeCoordList(overlay.polygon, 'overlay.polygon')];
    const overlayRouteIsList = looksLikeRouteList(overlay.route);
    const route = [...parseLatLonList(params.get('route')), ...(overlayRouteIsList ? [] : normalizeCoordList(overlay.route, 'overlay.route'))];
    const routes = [...(overlayRouteIsList ? normalizeRoutes(overlay.route, 'overlay.route') : []), ...normalizeRoutes(overlay.routes, 'overlay.routes')];
    const routeFeatures = [];

    if (route.length >= 2) {
      routeFeatures.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: route } });
    }
    routes.forEach((coords, i) => {
      if (coords.length < 2) throw new Error(`"overlay.routes[${i}]" debe tener al menos dos coordenadas`);
      routeFeatures.push({ type: 'Feature', properties: { index: i + 1 }, geometry: { type: 'LineString', coordinates: coords } });
    });

    const routeGeoJSONValue = overlay.routeGeoJSON ?? overlay.routeGeoJson;
    const routeGeoJSON = normalizeRouteGeoJSON(routeGeoJSONValue, 'overlay.routeGeoJSON');
    let routeData = null;
    if (routeGeoJSON && typeof routeGeoJSON === 'string') {
      if (routeFeatures.length) throw new Error('No se puede combinar "overlay.routeGeoJSON" por URL con "route" u "overlay.routes"');
      routeData = routeGeoJSON;
    } else {
      const features = [...routeFeatures, ...(routeGeoJSON?.features || [])];
      routeData = features.length ? { type: 'FeatureCollection', features } : null;
    }
    const areaGeoJSONValue = overlay.polygonGeoJSON ?? overlay.polygonGeoJson ?? overlay.areaGeoJSON ?? overlay.areaGeoJson;
    const areaData = normalizeAreaGeoJSON(areaGeoJSONValue, 'overlay.areaGeoJSON');
    const polygonClosed = !isDisabled((params.get('polygonClosed') ?? params.get('closed') ?? '').toLowerCase()) && !isFalseValue(overlay.polygonClosed);
    const polygonProperties = polygonStyleProperties(params, overlay);

    const labels = parseListParam(params.get('labels'));
    const icons = parseListParam(params.get('icons'));
    const pointMarkers = labels.length || icons.length ? markersFromPoints(points, labels, icons) : [];
    const markerList = [];
    let markerData = null;
    if (typeof overlay.markers === 'string') {
      if (pointMarkers.length) throw new Error('No se puede combinar "overlay.markers" por URL con "points" etiquetados');
      markerData = overlay.markers;
    } else if (overlay.markers?.type === 'FeatureCollection') {
      const overlayFeatureCollection = normalizeFeatureCollection(overlay.markers, 'overlay.markers');
      if (pointMarkers.length) {
        markerList.push(...pointMarkers);
        markerData = { ...overlayFeatureCollection, features: [...overlayFeatureCollection.features, ...markersToFeatureCollection(pointMarkers).features] };
      } else {
        markerData = overlayFeatureCollection;
      }
    } else {
      markerList.push(...pointMarkers, ...normalizeMarkers(overlay.markers, 'overlay.markers'));
      markerData = markerList.length ? markersToFeatureCollection(markerList) : null;
    }

    const markerBounds = normalizeBounds(overlay.markersBounds || overlay.bounds, 'overlay.markersBounds');
    const routeBounds = normalizeBounds(overlay.routeBounds, 'overlay.routeBounds');
    const markerOptions = overlay.markerOptions && typeof overlay.markerOptions === 'object' ? overlay.markerOptions : {};
    const markerRenderMode = markerOptions.render || (markerList.some(marker => marker.icon) ? 'dom' : 'layer');

    els.markerCount.textContent = String(markerList.length + getFeatureCollectionCoords(markerData).length + (points.length && !labels.length && !icons.length ? points.length : 0));
    els.routeCount.textContent = String(routeFeatures.length + (routeGeoJSON?.features?.length || 0));
    els.polygonCount.textContent = String((polygon.length >= 3 ? 1 : 0) + (areaData?.features?.length || 0));

    map.on('load', () => {
      fitToBoundsArray(map, bounds, 9);
      map.setMaxBounds(new maplibregl.LngLatBounds([bounds[0], bounds[1]], [bounds[2], bounds[3]]));
      const allCoords = [];

      if (points.length && !labels.length && !icons.length) {
        map.addSource('points-src', {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: points.map((coord, i) => ({ type: 'Feature', properties: { index: i + 1 }, geometry: { type: 'Point', coordinates: coord } }))
          }
        });
        map.addLayer({
          id: 'points-layer',
          type: 'circle',
          source: 'points-src',
          paint: { 'circle-radius': 6, 'circle-color': '#c62f2a', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5 }
        });
        allCoords.push(...points);
      }

      if (markerData) {
        if (markerRenderMode === 'dom' && markerList.length) addDomMarkers(map, markerList);
        else addMarkerLayers(map, markerData, markerOptions);
        allCoords.push(...markerList.map(marker => marker.coord), ...getFeatureCollectionCoords(markerData));
      }

      if (routeData) {
        map.addSource('route-src', { type: 'geojson', data: routeData });
        map.addLayer({
          id: 'route-line',
          type: 'line',
          source: 'route-src',
          paint: routeLinePaint()
        });
        map.on('click', 'route-line', (e) => {
          const feature = e.features?.[0];
          const popupContent = createPopupContent(feature?.properties || {});
          if (!popupContent) return;
          new maplibregl.Popup({ offset: 12 }).setLngLat(e.lngLat).setDOMContent(popupContent).addTo(map);
        });
        bindPointer(map, 'route-line');
        allCoords.push(...getGeoJSONCoords(routeData));
      }

      if (areaData) {
        map.addSource('area-src', { type: 'geojson', data: areaData });
        map.addLayer({
          id: 'area-fill',
          type: 'fill',
          source: 'area-src',
          paint: areaFillPaint()
        });
        map.addLayer({
          id: 'area-line',
          type: 'line',
          source: 'area-src',
          paint: areaLinePaint()
        });
        const showAreaPopup = (e) => {
          const feature = e.features?.[0];
          const popupContent = createPopupContent(feature?.properties || {});
          if (!popupContent) return;
          new maplibregl.Popup({ offset: 12 }).setLngLat(e.lngLat).setDOMContent(popupContent).addTo(map);
        };
        map.on('click', 'area-fill', showAreaPopup);
        map.on('click', 'area-line', showAreaPopup);
        bindPointer(map, 'area-fill');
        bindPointer(map, 'area-line');
        allCoords.push(...getGeoJSONCoords(areaData));
      }

      if (polygon.length >= 3) {
        const geometry = polygonClosed
          ? { type: 'Polygon', coordinates: [ensureClosedRing(polygon)] }
          : { type: 'LineString', coordinates: polygon };
        map.addSource('poly-src', {
          type: 'geojson',
          data: { type: 'Feature', geometry, properties: polygonProperties }
        });
        map.addLayer({ id: 'poly-fill', type: 'fill', source: 'poly-src', paint: areaFillPaint() });
        map.addLayer({ id: 'poly-line', type: 'line', source: 'poly-src', paint: areaLinePaint() });
        allCoords.push(...getGeometryCoords(geometry));
      }

      state.contentCoords = allCoords;
      if (allCoords.length) fitToCoords(map, allCoords, 13);
      else if (routeBounds || markerBounds) fitToBoundsArray(map, routeBounds || markerBounds, 13);
      setStatus(`Mapa listo. Fuente ${sourceId}`);
    });

    map.on('error', (e) => {
      console.error('MapLibre error:', e);
      setError(e?.error?.message || 'Error desconocido de MapLibre');
    });
  } catch (err) {
    console.error(err);
    setError(err.message || String(err));
    setStatus('No se pudo cargar el mapa');
  }
}

main();
