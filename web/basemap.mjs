import * as L from './leaflet.mjs';
import { localizedMapStyle } from './map-style.mjs';

const styles = new Map();
const attribution = '<a href="https://openfreemap.org/">OpenFreeMap</a> · <a href="https://openmaptiles.org/">© OpenMapTiles</a> · <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>';

export function basemap(map, language, labels, message) {
  const container = map.getContainer(), root = document.documentElement;
  delete container.dataset.basemap; delete container.dataset.mapLanguage; delete container.dataset.mapTheme;
  const pane = map.createPane('localized-basemap'); pane.style.zIndex = '200'; pane.style.pointerEvents = 'none';
  let layer, controller, generation = 0, destroyed = false, timer;
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
        vector.on('error', () => { if (!destroyed && layer?.getMaplibreMap?.() === vector) message.textContent = labels.tilesError; });
      }
      const ready = () => {
        if (!active()) return;
        clearTimeout(timer); message.textContent = '';
        container.dataset.basemap = 'vector'; container.dataset.mapLanguage = language; container.dataset.mapTheme = theme;
      };
      vector.once('idle', ready);
      timer = setTimeout(() => { if (active()) fallback(); }, 12000);
    } catch { if (active()) fallback(); }
  }
  update();
  return { destroy() {
    if (destroyed) return;
    destroyed = true; generation++; controller?.abort(); observer.disconnect(); removeLayer();
  } };
}
