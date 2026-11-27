import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('place API separates city identities and local searches, validates scope and reports missing boundaries', async t => {
  const script = `
    globalThis.fetch = async (url, options) => {
      if (url.hostname === 'geocoding-api.open-meteo.com') return Response.json({id:42,name:'Missing city',feature_code:'PPL'});
      const query = url.searchParams.get('data') ?? new URLSearchParams(options.body).get('data');
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
    cwd: new URL('../', import.meta.url), env: { ...process.env, PORT: '0' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
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
  const city = await (await request({ scope: 'city', id: 42, name: 'Town' })).json();
  assert.equal(city.boundary.url, 'https://www.openstreetmap.org/relation/10');
  assert.ok(city.places[0].km > 6);
  const other = await (await request({ scope: 'city', id: 43, name: 'Other town' })).json();
  assert.equal(other.boundary.url, 'https://www.openstreetmap.org/relation/11');
  assert.equal(other.places[0].name, 'Other landmark');
  const nearby = await (await request({ scope: 'nearby' })).json();
  assert.ok(Array.isArray(nearby) && nearby[0].km < 2);
  assert.equal((await request({ scope: 'city', id: 42, name: 'Missing city' })).status, 422);
  for (const params of [{ scope: 'city' }, { scope: 'world' }, { radius: 6 }, { scope: 'city', id: -1, name: 'Town' }]) {
    assert.equal((await request(params)).status, 400);
  }
});
