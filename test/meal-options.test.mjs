import test from 'node:test';
import assert from 'node:assert/strict';
import { createMealSearch } from '../src/meal-search.mjs';
import { findMealOptions } from '../src/meal-options.mjs';
import { generateDayPlan } from '../src/auto-plan.mjs';
import { itineraryStore } from '../src/itinerary.mjs';
import { arrivalTimes } from '../src/arrival-times.mjs';
import { withTripEndpoints } from '../src/return-trip.mjs';
import { visitOpeningState } from '../src/opening-hours.mjs';

const point = { latitude: 47.49, longitude: 19 }, day = '2026-11-28';
const context = { origin: point, returnTrip: { point, bufferMinutes: 15 }, timeZone: 'Europe/Budapest' };
const input = { day, startTime: '09:00', endTime: '14:00', ...context, pause: { kind: 'meal', from: '10:00', to: '11:00', duration: 30 },
  places: [1, 2].map(id => ({ name: 'View ' + id, names: {}, category: 'viewpoint', latitude: 47.5, longitude: 19 + id / 1000,
    km: .1, hours: '24/7', url: 'https://www.openstreetmap.org/node/' + id })) };
const venue = (id, hours = '24/7') => ({ name: 'Cafe ' + id, names: { ru: 'Кафе ' + id }, category: 'cafe',
  latitude: 47.5001 + id / 100000, longitude: 19.0021, hours, url: 'https://www.openstreetmap.org/node/' + (100 + id) });
const route = async (url, seconds = 600) => {
  const p = new URL(url, 'https://app.example').searchParams;
  return Response.json({ status: 'ok', duration: seconds, distance: 500, geometry: { type: 'LineString',
    coordinates: [[+p.get('fromLon'), +p.get('fromLat')], [+p.get('toLon'), +p.get('toLat')]] } });
};
const base = change => generateDayPlan({ ...input, ...change }, { fetchResponse: url => route(url) });

test('meal options route both adjacent legs, keep the entire schedule valid and do not mutate the original proposal', async () => {
  const plan = await base(), original = structuredClone(plan); let requests = 0;
  const result = await findMealOptions(plan, context, { fetchResponse: url => {
    if (String(url).startsWith('/api/meal-venues?')) return Response.json({ venues: [venue(1)] });
    requests++; return route(url, 300);
  } });
  assert.equal(result.options.length, 1); assert.equal(requests, 2);
  const option = result.options[0]; assert.equal(option.hours, 'fits');
  assert.equal(option.plan.pause.url, venue(1).url); assert.equal(option.plan.pause.mealVenue.name, venue(1).name);
  assert(option.plan.finish <= option.plan.returnTrip.deadline);
  const stops = withTripEndpoints(option.plan.stops, point, context.returnTrip, { deadline: option.plan.returnTrip.deadline });
  const times = arrivalTimes(stops, option.plan.legs, option.plan.start);
  assert(times.every(time => !time.reason && !time.late)); assert.equal(times.at(-1).departure, option.plan.finish);
  assert.deepEqual(plan, original);
});

test('published-open options rank ahead of unknown hours, while closed or closing venues are excluded', async () => {
  const plan = await base();
  const result = await findMealOptions(plan, context, { fetchResponse: url => String(url).startsWith('/api/meal-venues?')
    ? Response.json({ venues: [venue(1, null), venue(2), venue(3, 'off'), venue(4, '10:00-10:10')] }) : route(url, 300) });
  assert.deepEqual(result.options.map(option => option.venue.name), ['Cafe 2', 'Cafe 1']);
  assert.equal(result.options[0].hours, 'fits'); assert.equal(result.options[1].hours, 'unknown');
});

test('a venue is checked at meal start after waiting, rather than at an earlier arrival outside opening hours', async () => {
  const plan = await base({ places: input.places.slice(0, 1) });
  const result = await findMealOptions(plan, context, { fetchResponse: url => String(url).startsWith('/api/meal-venues?')
    ? Response.json({ venues: [venue(1, '10:00-11:00')] }) : route(url, 300) });
  const entry = result.options[0].plan.entries.find(item => item.stop.type === 'pause');
  assert(entry.arrival < entry.visitStart); assert.equal(entry.venueHours, 'fits');
});

test('a detour which consumes the departure buffer is not an applicable meal option', async () => {
  const plan = await base({ endTime: '10:55' });
  assert.equal(plan.finish, plan.returnTrip.deadline);
  const result = await findMealOptions(plan, context, { fetchResponse: url => String(url).startsWith('/api/meal-venues?')
    ? Response.json({ venues: [venue(1)] }) : route(url, 600) });
  assert.deepEqual(result.options, []); assert.equal(result.state, 'no-fit');
});

