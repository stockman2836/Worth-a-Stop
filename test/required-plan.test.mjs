import test from 'node:test';
import assert from 'node:assert/strict';
import { generateDayPlan } from '../src/auto-plan.mjs';
import { itineraryStop, itineraryStore } from '../src/itinerary.mjs';
import { findMealOptions } from '../src/meal-options.mjs';
import { arrivalTimes } from '../src/arrival-times.mjs';
import { withTripEndpoints } from '../src/return-trip.mjs';
import { findAlternatives } from '../src/alternatives.mjs';

const day = '2026-11-28';
const input = { day, startTime: '09:00', endTime: '14:00', timeZone: 'Europe/Budapest' };
const place = (id, hours = '24/7', category = 'viewpoint') => ({ name: 'Place ' + id, names: {},
  url: 'https://www.openstreetmap.org/node/' + id, latitude: 47.5, longitude: 19 + id / 1000, hours, category });
const required = (id, hours = '24/7', duration = 20) => ({ ...itineraryStop(place(id, hours), 'place'), required: true, duration });
const route = async url => {
  const p = new URL(url, 'https://app.example').searchParams;
  return Response.json({ status: 'ok', duration: 300, distance: 400, geometry: { type: 'LineString',
    coordinates: [[+p.get('fromLon'), +p.get('fromLat')], [+p.get('toLon'), +p.get('toLat')]] } });
};
const memoryStorage = () => {
  const values = new Map();
  return { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
};

test('keeps required places outside the shortlist and interest matches, including saved durations', async () => {
  const must = required(99, '24/7', 47), original = structuredClone(must);
  const result = await generateDayPlan({ ...input, interests: ['nature'], required: [must],
    places: Array.from({ length: 20 }, (_, i) => place(i + 1, '24/7', 'park')) }, { fetchResponse: route });
  assert(!result.requiredConflict);
  const kept = result.stops.find(stop => stop.id === must.id);
  assert.equal(kept.duration, 47); assert.equal(kept.required, true);
  assert(result.stops.length > 1); assert(result.finish <= result.end);
  assert.deepEqual(must, original);
  const rerun = await generateDayPlan({ ...input, required: result.stops.filter(stop => stop.required), places: [place(3)] }, { fetchResponse: route });
  assert.equal(rerun.stops.find(stop => stop.required).id, must.id);
});

test('reorders required visits to respect closure instead of silently losing one', async () => {
  const must = [required(1), required(2, '09:00-09:30')];
  const result = await generateDayPlan({ ...input, required: must }, { fetchResponse: route });
  assert(!result.requiredConflict);
  assert.deepEqual(result.stops.map(stop => stop.title), ['Place 2', 'Place 1']);
  assert(result.entries.every(entry => entry.hours === 'fits'));
});

test('inserts optional visits before and between anchors while preserving the entire break and return', async () => {
  const origin = { latitude: 47.49, longitude: 19 };
  const trip = { point: origin, bufferMinutes: 15 };
  const result = await generateDayPlan({ ...input, endTime: '12:00', origin, returnTrip: trip,
    required: [required(1), required(2)], places: [place(3), place(4)],
    pause: { kind: 'meal', from: '10:00', to: '11:00', duration: 30 } }, { fetchResponse: route });
  assert(!result.requiredConflict);
  assert.equal(result.stops.filter(stop => stop.required).length, 2);
  assert(result.stops.some(stop => stop.title === 'Place 3'));
  assert.equal(result.pause.duration, 30);
  assert(result.finish <= result.returnTrip.deadline);
  const times = arrivalTimes(withTripEndpoints(result.stops, origin, trip, { deadline: result.returnTrip.deadline }), result.legs, result.start);
  assert(times.every(time => !time.reason && !time.late));
  assert.equal(times.at(-1).departure, result.finish);
});

test('required visits are not discarded by the relaxed pace stop count', async () => {
  const result = await generateDayPlan({ ...input, pace: 'relaxed', required: Array.from({ length: 5 }, (_, i) => required(i + 1)) }, { fetchResponse: route });
  assert(!result.requiredConflict); assert.equal(result.stops.length, 5);
});

test('uses a free gap between required visits instead of only appending optional places', async () => {
  const result = await generateDayPlan({ ...input, required: [required(1, '09:00-09:30'), required(2, '09:45-14:00')],
    places: [place(3)], pause: { kind: 'meal', from: '09:30', to: '10:30', duration: 15 } }, { fetchResponse: route });
  assert(!result.requiredConflict);
  const visits = result.stops.filter(stop => stop.type === 'place');
  assert.deepEqual(visits.map(stop => stop.title), ['Place 1', 'Place 3', 'Place 2']);
});

test('reports hours, missing coordinates, walking and return conflicts without an applicable partial route', async () => {
  const closed = await generateDayPlan({ ...input, required: [required(1), required(2, 'off')] }, { fetchResponse: route });
  assert.equal(closed.requiredConflict.code, 'closed-arrival'); assert.deepEqual(closed.stops, []);
  const noPoint = required(3); delete noPoint.location;
  const missing = await generateDayPlan({ ...input, required: [noPoint] }, { fetchResponse: route });
  assert.equal(missing.requiredConflict.code, 'location');
  const origin = { latitude: 47.49, longitude: 19 };
  const unavailable = await generateDayPlan({ ...input, origin, required: [required(4)] }, { fetchResponse: async () => new Response(null, { status: 502 }) });
  assert.equal(unavailable.requiredConflict.code, 'route'); assert.equal(unavailable.failedRoutes, 1);
  const long = await generateDayPlan({ ...input, origin, required: [required(4)] }, { fetchResponse: async url => Response.json({ ...await (await route(url)).json(), duration: 3600 }) });
  assert.equal(long.requiredConflict.code, 'walk-limit');
  const late = await generateDayPlan({ ...input, endTime: '09:30', required: [required(4)], returnTrip: { point: origin, bufferMinutes: 10 } }, { fetchResponse: route });
  assert.equal(late.requiredConflict.code, 'return'); assert.deepEqual(late.stops, []);
});

test('mandatory breaks cannot disappear to make required places fit', async () => {
  const result = await generateDayPlan({ ...input, endTime: '09:40', required: [required(1, '24/7', 30)],
    pause: { kind: 'meal', from: '09:00', to: '09:40', duration: 20 } }, { fetchResponse: route });
  assert(result.requiredConflict); assert.deepEqual(result.stops, []);
});

test('unknown hours remain explicit and newly published closure overrides saved required hours', async () => {
  const unknown = await generateDayPlan({ ...input, required: [required(1, null)] }, { fetchResponse: route });
  assert.equal(unknown.unverifiedHours, 1); assert.equal(unknown.entries[0].hours, 'unknown');
  const updated = await generateDayPlan({ ...input, required: [required(1)], places: [place(1, 'off')] }, { fetchResponse: route });
  assert.equal(updated.requiredConflict.code, 'closed-arrival');
});

test('bounded searches label uncertainty and cancellation propagates', async () => {
  let calls = 0;
  const result = await generateDayPlan({ ...input, endTime: '10:00', required: Array.from({ length: 10 }, (_, i) => required(i + 1)) }, {
    fetchResponse: url => { calls++; return route(url); },
  });
  assert(calls <= 48); assert.equal(result.requiredConflict.code, 'search-limit'); assert.equal(result.limited, true);
  const controller = new AbortController();
  await assert.rejects(generateDayPlan({ ...input, origin: { latitude: 47.49, longitude: 19 }, required: [required(1)] }, {
    signal: controller.signal, fetchResponse: async url => { controller.abort(); return route(url); },
  }), { name: 'AbortError' });
});

test('pins persist per city and date, survive applying and cannot be dropped or replaced accidentally', async () => {
  const storage = memoryStorage(), store = itineraryStore(85001, storage), stop = required(1);
  store.add(day, { ...stop, required: undefined });
  store.require(day, stop.id, true);
  assert.equal(itineraryStore(85001, storage).read(day).stops[0].required, true);
  assert.equal(store.read('2026-11-29').stops.length, 0); assert.equal(itineraryStore(85002, storage).read(day).stops.length, 0);
  const snapshot = store.read(day).stops;
  assert.throws(() => store.replaceAll(day, [required(2)], snapshot), /Required stop missing/);
  assert.throws(() => store.replace(day, stop.id, required(2), snapshot), /Invalid replacement/);
  const plan = await generateDayPlan({ ...input, required: snapshot }, { fetchResponse: route });
  store.replaceAll(day, plan.stops, snapshot);
  assert.equal(store.read(day).stops[0].required, true);
  store.add(day, itineraryStop(place(1), 'place'));
  assert.equal(store.read(day).stops[0].required, true);
  store.require(day, stop.id, false); assert.equal(store.read(day).stops[0].required, undefined);
  assert.throws(() => store.require(day, stop.id, 'true'), /Invalid required flag/);
});

test('blocked storage retains pins and subsequent duration edits in this tab', () => {
  const storage = { getItem() { throw Error('Blocked'); }, setItem() { throw Error('Blocked'); } };
  const store = itineraryStore(85003, storage), stop = required(1);
  store.add(day, stop); assert.equal(store.require(day, stop.id, true).saved, false);
  store.duration(day, stop.id, 45);
  assert.equal(itineraryStore(85003, storage).read(day).stops[0].required, true);
  assert.equal(store.read(day).stops[0].duration, 45);
});

test('meal detours retain required stops and recheck their hours', async () => {
  const plan = await generateDayPlan({ ...input, required: [required(1, '09:00-10:10')],
    pause: { kind: 'meal', from: '09:00', to: '10:00', duration: 30 } }, { fetchResponse: route });
  const venue = { ...place(100), category: 'cafe' };
  const options = await findMealOptions(plan, { timeZone: input.timeZone }, { fetchResponse: url => String(url).startsWith('/api/meal-venues?')
    ? Promise.resolve(Response.json({ venues: [venue] })) : route(url) });
  assert.equal(options.options.length, 1);
  assert(options.options[0].plan.stops.some(stop => stop.required && stop.id === plan.stops.find(stop => stop.required).id));
});

test('replacement checks cannot remove a pin or delay a later required place past closing', async () => {
  const first = { ...itineraryStop(place(1), 'place'), duration: 20 }, must = required(2, '09:00-10:00');
  const plan = await generateDayPlan({ ...input, required: [must], places: [place(1)] }, { fetchResponse: route });
  const forbidden = await findAlternatives([must], must.id, [], plan.start, input.timeZone, {
    fetchResponse: () => { throw Error('A pinned stop must not search for replacements'); },
  });
  assert.equal(forbidden.reason, 'required');
  const legs = [{ ...(await (await route('/api/walking?fromLat=47.5&fromLon=19.001&toLat=47.5&toLon=19.002')).json()), from: first, to: must }];
  const replacement = { ...place(3), km: .1 };
  const result = await findAlternatives([first, must], first.id, legs, plan.start, input.timeZone, {
    fetchResponse: async url => String(url).startsWith('/api/places?') ? Response.json([replacement])
      : Response.json({ ...await (await route(url)).json(), duration: 1800 }),
  });
  assert.deepEqual(result.alternatives, []);
});
