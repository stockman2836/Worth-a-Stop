import test from 'node:test';
import assert from 'node:assert/strict';
import { generateDayPlan } from '../src/auto-plan.mjs';
import { loadPlanCandidates } from '../src/plan-candidates.mjs';
import { itineraryStop, itineraryStore } from '../src/itinerary.mjs';
import { arrivalTimes } from '../src/arrival-times.mjs';
import { withStartingPoint } from '../src/starting-point.mjs';
import { visitOpeningState } from '../src/opening-hours.mjs';

const day = '2026-11-27';
const input = { day, startTime: '09:00', endTime: '14:00', timeZone: 'Europe/Budapest' };
const place = (id, hours = '24/7', category = 'viewpoint') => ({ name: 'Place ' + id, names: {},
  url: 'https://www.openstreetmap.org/node/' + id, latitude: 47.5, longitude: 19 + id / 1000, km: .1, hours, category });
const event = (id, start, end) => ({ title: 'Event ' + id, url: 'https://events.example/' + id,
  start: Date.parse(day + 'T' + start + '+01:00'), end: end ? Date.parse(day + 'T' + end + '+01:00') : null,
  location: { latitude: 47.5, longitude: 19.01 } });
const route = async url => {
  const p = new URL(url, 'https://app.example').searchParams;
  return Response.json({ status: 'ok', duration: 600, distance: 700,
    geometry: { type: 'LineString', coordinates: [[+p.get('fromLon'), +p.get('fromLat')], [+p.get('toLon'), +p.get('toLat')]] } });
};

test('generates a verifiable plan with real walking legs, visit hours and a finish within the window', async () => {
  const origin = { latitude: 47.49, longitude: 19 };
  const result = await generateDayPlan({ ...input, origin, places: [place(1), place(2, '09:00-12:00', 'museum'), place(3)] }, { fetchResponse: route });
  assert.ok(result.stops.length >= 2);
  assert.ok(result.finish <= result.end);
  assert.equal(result.legs.length, result.stops.length);
  const times = arrivalTimes(withStartingPoint(result.stops, origin, 'Start'), result.legs, result.start).slice(1);
  assert.deepEqual(times, result.entries.map(({ arrival, visitStart, departure, waiting, late, reason }) => ({ arrival, visitStart, departure, waiting, late, reason })));
  for (const entry of result.entries) assert.equal(visitOpeningState(entry.stop.hours, entry.arrival, entry.departure, input.timeZone).state, 'fits');
});

test('keeps published event times and never makes up an event end or includes a sold-out/online session', async () => {
  const concert = event('concert', '09:30', '10:30');
  const result = await generateDayPlan({ ...input, places: [place(1)], events: [concert, event('unknown-end', '11:00'),
    { ...event('sold-out', '12:00', '13:00'), status: 5 }, { ...event('online', '12:00', '13:00'), status: 3 }] }, { fetchResponse: route });
  const chosen = result.stops.find(stop => stop.type === 'event');
  assert.equal(chosen.start, concert.start);
  assert.equal(chosen.end, concert.end);
  assert.equal(result.stops.filter(stop => stop.type === 'event').length, 1);
  assert.equal(result.skippedEvents, 3);
  assert.equal(result.entries[0].waiting, 30);
  assert.equal(result.entries[0].late, 0);
});

test('rejects closed visits and route-adjusted late arrivals, and marks unknown hours explicitly', async () => {
  const result = await generateDayPlan({ ...input, endTime: '10:00', origin: { latitude: 47.49, longitude: 19 },
    places: [place(1, 'off'), place(2, '09:00-09:20'), place(3, null)], events: [event('missed', '09:05', '09:30')] }, { fetchResponse: route });
  assert.deepEqual(result.stops.map(stop => stop.title), ['Place 3']);
  assert.equal(result.entries[0].hours, 'unknown');
  assert.equal(result.unverifiedHours, 1);
});

test('pace changes estimated visit duration and no route is assumed from an unspecified starting point', async () => {
  const slow = await generateDayPlan({ ...input, pace: 'relaxed', places: [place(1, '24/7', 'museum')] }, { fetchResponse: () => { throw Error('Unexpected walk'); } });
  const fast = await generateDayPlan({ ...input, pace: 'active', places: [place(1, '24/7', 'museum')] }, { fetchResponse: route });
  assert.ok(slow.stops[0].duration > fast.stops[0].duration);
  assert.equal(slow.legs.length, 0);
  assert.equal(slow.entries[0].arrival, slow.start);
});

