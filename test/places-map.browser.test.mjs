import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename, resolve } from 'node:path';
import { once } from 'node:events';

function output(child, stream, pattern) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Process did not become ready')), 10000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child[stream].on('data', bytes => {
      const match = String(bytes).match(pattern);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
}

test('wheel zoom survives place updates and pending zoom is cancelled when the map is destroyed',
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
    const browser = spawn(process.env.CHROME_BIN, ['--headless=new', '--disable-gpu', '--no-first-run',
      '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'],
    { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    children.push(browser);
    const browserSocket = new URL(await output(browser, 'stderr', /DevTools listening on (ws:\/\/\S+)/));
    const targets = await (await fetch(`http://127.0.0.1:${browserSocket.port}/json/list`)).json();
    socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
    await once(socket, 'open');
    let id = 0;
    const pending = new Map(), errors = [];
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const waiter = pending.get(message.id); pending.delete(message.id);
        if (message.error) waiter.reject(message.error); else waiter.resolve(message.result);
      }
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    });
    const call = (method, params = {}) => new Promise((resolve, reject) => {
      pending.set(++id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params }));
    });
    await call('Page.enable'); await call('Runtime.enable'); await call('Network.enable');
    await call('Network.setBlockedURLs', { urls: ['https://*'] });
    await call('Page.navigate', { url: address });
    await new Promise(resolve => setTimeout(resolve, 300));
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
      box.remove(); return { zoomChanged };
    })()` });
    assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
    assert.equal(result.result.value.zoomChanged, true, 'Wheel zoom must remain functional during a place update');
    assert.deepEqual(errors, [], 'A removed map must never receive a delayed wheel callback');
  });
