import test from 'node:test';
import assert from 'node:assert/strict';
import { createWalkingRouter } from '../src/walking-router.mjs';
import { walkingLegs } from '../src/walking-legs.mjs';
import { itineraryStop, itineraryStore } from '../src/itinerary.mjs';

const from = { latitude: 50, longitude: 14 };
const to = { latitude: 50.01, longitude: 14.01 };
const route = { distance: 1200, duration: 900, geometry: { type: 'LineString', coordinates: [[14, 50], [14.01, 50.01]] } };
test('requests the foot profile and shares concurrent and cached routes in the same direction', async () => {
  let calls = 0;
  const router = createWalkingRouter(async url => {
    calls++;
    assert.ok(url.pathname.includes('/routed-foot/route/v1/foot/14,50;14.01,50.01'));
    return Response.json({ code: 'Ok', routes: [route] });
  });
  const [a, b] = await Promise.all([router(from, to), router(from, to)]);
  assert.deepEqual(a, { status: 'ok', ...route });
  assert.deepEqual(a, b);
  await router(from, to);
  assert.equal(calls, 1);
});
test('distinguishes an absent walking path from a broken provider response', async () => {
  const absent = createWalkingRouter(async () => Response.json({ code: 'NoRoute' }, { status: 400 }));
  assert.equal((await absent(from, to)).status, 'no-route');
  const broken = createWalkingRouter(async () => Response.json({ code: 'Ok', routes: [{ ...route, geometry: null }] }));
  await assert.rejects(broken(from, to));
  await assert.rejects(broken({ latitude: 99, longitude: 1 }, to));
});
test('missing coordinates never connect across an unknown stop and failures allow subsequent legs', async () => {
  const stops = [{ id: 'a', location: from }, { id: 'b' }, { id: 'c', location: to }, { id: 'd', location: from }];
  let calls = 0;
  const legs = await walkingLegs(stops, { fetchResponse: async () => { calls++; return Response.json({ status: 'ok', ...route }); } });
  assert.deepEqual(legs.map(leg => leg.status), ['missing-location', 'missing-location', 'ok']);
  assert.equal(calls, 1);
  let attempts = 0;
  const partial = await walkingLegs([stops[0], stops[2], stops[3]], { fetchResponse: async () => {
    attempts++;
    return attempts === 1 ? new Response(null, { status: 503 }) : Response.json({ status: 'ok', ...route });
  } });
  assert.deepEqual(partial.map(leg => leg.status), ['unavailable', 'ok']);
  const controller = new AbortController();
  await assert.rejects(walkingLegs([stops[0], stops[2]], { signal: controller.signal, fetchResponse: async () => {
    controller.abort();
    return Response.json({ status: 'ok', ...route });
  } }), { name: 'AbortError' });
});
test('adding an old stop again restores coordinates and preserves its duration and order', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const store = itineraryStore(50, storage);
  const item = { name: 'Museum', url: 'https://www.openstreetmap.org/node/1' };
  const old = itineraryStop(item, 'place');
  store.add('2026-11-28', old);
  store.duration('2026-11-28', old.id, 80);
  const result = store.add('2026-11-28', itineraryStop({ ...item, ...from }, 'place'));
  assert.equal(result.stops.length, 1);
  assert.equal(result.stops[0].duration, 80);
  assert.deepEqual(result.stops[0].location, from);
});
