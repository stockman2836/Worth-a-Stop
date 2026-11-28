import test from 'node:test';
import assert from 'node:assert/strict';
import { browserHarness } from '../test-support/browser.mjs';

test('visible map labels and cards translate without blocking rendering or changing source names',
  { skip: !process.env.CHROME_BIN, timeout: 30000 }, async t => {
    const { evaluate, errors } = await browserHarness(t);
    const result = await evaluate(`(async () => {
      const L = await import('/leaflet.mjs');
      const { basemap } = await import('/basemap.mjs');
      const { placeList } = await import('/place-list.mjs');
      const { watchNameTranslations } = await import('/name-translations.mjs');
      localStorage.removeItem('worth-a-stop.name-translations.v1');
      const nativeFetch = window.fetch, requests = [];
      window.fetch = async (input, options) => {
        if (String(input).startsWith('https://tiles.openfreemap.org/styles/')) return Response.json({ version: 8,
          sources: { local: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } },
          layers: [{ id: 'background', type: 'background' }, { id: 'icons', type: 'symbol', source: 'local', layout: { 'icon-image': 'marker' } },
            { id: 'names', type: 'symbol', source: 'local', layout: { 'text-field': ['get', 'name'] } }] });
        if (String(input) === '/api/name-translations') {
          const body = JSON.parse(options.body); requests.push(body);
          return Response.json({ translations: body.items.map(item => ({ ...item,
            translation: item.text === 'Dubai Design District' ? 'Район дизайна в Дубае' : 'Музей без перевода' })) });
        }
        return nativeFetch(input, options);
      };
      const box = document.createElement('div'); box.style.cssText = 'width:600px;height:250px';
      const message = document.createElement('p'); document.body.replaceChildren(box, message);
      const map = L.map(box).setView([25.1972,55.2744], 13);
      const background = basemap(map, 'ru', { mapLoading: 'Loading', mapFallback: 'Fallback' }, message);
      const wait = async predicate => {
        for (let i = 0; i < 160; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 25)); }
        throw Error('Translation did not settle');
      };
      await wait(() => box.dataset.basemap === 'vector');
      let vector; map.eachLayer(layer => { if (layer.getMaplibreMap) vector = layer.getMaplibreMap(); });
      vector.queryRenderedFeatures = () => [{ properties: { name: 'حي دبي للتصميم', 'name:en': 'Dubai Design District' } }];
      map.fire('moveend');
      await wait(() => vector.getGlobalState().translatedNames?.['Dubai Design District']);
      const translated = vector.getGlobalState().translatedNames['Dubai Design District'];
      const controller = new AbortController();
      const place = { name: 'متحف', names: { en: 'Untranslated Museum' }, category: 'museum', km: 1,
        prominence: 'highlight', url: 'https://www.openstreetmap.org/node/1' };
      const before = JSON.stringify(place);
      const list = placeList('ru', { placeSelection: 'Места', source: 'Источник', museum: 'Музей',
        pageRange: () => '', highlights: 'Главное', allPlaces: 'Все', previous: 'Назад', next: 'Далее' },
        () => ({ button: () => document.createElement('button') }), () => {}, 0, false, controller.signal);
      watchNameTranslations(() => list.refreshNames(), controller.signal);
      document.body.append(list.element); list.update([place], [], false);
      await wait(() => list.element.querySelector('.show-place')?.textContent === 'Музей без перевода');
      const card = list.element.querySelector('.show-place'), title = card.title;
      const saved = localStorage.getItem('worth-a-stop.name-translations.v1');
      controller.abort(); background.destroy(); map.remove(); window.fetch = nativeFetch;
      return { translated, title, unchanged: before === JSON.stringify(place), requests: requests.length,
        cached: saved.includes('Музей без перевода') && saved.includes('Район дизайна в Дубае') };
    })()`);
    assert.equal(result.translated, 'Район дизайна в Дубае');
    assert.match(result.title, /Машинный перевод/);
    assert.equal(result.unchanged, true);
    assert.equal(result.requests, 2);
    assert.equal(result.cached, true);
    assert.deepEqual(errors, []);
  });
