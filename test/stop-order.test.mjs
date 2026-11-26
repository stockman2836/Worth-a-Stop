import test from 'node:test';
import assert from 'node:assert/strict';
import { compareStopOrder } from '../src/stop-order.mjs';
import { itineraryStop, itineraryStore } from '../src/itinerary.mjs';

const start = Date.parse('2026-11-28T08:00Z');
const place = (id, hours, duration) => ({ ...itineraryStop({ name: id, hours,
  url: 'https://www.openstreetmap.org/node/' + id, latitude: 50, longitude: 14 + Number(id) / 100 }, 'place'), duration });
const park = place('1', '24/7', 90);
const museum = place('2', '09:00-11:00', 60);
const concert = itineraryStop({ title: 'Concert', url: 'https://events.example/concert',
  start: Date.parse('2026-11-28T12:00Z'), end: Date.parse('2026-11-28T13:00Z'),
  location: { latitude: 50, longitude: 14.03 } }, 'event');
const stops = [park, museum, concert];
const legs = [{ from: park, to: museum, status: 'ok', duration: 600 }, { from: museum, to: concert, status: 'ok', duration: 600 }];
const fetchResponse = async () => Response.json({ status: 'ok', duration: 600, distance: 700 });

test('an adjacent swap resolves a closing conflict and keeps the event at its original position and time', async () => {
  const result = await compareStopOrder(stops, park.id, legs, start, 'Europe/Prague', { fetchResponse });
  assert.equal(result.before.conflicts, 1);
  assert.equal(result.after.conflicts, 0);
  assert.equal(result.applicable, true);
  assert.deepEqual(result.after.visits.map(visit => visit.stop.id), [museum.id, park.id, concert.id]);
  assert.equal(result.after.visits[2].stop.start, concert.start);
  assert.equal(result.after.walkingMinutes, 20);
});
test('unknown hours and a slower route causing lateness disable applying the proposal', async () => {
  const unknown = await compareStopOrder([park, { ...museum, hours: null }, concert], park.id, legs, start, 'Europe/Prague', { fetchResponse });
  assert.equal(unknown.applicable, false);
  const slow = await compareStopOrder(stops, park.id, legs, start, 'Europe/Prague', {
    fetchResponse: async () => Response.json({ status: 'ok', duration: 7200, distance: 9000 }),
  });
  assert.equal(slow.applicable, false);
  assert.ok(slow.after.visits[2].late > 0);
});
test('a missing route, cancelled request and non-place pair cannot produce an applicable proposal', async () => {
  assert.equal((await compareStopOrder(stops, museum.id, legs, start, 'Europe/Prague', { fetchResponse })).reason, 'pair');
  const missing = await compareStopOrder(stops, park.id, legs, start, 'Europe/Prague', {
    fetchResponse: async () => new Response(null, { status: 503 }),
  });
  assert.equal(missing.reason, 'route');
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(compareStopOrder(stops, park.id, legs, start, 'Europe/Prague', { signal: controller.signal, fetchResponse }), { name: 'AbortError' });
});
test('applying a checked pair preserves visit durations and rejects an outdated saved plan', () => {
  const values = new Map();
  const store = itineraryStore(90, { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) });
  const day = '2026-11-28';
  for (const stop of stops) store.add(day, stop);
  store.duration(day, park.id, park.duration);
  store.duration(day, museum.id, museum.duration);
  const expected = store.read(day).stops;
  const result = store.swapAdjacent(day, park.id, expected);
  assert.equal(result.stops[0].duration, museum.duration);
  assert.equal(result.stops[1].duration, park.duration);
  assert.equal(result.stops[2].start, concert.start);
  assert.throws(() => store.swapAdjacent(day, park.id, expected), /Plan changed/);
  assert.throws(() => store.swapAdjacent(day, park.id, result.stops), /Invalid pair/);
});
