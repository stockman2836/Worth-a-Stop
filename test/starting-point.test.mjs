import test from 'node:test';
import assert from 'node:assert/strict';
import { startingPointStore, withStartingPoint } from '../src/starting-point.mjs';
import { arrivalTimes } from '../src/arrival-times.mjs';
import { compareStopOrder } from '../src/stop-order.mjs';
import { findAlternatives } from '../src/alternatives.mjs';

const point = { latitude: 50.088, longitude: 14.42 };
const museum = { id: 'museum', type: 'place', title: 'Museum', names: {}, duration: 60, hours: '24/7',
  location: { latitude: 50.09, longitude: 14.43 } };
const park = { ...museum, id: 'park', title: 'Park' };

test('a stored starting point is isolated by city and day and can be reset', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const store = startingPointStore(1, storage);
  assert.equal(store.read('2026-11-28').point, null);
  store.set('2026-11-28', point);
  assert.deepEqual(startingPointStore(1, storage).read('2026-11-28').point, point);
  assert.equal(store.read('2026-11-29').point, null);
  assert.equal(startingPointStore(2, storage).read('2026-11-28').point, null);
  assert.equal(store.set('2026-11-28', null).point, null);
  assert.throws(() => store.set('2026-11-28', { latitude: 91, longitude: 1 }));
});

test('failed writes preserve the chosen point and reset in the current tab', () => {
  const store = startingPointStore(3, { getItem: () => JSON.stringify(point), setItem() { throw Error('quota'); } });
  const other = { latitude: 49, longitude: 15 };
  assert.equal(store.set('2026-11-28', other).saved, false);
  assert.deepEqual(store.read('2026-11-28').point, other);
  store.set('2026-11-28', null);
  assert.equal(store.read('2026-11-28').point, null);
});

test('incoming walking time shifts the first arrival without adding visit time at the origin', () => {
  const stops = withStartingPoint([museum], point, 'Starting point');
  const start = Date.parse('2026-11-28T09:00Z');
  const legs = [{ from: stops[0], to: museum, status: 'ok', duration: 149.6 }];
  const times = arrivalTimes(stops, legs, start);
  assert.equal(times[0].departure, start);
  assert.equal(times[1].arrival, start + 180000);
  assert.equal(times[1].departure, start + 3780000);
  assert.equal(arrivalTimes(stops, [], start)[1].arrival, null);
  assert.equal(arrivalTimes([museum], [], start)[0].arrival, start);
});

test('a comparison keeps the chosen origin and calculates its new leg to the swapped first stop', async () => {
  const stops = withStartingPoint([museum, park], point, 'Starting point');
  const legs = [{ from: stops[0], to: museum, status: 'ok', duration: 600 }, { from: museum, to: park, status: 'ok', duration: 600 }];
  const result = await compareStopOrder(stops, museum.id, legs, Date.parse('2026-11-28T09:00Z'), 'Europe/Prague', {
    fetchResponse: async () => Response.json({ status: 'ok', duration: 1200, distance: 1400 }),
  });
  assert.equal(result.applicable, true);
  assert.equal(result.after.visits[0].stop.id, stops[0].id);
  assert.equal(result.after.visits[1].stop.id, park.id);
  assert.equal(result.after.visits[1].arrival, Date.parse('2026-11-28T09:20Z'));
});

test('a replacement for the first place includes walking from the selected origin', async () => {
  const stops = withStartingPoint([museum], point, 'Starting point');
  const legs = [{ from: stops[0], to: museum, status: 'ok', duration: 600 }];
  const start = Date.parse('2026-11-28T09:00Z');
  const result = await findAlternatives(stops, museum.id, legs, start, 'Europe/Prague', {
    fetchResponse: async url => {
      if (String(url).startsWith('/api/places?')) return Response.json([{
        name: 'Gallery', names: {}, url: 'https://www.openstreetmap.org/node/3',
        latitude: 50.09, longitude: 14.44, km: .2, hours: '24/7',
      }]);
      const params = new URL(url, 'https://local.example').searchParams;
      assert.equal(Number(params.get('fromLon')), point.longitude);
      return Response.json({ status: 'ok', duration: 1200, distance: 1400 });
    },
  });
  assert.equal(result.alternatives[0].arrival, start + 1200000);
});
