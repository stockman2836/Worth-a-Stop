import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename, resolve } from 'node:path';
import { once } from 'node:events';

function output(child, stream, pattern) {
  return new Promise((resolve, reject) => {
    let diagnostics = '', output = '';
    if (child.stderr) child.stderr.on('data', bytes => { diagnostics = (diagnostics + String(bytes)).slice(-1500); });
    const timer = setTimeout(() => reject(Error('Process did not become ready: ' + diagnostics)), 10000);
    child.once('exit', code => { clearTimeout(timer); reject(Error('Process exited before readiness (' + code + '): ' + diagnostics)); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child[stream].on('data', bytes => {
      output = (output + String(bytes)).slice(-3000);
      const match = output.match(pattern);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
}

export async function browserHarness(t) {
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
        if (!waiter) return;
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
          const response = await fetch(message.params.request.url, { signal: AbortSignal.timeout(4000) });
          await call('Fetch.fulfillRequest', { requestId: message.params.requestId, responseCode: response.status,
            responseHeaders: [{ name: 'Content-Type', value: response.headers.get('Content-Type') || 'application/octet-stream' }],
            body: Buffer.from(await response.arrayBuffer()).toString('base64') });
        }).catch(async error => {
          failures.push({ asset: message.params.request.url, error: error.message });
          await call('Fetch.failRequest', { requestId: message.params.requestId, errorReason: 'Failed' }).catch(() => {});
        });
      }
    });
    const call = (method, params = {}) => new Promise((resolve, reject) => {
      const requestId = ++id;
      const timer = setTimeout(() => { pending.delete(requestId); reject(Error('CDP request timed out: ' + method + ' ' + JSON.stringify(failures))); }, method === 'Runtime.evaluate' ? 22000 : 10000);
      timer.unref();
      pending.set(requestId, { resolve, reject, timer }); socket.send(JSON.stringify({ id: requestId, method, params }));
    });
    await call('Page.enable'); await call('Runtime.enable'); await call('Network.enable');
    await call('Fetch.enable', { patterns: [{ urlPattern: address + '*', requestStage: 'Request' }] });
    await call('Network.setBlockedURLs', { urls: ['https://*'] });
    await call('Page.navigate', { url: address + '/' });
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const state = await call('Runtime.evaluate', { returnByValue: true,
        expression: `location.origin === ${JSON.stringify(address)} && !!document.querySelector('[data-language][aria-pressed]')` });
      if (state.result?.value) { ready = true; break; }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert(ready, 'Application modules must finish loading before testing the map: ' + JSON.stringify({ errors, failures }));
    return { call, errors, async evaluate(expression) {
      const response = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      assert.equal(response.exceptionDetails, undefined, JSON.stringify(response.exceptionDetails));
      return response.result.value;
    } };
}
