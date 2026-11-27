import test from 'node:test';
import assert from 'node:assert/strict';
import { createOverpassClient } from '../src/overpass.mjs';

test('remembers the healthy endpoint and skips a failed endpoint on subsequent queries', async () => {
  const calls = [];
  const client = createOverpassClient({ now: () => 1000, mirrors: async () => [], fetchResponse: async url => {
    calls.push(url.hostname);
    return url.hostname === 'maps.mail.ru' ? new Response(null, { status: 503 }) : Response.json({ elements: [] });
  } });
  await client('out;');
  await client('out;');
  assert.deepEqual(calls, ['maps.mail.ru', 'overpass-api.de', 'overpass-api.de']);
});

test('an outage fails promptly during cooldown, then permits a recovery attempt', async () => {
  let calls = 0, time = 1000;
  const client = createOverpassClient({ now: () => time, mirrors: async () => [], fetchResponse: async () => {
    calls++;
    return new Response(null, { status: 503 });
  } });
  await assert.rejects(client('out;'), { code: 'PLACE_SOURCE_UNAVAILABLE' });
  assert.equal(calls, 3);
  await assert.rejects(client('out;'), { code: 'PLACE_SOURCE_UNAVAILABLE' });
  assert.equal(calls, 3);
  time += 61000;
  await assert.rejects(client('out;'), { code: 'PLACE_SOURCE_UNAVAILABLE' });
  assert.equal(calls, 6);
});

test('cancelling a query stops fallback without marking the provider as failed', async () => {
  const controller = new AbortController(), calls = [];
  const client = createOverpassClient({ mirrors: async () => [], fetchResponse: async url => {
    calls.push(url.hostname);
    if (calls.length === 1) { controller.abort(); throw controller.signal.reason; }
    return Response.json({ elements: [] });
  } });
  await assert.rejects(client('out;', { signal: controller.signal }), { name: 'AbortError' });
  await client('out;');
  assert.deepEqual(calls, ['maps.mail.ru', 'maps.mail.ru']);
});

test('a replica timeout is not accepted as an empty result and falls back to a global endpoint', async () => {
  const calls = [];
  const extent = { minlat: 48, minlon: 2, maxlat: 49, maxlon: 3 };
  const client = createOverpassClient({ mirrors: async value => {
    assert.deepEqual(value, extent);
    return ['https://ovp.dresel.systems/api/interpreter'];
  }, fetchResponse: async url => {
    calls.push(url.hostname);
    return Response.json(url.hostname === 'ovp.dresel.systems' ? { elements: [], remark: 'timeout' } : { elements: [{ type: 'node', id: 1 }] });
  } });
  assert.equal((await client('out;', { extent })).length, 1);
  assert.deepEqual(calls, ['ovp.dresel.systems', 'maps.mail.ru']);
});

test('a replica without the requested generated city area cannot masquerade as an empty city', async () => {
  const calls = [];
  const client = createOverpassClient({ mirrors: async () => ['https://ovp.dresel.systems/api/interpreter'], fetchResponse: async url => {
    calls.push(url.hostname);
    return Response.json({ elements: url.hostname === 'ovp.dresel.systems' ? [] : [{ type: 'area', id: 1 }] });
  } });
  const result = await client('out;', { accept: elements => elements.some(element => element.type === 'area') });
  assert.equal(result.length, 1);
  assert.deepEqual(calls, ['ovp.dresel.systems', 'maps.mail.ru']);
});
