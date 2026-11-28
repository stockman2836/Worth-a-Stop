import * as L from './leaflet.mjs';
import { localizedMapStyle } from './map-style.mjs';
import { nameTranslationRequest } from './name-translation.mjs';
import { translateNames, translationAvailability } from './name-translations.mjs';
import { diagnostic } from './diagnostics.mjs';

const styles = new Map();
const attribution = '<a href="https://openfreemap.org/">OpenFreeMap</a> · <a href="https://openmaptiles.org/">© OpenMapTiles</a> · <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>';

export function basemap(map, language, labels, message) {
  const container = map.getContainer(), root = document.documentElement;
  delete container.dataset.basemap; delete container.dataset.mapLanguage; delete container.dataset.mapTheme;
  delete container.dataset.mapFailure;
  const pane = map.createPane('localized-basemap'); pane.style.zIndex = '200'; pane.style.pointerEvents = 'none';
  let layer, controller, generation = 0, destroyed = false, timer;
  const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'retry-localized-map'; retry.hidden = true;
  retry.textContent = language === 'ru' ? 'Повторить загрузку локализованной карты' : 'Retry localized map';
  message.after(retry);
  retry.addEventListener('click', () => update());
  const translationController = new AbortController(), translatedNames = new Map(), attempted = new Map();
  const translationNote = document.createElement('p'); translationNote.className = 'map-status'; translationNote.hidden = true;
  const machineTranslation = labels.machineTranslation || (language === 'ru' ? 'Часть названий переведена автоматически · MyMemory. Возможны неточности.' : 'Some names are machine translated · MyMemory. Names may be inaccurate.');
  translationNote.textContent = machineTranslation;
  message.after(translationNote);
  let translationTimer, translating = false, lastLabels;
  function scheduleTranslations() {
    if (!destroyed && !translationTimer) translationTimer = setTimeout(localizeVisibleNames, 500);
  }
  async function localizeVisibleNames() {
    translationTimer = undefined;
    const vector = layer?.getMaplibreMap?.();
    if (destroyed || translating || !vector?.isStyleLoaded()) return;
    const nameLayers = vector.getStyle().layers.filter(item => item.type === 'symbol' &&
      JSON.stringify(item.layout?.['text-field'])?.includes('translatedNames')).map(item => item.id);
    if (!nameLayers.length) return;
    const requests = new Map(), features = vector.queryRenderedFeatures({ layers: nameLayers });
    const samples = [...new Map(features.filter(feature => feature.properties?.name).map(feature => [feature.properties.name, feature.properties])).values()];
    const summary = { language, visibleNames: samples.length, publishedTranslation: samples.filter(p => p['name:' + language]).length,
      englishAvailable: samples.filter(p => p['name:en']).length, sample: samples.slice(0, 3).map(p => ({ local: p.name, ru: p['name:ru'], en: p['name:en'], latin: p['name:latin'] })) };
    const signature = JSON.stringify(summary);
    if (signature !== lastLabels) { lastLabels = signature; diagnostic('map', 'labels', summary); }
    const priority = feature => feature.sourceLayer === 'poi' ? 0 : feature.sourceLayer === 'place' ? 1 : 2;
    for (const feature of features.sort((a, b) => priority(a) - priority(b))) {
      const item = nameTranslationRequest(feature.properties, language);
      // Readable street labels already have a Latin fallback. Reserve the small
      // translation quota for visitor places and unreadable labels first.
      if (feature.sourceLayer === 'transportation_name' && item &&
          !/[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u.test(item.text)) continue;
      if (item && !translatedNames.has(item.text) && (attempted.get(item.text) || 0) < Date.now() - 60000) requests.set(item.text, item);
    }
    const batch = [...requests.values()].slice(0, 4);
    if (!batch.length) return;
    translationNote.hidden = false;
    translationNote.textContent = language === 'ru'
      ? `Переводим недостающие подписи карты… В очереди: ${requests.size}.`
      : `Translating missing map labels… Queued: ${requests.size}.`;
    for (const item of batch) attempted.set(item.text, Date.now());
    while (attempted.size > 2000) attempted.delete(attempted.keys().next().value);
    translating = true;
    try {
      const entries = await translateNames(batch, language, { signal: translationController.signal });
      if (destroyed) return;
      for (const entry of entries) translatedNames.set(entry.text, entry.translation);
      while (translatedNames.size > 1000) translatedNames.delete(translatedNames.keys().next().value);
      if (entries.length && layer?.getMaplibreMap?.() === vector) {
        vector.setGlobalStateProperty('translatedNames', Object.fromEntries(translatedNames));
        translationNote.textContent = machineTranslation;
        translationNote.hidden = false; scheduleTranslations();
      }
      if (translationAvailability().state === 'paused') {
        translationNote.hidden = false;
        translationNote.textContent = language === 'ru'
          ? 'Перевод названий временно недоступен. Показаны доступные названия из источника.'
          : 'Name translation is temporarily unavailable. Showing available source names.';
      }
    } finally { translating = false; }
  }
  map.on('moveend', scheduleTranslations);
  const observer = new MutationObserver(() => update());
  observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  function removeLayer() {
    clearTimeout(timer);
    if (layer) { map.removeLayer(layer); layer = undefined; }
  }
  function fallback(reason = 'initial-render-timeout', detail) {
    if (destroyed) return;
    generation++; controller?.abort();
    removeLayer();
    container.dataset.basemap = 'fallback'; container.dataset.mapLanguage = 'local';
    container.dataset.mapFailure = reason; retry.hidden = false;
    diagnostic('map', 'fallback', { language, reason, detail, theme: root.dataset.theme });
    container.dataset.mapTheme = root.dataset.theme === 'dark' ? 'dark' : 'light';
    translationNote.hidden = true;
    message.textContent = labels.mapFallback;
    message.textContent += language === 'ru' ? ' Перевод подписей на этой подложке невозможен.' : 'Labels on this basemap cannot be translated.';
    if (reason === 'webgl2-unavailable') message.textContent += language === 'ru' ? ' Браузер не предоставил WebGL2; проверьте аппаратное ускорение.' : 'WebGL2 is unavailable; check browser graphics acceleration.';
    layer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    layer.on('tileerror', () => { message.textContent = labels.mapFallback + ' ' + labels.tilesError; });
  }
  async function update() {
    const current = ++generation, theme = root.dataset.theme === 'dark' ? 'dark' : 'light';
    controller?.abort(); clearTimeout(timer); controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]);
    const active = () => !destroyed && generation === current;
    message.textContent = labels.mapLoading;
    retry.hidden = true;
    diagnostic('map', 'loading', { language, theme, revision: 'localization-2', centre: { latitude: map.getCenter().lat, longitude: map.getCenter().lng } });
    try {
      const [{ maplibreGL }, gl] = await Promise.all([import('./leaflet-maplibre-gl.mjs'), import('./maplibre-gl.mjs')]);
      if (!active()) return;
      gl.setWorkerUrl('/maplibre-gl-worker.mjs');
      if (!layer?.getMaplibreMap) {
        const canvas = document.createElement('canvas'), context = canvas.getContext('webgl2');
        if (!context) throw Object.assign(Error('WebGL2 unavailable'), { code: 'webgl2-unavailable' });
        context.getExtension('WEBGL_lose_context')?.loseContext();
      }
      let style = styles.get(theme);
      if (!style) {
        const response = await fetch(`https://tiles.openfreemap.org/styles/${theme === 'dark' ? 'dark' : 'positron'}`, { signal });
        if (!response.ok) throw Object.assign(Error('Map style HTTP ' + response.status), { code: 'style-unavailable' });
        style = await response.json(); localizedMapStyle(style, language);
        styles.set(theme, style);
      }
      if (!active()) return;
      const localized = localizedMapStyle(style, language);
      let vector;
      if (layer?.getMaplibreMap) {
        vector = layer.getMaplibreMap(); vector.setStyle(localized, { diff: false });
      } else {
        removeLayer();
        layer = maplibreGL({ style: localized, pane: 'localized-basemap', interactive: false,
          attributionControl: { customAttribution: attribution } });
        layer.addTo(map); vector = layer.getMaplibreMap();
        vector.on('idle', scheduleTranslations);
        const failures = new Set();
        vector.on('error', event => {
          if (destroyed || layer?.getMaplibreMap?.() !== vector) return;
          message.textContent = labels.tilesError;
          const detail = String(event.error?.message || 'Map resource failed').slice(0, 300);
          if (failures.size < 5 && !failures.has(detail)) { failures.add(detail); diagnostic('map', 'resource-failed', { language, detail }); }
        });
      }
      const ready = () => {
        if (!active()) return;
        clearTimeout(timer); message.textContent = '';
        container.dataset.basemap = 'vector'; container.dataset.mapLanguage = language; container.dataset.mapTheme = theme;
        delete container.dataset.mapFailure; retry.hidden = true;
        diagnostic('map', 'ready', { language, theme, mode: 'vector', localizedLayers: localized.layers.filter(item =>
          JSON.stringify(item.layout?.['text-field'])?.includes('translatedNames')).length });
        if (translatedNames.size) vector.setGlobalStateProperty('translatedNames', Object.fromEntries(translatedNames));
        scheduleTranslations();
      };
      const loaded = () => { if (!active()) return; vector.off('load', loaded); vector.off('idle', loaded); ready(); };
      vector.once('load', loaded); vector.once('idle', loaded);
      timer = setTimeout(() => { if (active()) fallback(); }, 20000);
    } catch (error) { if (active()) fallback(error.code || 'initialization-failed', error.message); }
  }
  update();
  return { destroy() {
    if (destroyed) return;
    destroyed = true; generation++; controller?.abort(); translationController.abort(); clearTimeout(translationTimer);
    diagnostic('map', 'destroyed', { language });
    map.off('moveend', scheduleTranslations); retry.remove(); translationNote.remove(); observer.disconnect(); removeLayer();
  } };
}
