import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename, resolve } from 'node:path';
import { once } from 'node:events';

function output(child, stream, pattern) {
  return new Promise((resolve, reject) => {
    let diagnostics = '';
    if (child.stderr) child.stderr.on('data', bytes => { diagnostics = (diagnostics + String(bytes)).slice(-1500); });
    const timer = setTimeout(() => reject(Error('Process did not become ready: ' + diagnostics)), 10000);
    child.once('exit', code => { clearTimeout(timer); reject(Error('Process exited before readiness (' + code + '): ' + diagnostics)); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child[stream].on('data', bytes => {
      const match = String(bytes).match(pattern);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
}

test('map lifecycle preserves wheel zoom, localized vector styles, theme, attribution and camera',
  { skip: !process.env.CHROME_BIN, timeout: 30000 }, async t => {
    const profile = await mkdtemp(join(tmpdir(), 'worth-map-browser-'));
    const children = [];
    let socket;
    t.after(async () => {
      socket?.close();
      await Promise.all(children.map(async child => {
        if (child.exitCode !== null || child.signalCode !== null) return;
        const stopped = once(child, 'exit'); child.kill(); await stopped;
      }));
      if (dirname(resolve(profile)) === resolve(tmpdir()) && basename(profile).startsWith('worth-map-browser-')) {
        await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
    });
    const server = spawn(process.execPath, ['bin/site.mjs'], { cwd: new URL('../', import.meta.url),
      env: { ...process.env, PORT: '0', PLACE_CACHE_DIR: 'off' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(server);
    const address = await output(server, 'stdout', /(http:\/\/127\.0\.0\.1:\d+)/);
    const browser = spawn(process.env.CHROME_BIN, ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox', '--no-first-run',
      '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'],
    { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    children.push(browser);
    const browserSocket = new URL(await output(browser, 'stderr', /DevTools listening on (ws:\/\/\S+)/));
    const targets = await (await fetch(`http://127.0.0.1:${browserSocket.port}/json/list`)).json();
    socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
    await once(socket, 'open');
    let id = 0;
    const pending = new Map(), errors = [], failures = [], requests = new Map();
    let assets = Promise.resolve();
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const waiter = pending.get(message.id); pending.delete(message.id);
        clearTimeout(waiter.timer);
        if (message.error) waiter.reject(message.error); else waiter.resolve(message.result);
      }
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
      if (message.method === 'Network.requestWillBeSent') requests.set(message.params.requestId, message.params.request.url);
      if (message.method === 'Network.loadingFailed') failures.push({ ...message.params, url: requests.get(message.params.requestId) });
      if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) failures.push(message.params.response);
      if (message.method === 'Fetch.requestPaused') {
        // Use the actual server response, but avoid headless Chrome's local
        // network permission policy blocking random loopback module requests.
        assets = assets.then(async () => {
          const response = await fetch(message.params.request.url);
          await call('Fetch.fulfillRequest', { requestId: message.params.requestId, responseCode: response.status,
            responseHeaders: [{ name: 'Content-Type', value: response.headers.get('Content-Type') || 'application/octet-stream' }],
            body: Buffer.from(await response.arrayBuffer()).toString('base64') });
        }).catch(error => failures.push({ asset: message.params.request.url, error: error.message }));
      }
    });
    const call = (method, params = {}) => new Promise((resolve, reject) => {
      const requestId = ++id;
      const timer = setTimeout(() => { pending.delete(requestId); reject(Error('CDP request timed out: ' + method)); }, method === 'Runtime.evaluate' ? 22000 : 10000);
      timer.unref();
      pending.set(requestId, { resolve, reject, timer }); socket.send(JSON.stringify({ id: requestId, method, params }));
    });
    await call('Page.enable'); await call('Runtime.enable'); await call('Network.enable');
    await call('Fetch.enable', { patterns: [{ urlPattern: address + '/*', requestStage: 'Request' }] });
    await call('Network.setBlockedURLs', { urls: ['https://*'] });
    await call('Page.navigate', { url: address });
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const state = await call('Runtime.evaluate', { returnByValue: true,
        expression: `location.origin === ${JSON.stringify(address)} && !!document.querySelector('[data-language][aria-pressed]')` });
      if (state.result?.value) { ready = true; break; }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert(ready, 'Application modules must finish loading before testing the map: ' + JSON.stringify({ errors, failures }));
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
