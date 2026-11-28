import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('place API separates city identities and local searches, validates scope and reports missing boundaries', async t => {
  const script = `
    let starts = 0, cancellations = 0;
    globalThis.fetch = async (url, options) => {
      if (url.hostname === 'api.mymemory.translated.net') return Response.json({ responseStatus: 200, responseData: { translatedText: 'Translated name' } });
      if (url.hostname === 'geocoding-api.open-meteo.com') return Response.json({id:42,name:'Missing city',feature_code:'PPL'});
      const query = url.searchParams.get('data') ?? new URLSearchParams(options.body).get('data');
      if (query.includes('around:1000')) return Response.json({elements:[{type:'node',id:501,lat:50,lon:14.001,tags:{name:'Cafe',amenity:'cafe',opening_hours:'24/7'}}]});
      if (query.includes('is_in(52,14)')) return new Promise((resolve, reject) => {
        console.log('SOURCE_STARTED', ++starts);
        options.signal.addEventListener('abort', () => { console.log('SOURCE_CANCELLED', ++cancellations); reject(options.signal.reason); }, { once: true });
      });
      if (query.includes('is_in(51,14)')) return new Response(null, {status:503});
      let elements;
      if (query.includes('is_in')) {
        elements = [{type:'relation',id:10,tags:{name:'Town',boundary:'administrative',admin_level:'8'}},
          {type:'relation',id:11,tags:{name:'Other town',boundary:'administrative',admin_level:'8'}}];
      } else {
        const city = query.includes('map_to_area');
        const other = query.includes('rel(11)');
        elements = [...(city ? [{type:'area',id:other?3600000011:3600000010}] : []),
          {type:'node',id:1,lat:50,lon:city?14.4:14.001,tags:{name:other?'Other landmark':'Landmark',tourism:'attraction'}}];
      }
      return Response.json({elements});
    };
    await import('./bin/site.mjs');
  `;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: new URL('../', import.meta.url), env: { ...process.env, PORT: process.env.BROWSER_TEST_PORT || '0', PLACE_CACHE_DIR: 'off' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const notices = [];
  child.stdout.on('data', bytes => notices.push(String(bytes)));
  t.after(async () => { child.kill(); if (child.exitCode === null && child.signalCode === null) await once(child, 'exit'); });
  const address = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Server did not start')), 5000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.stdout.on('data', bytes => {
      const match = String(bytes).match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    });
  });
  const request = params => fetch(address + '/api/places?' + new URLSearchParams({ lat: 50, lon: 14, ...params }));
  const meals = await (await fetch(address + '/api/meal-venues?lat=50&lon=14')).json();
  assert.equal(meals.venues[0].name, 'Cafe');
  assert.equal((await fetch(address + '/api/meal-venues?lat=95&lon=14')).status, 400);
  const translate = body => fetch(address + '/api/name-translations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const item = { source: 'en', text: 'Landmark' };
  assert.deepEqual((await (await translate({ target: 'ru', items: [item] })).json()).translations, [{ ...item, translation: 'Translated name' }]);
  for (const body of [{ target: 'unknown', items: [item] }, { target: 'ru', items: Array(5).fill(item) },
    { target: 'ru', items: [{ source: 'ar', text: 'Place' }] }, { target: 'ru', items: [{ source: 'en', text: 'x'.repeat(5000) }] }]) {
    assert.equal((await translate(body)).status, 400);
  }
  const city = await (await request({ scope: 'city', id: 42, name: 'Town' })).json();
  assert.equal(city.boundary.url, 'https://www.openstreetmap.org/relation/10');
  assert.ok(city.places[0].km > 6);
  const translated = await (await request({ scope: 'city', id: 42, name: 'Город' })).json();
  assert.deepEqual(translated.places, city.places);
  assert.deepEqual(translated.boundary, city.boundary);
  const other = await (await request({ scope: 'city', id: 43, name: 'Other town' })).json();
  assert.equal(other.boundary.url, 'https://www.openstreetmap.org/relation/11');
  assert.equal(other.places[0].name, 'Other landmark');
  const nearby = await (await request({ scope: 'nearby' })).json();
  assert.ok(Array.isArray(nearby) && nearby[0].km < 2);
  const unsupported = await request({ scope: 'city', id: 44, name: 'Missing city' });
  assert.equal(unsupported.status, 200);
  assert.equal((await unsupported.json()).status, 'unsupported');
  for (const params of [{ scope: 'city' }, { scope: 'world' }, { radius: 6 }, { scope: 'city', id: -1, name: 'Town' }]) {
    assert.equal((await request(params)).status, 400);
  }
  async function notice(text) {
    for (let i = 0; i < 100; i++) {
      if (notices.join('').includes(text)) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.fail('Missing server notice: ' + text);
  }
  for (let i = 1; i <= 6; i++) {
    const controller = new AbortController();
    const pending = fetch(address + '/api/places?' + new URLSearchParams({ lat: 52, lon: 14, scope: 'city', id: 100 + i, name: 'Town' }), { signal: controller.signal });
    await notice('SOURCE_STARTED ' + i);
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    await notice('SOURCE_CANCELLED ' + i);
  }
  const nextCity = await request({ lat: 53, scope: 'city', id: 999, name: 'Town' });
  assert.equal(nextCity.status, 200);
  assert.equal((await nextCity.json()).places.length, 1);
  const outage = await request({ lat: 51, scope: 'city', id: 99, name: 'Town' });
  assert.equal(outage.status, 200);
  assert(Number(outage.headers.get('retry-after')) > 0);
  const failure = await outage.json();
  assert.equal(failure.status, 'unavailable');
  assert.equal(failure.code, 'PLACE_SOURCE_UNAVAILABLE');
  assert.equal(failure.places, undefined);
});