test('meal detours cannot shift a published event start even when the meal window and final deadline still fit', async () => {
  const event = { title: 'Session', url: 'https://events.example/session', location: { latitude: 47.5, longitude: 19.004 },
    start: Date.parse(day + 'T10:45:00+01:00'), end: Date.parse(day + 'T11:15:00+01:00') };
  const plan = await base({ events: [event] });
  assert(plan.stops.findIndex(stop => stop.type === 'pause') < plan.stops.findIndex(stop => stop.type === 'event'));
  const result = await findMealOptions(plan, context, { fetchResponse: url => String(url).startsWith('/api/meal-venues?')
    ? Response.json({ venues: [venue(1)] }) : route(url, 2100) });
  assert.equal(result.state, 'no-fit'); assert.deepEqual(result.options, []);
});

test('cancelling optional venue routing never publishes a late result', async () => {
  const plan = await base(), controller = new AbortController();
  await assert.rejects(findMealOptions(plan, context, { signal: controller.signal, fetchResponse: url => {
    if (String(url).startsWith('/api/meal-venues?')) return Promise.resolve(Response.json({ venues: [venue(1)] }));
    controller.abort(); return route(url);
  } }), { name: 'AbortError' });
});

test('source outages, empty source results and route failures remain distinguishable', async () => {
  const plan = await base();
  const unavailable = await findMealOptions(plan, context, { fetchResponse: async () => Response.json({ status: 'unavailable', venues: [], retryAt: 123 }) });
  assert.equal(unavailable.state, 'unavailable'); assert.equal(unavailable.retryAt, 123);
  assert.equal((await findMealOptions(plan, context, { fetchResponse: async () => Response.json({ venues: [] }) })).state, 'empty');
  const noRoute = await findMealOptions(plan, context, { fetchResponse: async url => String(url).startsWith('/api/meal-venues?')
    ? Response.json({ venues: [venue(1)] }) : Response.json({ status: 'no-route' }) });
  assert.equal(noRoute.state, 'no-fit'); assert.equal(noRoute.incomplete, true);
});

test('selected venues survive itinerary storage and manual duration changes recheck their published hours', async () => {
  const plan = await base();
  const result = await findMealOptions(plan, context, { fetchResponse: async url => String(url).startsWith('/api/meal-venues?')
    ? Response.json({ venues: [venue(1, '10:00-11:00')] }) : route(url, 300) });
  const entries = new Map(), storage = { getItem: key => entries.get(key), setItem: (key, value) => entries.set(key, value) };
  const store = itineraryStore(83001, storage), selected = result.options[0].plan;
  store.replaceAll(day, selected.stops, []);
  assert.deepEqual(itineraryStore(83001, storage).read(day).stops.find(stop => stop.type === 'pause').mealVenue, selected.pause.mealVenue);
  const changed = store.duration(day, selected.pause.id, 90).stops;
  const timing = arrivalTimes(withTripEndpoints(changed, point, context.returnTrip, { deadline: selected.returnTrip.deadline }), selected.legs, selected.start);
  const at = changed.findIndex(stop => stop.type === 'pause') + 1;
  assert.equal(visitOpeningState(changed[at - 1].hours, timing[at].visitStart, timing[at].departure, input.timeZone).state, 'closes-during');
});

test('venue discovery validates food tags, public access, coordinates and duplicates and caches healthy results', async () => {
  let requests = 0;
  const node = { type: 'node', id: 1, lat: 0, lon: .001, tags: { name: 'Cafe', amenity: 'cafe', opening_hours: '24/7' } };
  const search = createMealSearch({ fetchResponse: async url => {
    if (url.hostname === 'download.geofabrik.de') return new Response(null, { status: 503 });
    requests++;
    return Response.json({ elements: [node, { ...node, id: 2, tags: { ...node.tags, access: 'private' } },
      { ...node, id: 3, tags: { ...node.tags, amenity: 'shop' } }, { ...node, id: 4, lon: 1 },
      { ...node, type: 'way', id: 5, lat: undefined, lon: undefined, center: { lat: 0, lon: .001 } }] });
  } });
  const result = await search({ latitude: 0, longitude: 0 });
  assert.equal(result.venues.length, 1); assert.equal(result.venues[0].name, 'Cafe');
  const count = requests; assert.deepEqual(await search({ latitude: 0, longitude: 0 }), result); assert.equal(requests, count);
});

test('failed venue discovery has a cooldown and never becomes a cached empty catalogue', async () => {
  let requests = 0;
  const search = createMealSearch({ fetchResponse: async () => { requests++; throw Error('Source offline'); } });
  await assert.rejects(search({ latitude: 0, longitude: 0 }), { code: 'MEAL_SOURCE_UNAVAILABLE' });
  const count = requests;
  await assert.rejects(search({ latitude: 0, longitude: 0 }), { code: 'MEAL_SOURCE_UNAVAILABLE' });
  assert.equal(requests, count);
});
