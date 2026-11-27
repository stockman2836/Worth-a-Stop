import test from 'node:test';
import assert from 'node:assert/strict';
import { findAlternatives } from '../src/alternatives.mjs';
import { itineraryStop, itineraryStore } from '../src/itinerary.mjs';

const start = Date.parse('2026-11-28T09:00Z');
const location = longitude => ({ latitude: 50, longitude });
const makePlace = (id, longitude, hours = '09:00-18:00') => ({
  name: id, names: {}, url: 'https://www.openstreetmap.org/node/' + id,
  latitude: 50, longitude, km: .1, hours,
});
const first = { ...itineraryStop(makePlace('1', 14), 'place'), duration: 60 };
const target = { ...itineraryStop(makePlace('2', 14.01), 'place'), duration: 60 };
const event = itineraryStop({ title: 'Concert', url: 'https://events.example/concert', start: start + 3 * 3600000,
  end: start + 4 * 3600000, location: location(14.02) }, 'event');
const stops = [first, target, event];
const legs = [{ from: first, to: target, status: 'ok', duration: 600 }, { from: target, to: event, status: 'ok', duration: 600 }];

test('checks actual walking-adjusted visit times and preserves the next fixed event', async () => {
  const result = await findAlternatives(stops, target.id, legs, start, 'Europe/Prague', { fetchResponse: async url => {
    if (String(url).startsWith('/api/places?')) { assert.equal(new URL(url, 'https://app.example').searchParams.get('radius'), '2'); return Response.json([
      makePlace('3', 15), makePlace('4', 16), makePlace('5', 17, '11:00-12:15'),
      makePlace('6', 18, null), makePlace('2', 14.01),
    ]); }
    const p = new URL(url, 'https://local.example').searchParams;
    const incoming = Number(p.get('toLon'));
    const duration = incoming === 16 ? 6000 : incoming === 17 ? 1800 : 1200;
    return Response.json({ status: 'ok', distance: 1000, duration, geometry: { type: 'LineString', coordinates: [[14, 50], [15, 50]] } });
  } });
  assert.deepEqual(result.alternatives.map(item => item.stop.title), ['3']);
  assert.equal(result.alternatives[0].arrival, start + 80 * 60000);
  assert.equal(result.alternatives[0].stop.duration, target.duration);
});

test('requires arrival and visit duration before requesting alternatives', async () => {
  const noFetch = async () => { throw Error('Unexpected request'); };
  assert.equal((await findAlternatives(stops, target.id, [], undefined, 'Europe/Prague', { fetchResponse: noFetch })).reason, 'arrival');
  assert.equal((await findAlternatives([{ ...target, duration: null }], target.id, [], start, 'Europe/Prague', { fetchResponse: noFetch })).reason, 'duration');
});

test('failed or cancelled walking checks cannot produce a replacement', async () => {
  const source = () => Response.json([makePlace('3', 15)]);
  const result = await findAlternatives(stops, target.id, legs, start, 'Europe/Prague', {
    fetchResponse: async url => String(url).startsWith('/api/places?') ? source() : new Response(null, { status: 503 }),
  });
  assert.equal(result.incomplete, true);
  assert.equal(result.alternatives.length, 0);
  const controller = new AbortController();
  await assert.rejects(findAlternatives(stops, target.id, legs, start, 'Europe/Prague', {
    signal: controller.signal,
    fetchResponse: async url => {
      if (String(url).startsWith('/api/places?')) return source();
      controller.abort();
      return Response.json({ status: 'ok', distance: 10, duration: 10 });
    },
  }), { name: 'AbortError' });
});

test('replaces one place without moving or changing the fixed event, and rejects stale choices', () => {
  const values = new Map();
  const store = itineraryStore(80, { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) });
  const day = '2026-11-28';
  for (const stop of stops) store.add(day, stop);
  store.duration(day, target.id, 60);
  const expected = store.read(day).stops;
  const replacement = itineraryStop(makePlace('3', 15), 'place');
  const result = store.replace(day, target.id, replacement, expected);
  assert.equal(result.stops[1].id, replacement.id);
  assert.equal(result.stops[1].duration, 60);
  assert.equal(result.stops[2].start, event.start);
  assert.throws(() => store.replace(day, target.id, replacement, expected), /Plan changed/);
  assert.throws(() => store.replace(day, event.id, target, result.stops), /Invalid replacement/);
});
