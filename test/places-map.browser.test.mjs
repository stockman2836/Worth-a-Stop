import test from 'node:test';
import assert from 'node:assert/strict';
import { browserHarness } from '../test-support/browser.mjs';

test('map lifecycle preserves wheel zoom, localized vector styles, theme, attribution and camera',
  { skip: !process.env.CHROME_BIN, timeout: 30000 }, async t => {
    const { call, errors } = await browserHarness(t);
    const result = await call('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `(async () => {
      const { placesMap } = await import('/places-map.mjs');
      const L = await import('/leaflet.mjs');
      const initialize = L.Map.prototype.initialize;
      L.Map.prototype.initialize = function(...args) { initialize.apply(this, args); window.currentMap = this; };
      const city = { latitude: 44.50218, longitude: 34.16624 };
      const place = { ...city, name: 'Landmark', names: {}, category: 'museum', prominence: 'highlight', url: 'https://www.openstreetmap.org/node/1' };
      const labels = { name: place => place.name, zoomIn: '+', zoomOut: '-', unknown: 'Unknown', hours: 'Hours' };
      const box = document.createElement('div'); box.style.cssText = 'width:800px;height:600px'; document.body.append(box);
      const wheel = () => { const bounds = box.getBoundingClientRect(); box.dispatchEvent(new WheelEvent('wheel', {
        deltaY: -120, clientX: bounds.x + 200, clientY: bounds.y + 200, bubbles: true, cancelable: true })); };
      let zoomChanged = false;
      for (let i = 0; i < 8; i++) {
        const map = placesMap(box, city, [place], labels, () => {});
        currentMap.setZoom(10, { animate: false });
        const zoom = currentMap.getZoom(); wheel();
        map.setPlaces([place, { ...place, name: 'Second', latitude: city.latitude + .01 }]);
        await new Promise(resolve => setTimeout(resolve, 80));
        zoomChanged ||= currentMap.getZoom() > zoom;
        wheel(); map.destroy(); map.destroy();
        // Reuse the same container, as switching languages does in the workspace.
        const replacement = placesMap(box, city, [place], labels, () => {});
        await new Promise(resolve => setTimeout(resolve, 80)); replacement.destroy();
      }
      // Real MapLibre rendering with an empty local source avoids dependence on
      // external tiles while exercising theme changes, workers and cleanup.
      const wait = async predicate => {
        for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 25)); }
        throw Error('Vector map did not settle: ' + box.dataset.basemap + ' ' + box.nextElementSibling?.textContent);
      };
      const fallback = placesMap(box, city, [place], { ...labels, language: 'ru', mapFallback: 'Standard map uses local names' }, () => {});
      await wait(() => box.dataset.basemap === 'fallback');
      const honestFallback = box.dataset.mapLanguage === 'local' && box.nextElementSibling.textContent.includes('local names');
      fallback.destroy();
      const nativeFetch = window.fetch;
      window.fetch = async (input, options) => {
        if (!String(input).startsWith('https://tiles.openfreemap.org/styles/')) return nativeFetch(input, options);
        const dark = String(input).endsWith('/dark');
        return Response.json({ version: 8, glyphs: location.origin + '/glyphs/{fontstack}/{range}.pbf',
          sources: { local: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } }, layers: [
            { id: 'background', type: 'background', paint: { 'background-color': dark ? '#102019' : '#f7f9f3' } },
            { id: 'names', type: 'symbol', source: 'local', layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'] } },
          ] });
      };
      document.documentElement.dataset.theme = 'light';
      const localized = placesMap(box, city, [place], { ...labels, language: 'ru', mapLoading: 'Loading', mapFallback: 'Fallback' }, () => {});
      await wait(() => box.dataset.basemap === 'vector' && box.dataset.mapLanguage === 'ru');
      const leaflet = currentMap; leaflet.setView([44.51, 34.24], 12, { animate: false });
      let vector; leaflet.eachLayer(layer => { if (layer.getMaplibreMap) vector = layer.getMaplibreMap(); });
      const ruExpression = JSON.stringify(vector.getLayoutProperty('names', 'text-field'));
      document.documentElement.dataset.theme = 'dark';
      await wait(() => box.dataset.mapTheme === 'dark');
      const sameMap = currentMap === leaflet && vector.getPaintProperty('background', 'background-color') === '#102019';
      const view = localized.view(); localized.destroy();
      delete box.dataset.basemap; delete box.dataset.mapLanguage;
      const english = placesMap(box, city, [place], { ...labels, language: 'en' }, () => {}, view);
      await wait(() => box.dataset.basemap === 'vector' && box.dataset.mapLanguage === 'en');
      let enVector; currentMap.eachLayer(layer => { if (layer.getMaplibreMap) enVector = layer.getMaplibreMap(); });
      const enExpression = JSON.stringify(enVector.getLayoutProperty('names', 'text-field'));
      const attributionPresent = Boolean(box.querySelector('.leaflet-control-attribution a[href="https://openfreemap.org/"]'));
      const nextView = english.view();
      // Leaflet rounds the pixel origin on a new instance. Stay within one
      // screen pixel rather than requiring identical floating-point latitudes.
      const preservedView = nextView.zoom === view.zoom && currentMap.project([view.latitude, view.longitude], view.zoom)
        .distanceTo(currentMap.project([nextView.latitude, nextView.longitude], nextView.zoom)) < 1;
      english.destroy(); window.fetch = nativeFetch;
      box.remove(); return { zoomChanged, sameMap, honestFallback, attributionPresent, preservedView, view, nextView, ruExpression, enExpression };
    })()` });
    assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
    assert.equal(result.result.value.zoomChanged, true, 'Wheel zoom must remain functional during a place update');
    assert.equal(result.result.value.sameMap, true, 'Theme changes must update the vector style without replacing Leaflet');
    assert.equal(result.result.value.honestFallback, true, 'Fallback maps must identify local-language labels');
    assert.equal(result.result.value.attributionPresent, true, 'Vector maps must retain provider attribution');
    assert.equal(result.result.value.preservedView, true, 'Language changes must preserve the view: ' + JSON.stringify({ before: result.result.value.view, after: result.result.value.nextView }));
    assert(result.result.value.ruExpression.includes('name:ru'));
    assert(result.result.value.enExpression.includes('name:en'));
    assert.deepEqual(errors, [], 'A removed map must never receive a delayed wheel callback');
  });
