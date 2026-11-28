import * as L from './leaflet.mjs';
import { localizedMapStyle } from './map-style.mjs';
import { nameTranslationRequest } from './name-translation.mjs';
import { translateNames } from './name-translations.mjs';

const styles = new Map();
const attribution = '<a href="https://openfreemap.org/">OpenFreeMap</a> · <a href="https://openmaptiles.org/">© OpenMapTiles</a> · <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>';

export function basemap(map, language, labels, message) {
  const container = map.getContainer(), root = document.documentElement;
  delete container.dataset.basemap; delete container.dataset.mapLanguage; delete container.dataset.mapTheme;
  const pane = map.createPane('localized-basemap'); pane.style.zIndex = '200'; pane.style.pointerEvents = 'none';
  let layer, controller, generation = 0, destroyed = false, timer;
  const translationController = new AbortController(), translatedNames = new Map(), attempted = new Map();
  const translationNote = document.createElement('p'); translationNote.className = 'map-status'; translationNote.hidden = true;
  translationNote.textContent = labels.machineTranslation || (language === 'ru' ? 'Часть названий переведена автоматически · MyMemory. Возможны неточности.' : 'Some names are machine translated · MyMemory. Names may be inaccurate.');
  message.after(translationNote);
  let translationTimer, translating = false;
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
    const requests = new Map();
    for (const feature of vector.queryRenderedFeatures({ layers: nameLayers })) {
      const item = nameTranslationRequest(feature.properties, language);
      if (item && !translatedNames.has(item.text) && (attempted.get(item.text) || 0) < Date.now() - 60000) requests.set(item.text, item);
    }
    const batch = [...requests.values()].slice(0, 4);
    if (!batch.length) return;
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
        translationNote.hidden = false; scheduleTranslations();
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
  function fallback() {
    if (destroyed) return;
    generation++; controller?.abort();
    removeLayer();
    container.dataset.basemap = 'fallback'; container.dataset.mapLanguage = 'local';
    container.dataset.mapTheme = root.dataset.theme === 'dark' ? 'dark' : 'light';
    translationNote.hidden = true;
    message.textContent = labels.mapFallback;
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
    try {
      const [{ maplibreGL }, gl] = await Promise.all([import('./leaflet-maplibre-gl.mjs'), import('./maplibre-gl.mjs')]);
      if (!active()) return;
      gl.setWorkerUrl('/maplibre-gl-worker.mjs');
      if (!layer?.getMaplibreMap) {
        const canvas = document.createElement('canvas'), context = canvas.getContext('webgl2');
        if (!context) throw Error('WebGL2 unavailable');
        context.getExtension('WEBGL_lose_context')?.loseContext();
      }
      let style = styles.get(theme);
      if (!style) {
        const response = await fetch(`https://tiles.openfreemap.org/styles/${theme === 'dark' ? 'dark' : 'positron'}`, { signal });
        if (!response.ok) throw Error('Map style unavailable');
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
        vector.on('error', () => { if (!destroyed && layer?.getMaplibreMap?.() === vector) message.textContent = labels.tilesError; });
      }
      const ready = () => {
        if (!active()) return;
        clearTimeout(timer); message.textContent = '';
        container.dataset.basemap = 'vector'; container.dataset.mapLanguage = language; container.dataset.mapTheme = theme;
        if (translatedNames.size) vector.setGlobalStateProperty('translatedNames', Object.fromEntries(translatedNames));
        scheduleTranslations();
      };
      vector.once('idle', ready);
      timer = setTimeout(() => { if (active()) fallback(); }, 12000);
    } catch { if (active()) fallback(); }
  }
  update();
  return { destroy() {
    if (destroyed) return;
    destroyed = true; generation++; controller?.abort(); translationController.abort(); clearTimeout(translationTimer);
    map.off('moveend', scheduleTranslations); translationNote.remove(); observer.disconnect(); removeLayer();
  } };
}
