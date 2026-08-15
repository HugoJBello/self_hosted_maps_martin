import { DEFAULT_SOURCE } from './map-shared.js';

const els = {
  viewerRouteButton: document.getElementById('viewerRouteButton'),
  searchRouteButton: document.getElementById('searchRouteButton'),
  infoRouteButton: document.getElementById('infoRouteButton'),
  sourceSelect: document.getElementById('sourceSelect'),
  profileSelect: document.getElementById('profileSelect'),
  forceToggle: document.getElementById('forceToggle'),
  indexButton: document.getElementById('indexButton'),
  settingsAlert: document.getElementById('settingsAlert'),
  progressBar: document.getElementById('progressBar'),
  statSource: document.getElementById('statSource'),
  statProfile: document.getElementById('statProfile'),
  statIndexed: document.getElementById('statIndexed'),
  statTiles: document.getElementById('statTiles'),
  statBuiltAt: document.getElementById('statBuiltAt'),
  profileStatusList: document.getElementById('profileStatusList'),
  profileDetails: document.getElementById('profileDetails')
};

const state = {
  settings: null,
  pollTimer: null,
  lastStatus: null
};

function appPrefix() {
  return window.location.pathname.startsWith('/maps') ? '/maps' : '';
}

function apiUrl(path) {
  return `${appPrefix()}${path}`;
}

function selectedSource() {
  return els.sourceSelect.value || DEFAULT_SOURCE;
}

function selectedProfile() {
  return els.profileSelect.value || state.settings?.defaultProfile || 'streets';
}

function setAlert(kind, message) {
  els.settingsAlert.className = `settings-alert ${kind ? `is-${kind}` : ''}`;
  els.settingsAlert.textContent = message || '';
}

function setProgress(value) {
  els.progressBar.style.width = `${Math.max(0, Math.min(100, Number(value) || 0))}%`;
}

function routeUrl(pathname, includeProfile = false) {
  const url = new URL(pathname, window.location.href);
  url.searchParams.set('source', selectedSource());
  if (includeProfile) url.searchParams.set('profile', selectedProfile());
  return url.toString();
}

function updateNavLinks() {
  els.viewerRouteButton.href = routeUrl('./');
  els.searchRouteButton.href = routeUrl('./search');
  els.infoRouteButton.href = routeUrl('./info');
}

function formatDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

function renderStats(payload) {
  const index = payload?.index || payload?.latestIndex;
  const job = payload?.job;
  const selectedLabel = profileLabel(payload?.profile || selectedProfile());
  const latestLabel = profileLabel(payload?.latestIndex?.profile);
  els.statSource.textContent = payload?.source || selectedSource();
  els.statProfile.textContent = payload?.latestIndex
    ? `${selectedLabel} · ultimo indice: ${latestLabel}`
    : selectedLabel;
  els.statIndexed.textContent = String(job?.indexed ?? index?.indexed ?? 0);
  els.statTiles.textContent = String(job?.scannedTiles ?? index?.scannedTiles ?? 0);
  els.statBuiltAt.textContent = formatDate(index?.builtAt || job?.finishedAt);
  setProgress(job?.progress ?? (index ? 100 : 0));
  renderProfileStatusList(payload);
}

function profileLabel(profileId) {
  const profile = state.settings?.profiles?.find(item => item.id === profileId);
  return profile?.label || profileId || '-';
}

function renderProfileStatusList(payload) {
  els.profileStatusList.innerHTML = '';
  const profiles = Array.isArray(payload?.profiles) ? payload.profiles : [];
  for (const item of profiles) {
    const row = document.createElement('div');
    row.className = 'profile-status-row';

    const name = document.createElement('span');
    name.textContent = item.label || profileLabel(item.profile);

    const stateText = document.createElement('strong');
    if (item.job?.status === 'running' || item.job?.status === 'queued') {
      stateText.textContent = `${item.job.progress || 0}%`;
    } else if (item.index) {
      stateText.textContent = `${item.index.indexed} elem · ${item.index.scannedTiles} tiles`;
    } else if (item.job?.status === 'error') {
      stateText.textContent = 'error';
    } else {
      stateText.textContent = 'sin indice';
    }

    row.append(name, stateText);
    els.profileStatusList.appendChild(row);
  }
}

function renderProfileDetails() {
  const profile = state.settings?.profiles?.find(item => item.id === selectedProfile());
  if (!profile) {
    els.profileDetails.textContent = '';
    return;
  }

  els.profileDetails.innerHTML = '';
  const description = document.createElement('p');
  description.textContent = profile.description;
  const meta = document.createElement('div');
  meta.className = 'profile-meta';
  meta.textContent = `${profile.maxTiles} tiles maximos · ${profile.layers.length} pasos`;
  const list = document.createElement('ol');
  list.className = 'profile-layer-list';
  for (const layer of profile.layers) {
    const item = document.createElement('li');
    item.textContent = `${layer.layer} · z${layer.zoom} · ${layer.maxTiles} tiles${layer.aroundPlaces ? ' · cerca de poblaciones' : ''}`;
    list.appendChild(item);
  }
  els.profileDetails.append(description, meta, list);
}