test('does not keep failed walking legs, bounds routing work and supports cancellation', async () => {
  let requests = 0;
  const result = await generateDayPlan({ ...input, origin: { latitude: 47.49, longitude: 19 }, places: [place(1), place(2)] }, {
    fetchResponse: async () => { requests++; return new Response(null, { status: 502 }); },
  });
  assert.equal(result.stops.length, 0);
  assert.equal(result.failedRoutes, 2);
  assert.ok(requests <= 24);
  const controller = new AbortController();
  await assert.rejects(generateDayPlan({ ...input, origin: { latitude: 47.49, longitude: 19 }, places: [place(1)] }, {
    signal: controller.signal, fetchResponse: async url => { controller.abort(); return route(url); },
  }), { name: 'AbortError' });
});

test('does not propose duplicates, overlong walks or visits that would finish late', async () => {
  const result = await generateDayPlan({ ...input, endTime: '09:25', places: [place(1), place(1), place(2)] }, { fetchResponse: route });
  assert.equal(result.stops.length, 1);
  assert.ok(result.finish <= result.end);
  const tooFar = await generateDayPlan({ ...input, pace: 'relaxed', origin: { latitude: 47.49, longitude: 19 }, places: [place(1)] }, {
    fetchResponse: async url => { const data = await (await route(url)).json(); return Response.json({ ...data, duration: 3600 }); },
  });
  assert.equal(tooFar.stops.length, 0);
});

test('stops after the route-check budget instead of making unbounded requests', async () => {
  let requests = 0;
  const result = await generateDayPlan({ ...input, endTime: '22:00', pace: 'active', places: Array.from({ length: 12 }, (_,index) => place(index + 1)) }, {
    fetchResponse: async url => { requests++; return route(url); },
  });
  assert.equal(requests, 24);
  assert.equal(result.limited, true);
  assert.ok(result.stops.length > 0);
  assert.ok(result.finish <= result.end);
});

test('validates local time windows before making requests, including DST ambiguity', async () => {
  for (const change of [{ endTime: '08:00' }, { timeZone: null }, { day: '2026-10-25', startTime: '02:30' }, { pace: 'unsupported' }]) {
    await assert.rejects(generateDayPlan({ ...input, ...change, places: [place(1)] }, { fetchResponse: () => { throw Error('Unexpected route'); } }), /Invalid planning/);
  }
});

test('loads the selected date, keeps surviving sources and labels stale place suggestions', async () => {
  const storage = new Map();
  const local = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) };
  const city = { id: 123, latitude: 47.5, longitude: 19, timezone: input.timeZone };
  const calls = [];
  const fetchResponse = async url => {
    calls.push(String(url));
    if (String(url).startsWith('/api/places?')) return Response.json([place(1)]);
    if (String(url).startsWith('/api/official-events/')) return Response.json({ events: [{ title: 'Concert', url: 'https://events.example/concert', begin: day + 'T10:00', end: day + 'T11:00' }] });
    return new Response(null, { status: 502 });
  };
  const result = await loadPlanCandidates(city, day, { storage: local, fetchResponse });
  assert.equal(result.places.length, 1);
  assert.equal(result.events.length, 1);
  assert.equal(result.incomplete, true);
  assert.ok(calls.includes('/api/official-events/123?date=2026-11-27'));
  const fallback = await loadPlanCandidates(city, day, { storage: local, fetchResponse: async () => new Response(null, { status: 502 }) });
  assert.equal(fallback.stalePlaces, true);
  assert.equal(fallback.places.length, 1);
});

test('replaces a plan atomically only against the exact reviewed snapshot', () => {
  const values = new Map();
  const store = itineraryStore(9001, { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) });
  const original = itineraryStop(place(1), 'place');
  store.add(day, original);
  const snapshot = store.read(day).stops;
  const proposal = [{ ...itineraryStop(place(2), 'place'), duration: 30 }];
  store.duration(day, original.id, 20);
  assert.throws(() => store.replaceAll(day, proposal, snapshot), /Plan changed/);
  assert.equal(store.read(day).stops[0].title, original.title);
  const current = store.read(day).stops;
  assert.throws(() => store.replaceAll(day, [], current), /Invalid proposed/);
  assert.throws(() => store.replaceAll(day, [proposal[0], proposal[0]], current), /Duplicate/);
  const result = store.replaceAll(day, proposal, current);
  assert.equal(result.stops[0].duration, 30);
  assert.equal(result.stops[0].title, 'Place 2');
  assert.equal(result.saved, true);
});

test('applying without storage retains the whole proposed plan in this tab', () => {
  const store = itineraryStore(9002);
  const before = store.add(day, itineraryStop(place(1), 'place')).stops;
  const proposed = [{ ...itineraryStop(place(2), 'place'), duration: 30 }];
  const result = store.replaceAll(day, proposed, before);
  assert.equal(result.saved, false);
  assert.deepEqual(store.read(day).stops, result.stops);
  assert.throws(() => store.replaceAll(day, before, before), /Plan changed/);
  assert.equal(store.read(day).stops[0].title, 'Place 2');
});