async function readStatus() {
  const url = new URL(apiUrl('/api/search/index'), window.location.origin);
  url.searchParams.set('source', selectedSource());
  url.searchParams.set('profile', selectedProfile());
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    const error = new Error(`Estado no disponible: ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

function isTransientStatusError(error) {
  return error?.status === 502 || error?.status === 503 || error?.status === 504;
}

async function refreshStatus() {
  const payload = await readStatus();
  state.lastStatus = payload;
  renderStats(payload);

  if (payload.job?.status === 'running' || payload.job?.status === 'queued') {
    setAlert('info', `${payload.job.message}. ${payload.job.progress || 0}%`);
    schedulePoll();
    return;
  }

  if (payload.job?.status === 'error') {
    setAlert('error', payload.job.error || 'No se pudo indexar el mapa.');
    return;
  }

  if (payload.index) {
    setAlert('success', `Indice listo: ${payload.index.indexed} elementos indexados.`);
  } else if (payload.latestIndex) {
    setAlert('success', `Hay indice listo en ${profileLabel(payload.latestIndex.profile)}: ${payload.latestIndex.indexed} elementos. La busqueda lo reutilizara aunque cambies la precision aqui.`);
  } else {
    setAlert('info', 'Este mapa aun no tiene ningun indice en memoria.');
  }
}

function schedulePoll() {
  window.clearTimeout(state.pollTimer);
  state.pollTimer = window.setTimeout(() => {
    refreshStatus().catch(error => {
      if (isTransientStatusError(error)) {
        setAlert('info', `${error.message}. Reintentando sin detener el seguimiento.`);
        schedulePoll();
        return;
      }
      setAlert('error', error.message || String(error));
    });
  }, 1200);
}

async function startIndex() {
  els.indexButton.disabled = true;
  setAlert('info', 'Lanzando indexado...');
  setProgress(0);

  try {
    const response = await fetch(apiUrl('/api/search/index'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        source: selectedSource(),
        profile: selectedProfile(),
        force: els.forceToggle.checked
      })
    });
    if (!response.ok) {
      const error = new Error(`No se pudo iniciar: ${response.status}`);
      error.status = response.status;
      throw error;
    }
    const payload = await response.json();
    renderStats(payload);
    setAlert('info', payload.job ? 'Indexado iniciado.' : 'El indice ya estaba listo.');
    schedulePoll();
  } catch (error) {
    if (isTransientStatusError(error)) {
      setAlert('info', `${error.message}. Consultando estado por si el indexado ya arranco.`);
      schedulePoll();
      return;
    }
    setAlert('error', error.message || String(error));
  } finally {
    els.indexButton.disabled = false;
  }
}

function populateControls() {
  const params = new URLSearchParams(window.location.search);
  const requestedSource = params.get('source') || DEFAULT_SOURCE;
  els.sourceSelect.innerHTML = '';
  for (const source of state.settings.sources) {
    const option = document.createElement('option');
    option.value = source;
    option.textContent = source;
    els.sourceSelect.appendChild(option);
  }
  if (!state.settings.sources.includes(requestedSource)) {
    const option = document.createElement('option');
    option.value = requestedSource;
    option.textContent = `${requestedSource} (manual)`;
    els.sourceSelect.prepend(option);
  }
  els.sourceSelect.value = requestedSource;

  els.profileSelect.innerHTML = '';
  for (const profile of state.settings.profiles) {
    const option = document.createElement('option');
    option.value = profile.id;
    option.textContent = profile.label;
    els.profileSelect.appendChild(option);
  }
  els.profileSelect.value = state.settings.defaultProfile;
  updateNavLinks();
  renderProfileDetails();
}

function wireEvents() {
  els.sourceSelect.addEventListener('change', () => {
    updateNavLinks();
    refreshStatus().catch(error => setAlert('error', error.message || String(error)));
  });
  els.profileSelect.addEventListener('change', () => {
    renderProfileDetails();
    refreshStatus().catch(error => setAlert('error', error.message || String(error)));
  });
  els.indexButton.addEventListener('click', startIndex);
}

async function main() {
  try {
    const response = await fetch(apiUrl('/api/search/settings'), { cache: 'no-store' });
    if (!response.ok) throw new Error(`Configuracion no disponible: ${response.status}`);
    state.settings = await response.json();
    populateControls();
    wireEvents();
    await refreshStatus();
  } catch (error) {
    setAlert('error', error.message || String(error));
  }
}

main();
