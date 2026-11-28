import test from 'node:test';
import assert from 'node:assert/strict';
import { returnTripStore, withTripEndpoints, returnStop } from '../src/return-trip.mjs';
import { itineraryStop } from '../src/itinerary.mjs';
import { compareStopOrder } from '../src/stop-order.mjs';
import { findAlternatives } from '../src/alternatives.mjs';
import { resetCityPlans } from '../src/city-plan-state.mjs';
import { arrivalTimes } from '../src/arrival-times.mjs';
import { generateDayPlan } from '../src/auto-plan.mjs';

const day = '2026-11-28', point = { latitude: 47.49, longitude: 19 };
const options = { day, startTime: '09:00', endTime: '10:00', timeZone: 'Europe/Budapest', origin: point,
  returnTrip: { point, bufferMinutes: 15 } };
const place = id => ({ name: 'View ' + id, names: {}, url: 'https://www.openstreetmap.org/node/' + id,
  latitude: 47.5, longitude: 19 + id / 1000, category: 'viewpoint', hours: '24/7' });
const route = async url => {
  const p = new URL(url, 'https://app.example').searchParams;
  return Response.json({ status: 'ok', duration: 600, distance: 700,
    geometry: { type: 'LineString', coordinates: [[+p.get('fromLon'), +p.get('fromLat')], [+p.get('toLon'), +p.get('toLat')]] } });
};

test('day plans reserve time for the routed return and buffer and keep endpoints outside editable visits', async () => {
  const result = await generateDayPlan({ ...options, places: [place(1), place(2)] }, { fetchResponse: route });
  assert.equal(result.stops.length, 1);
  assert.equal(result.legs.length, 2);
  assert.equal(result.walkingMinutes, 20);
  assert.equal(result.returnTrip.leg.to.type, 'return');
  assert.equal(result.finish, result.returnTrip.arrival);
  assert(result.finish <= result.end - 15 * 60000);
  const stops = withTripEndpoints(result.stops, point, options.returnTrip, { deadline: result.returnTrip.deadline });
  assert.deepEqual(stops.map(stop => stop.type), ['origin', 'place', 'return']);
  assert.equal(arrivalTimes(stops, result.legs, result.start).at(-1).departure, result.finish);
});

test('a return may arrive exactly at its deadline; a larger buffer excludes the same walk', async () => {
  const fits = await generateDayPlan({ ...options, returnTrip: { point, bufferMinutes: 20 }, places: [place(1)] }, { fetchResponse: route });
  assert.equal(fits.returnTrip.arrival, fits.returnTrip.deadline);
  const noTime = await generateDayPlan({ ...options, returnTrip: { point, bufferMinutes: 21 }, places: [place(1)] }, { fetchResponse: route });
  assert.equal(noTime.stops.length, 0); assert.equal(noTime.returnTrip, null);
});

test('an unavailable or asymmetric return is never replaced by an assumed outbound duration', async () => {
  for (const duration of [null, 1800]) {
    const result = await generateDayPlan({ ...options, places: [place(1)] }, { fetchResponse: async url => {
      const p = new URL(url, 'https://app.example').searchParams;
      if (+p.get('toLat') !== point.latitude) return route(url);
      if (duration === null) return Response.json({ status: 'no-route' });
      return Response.json({ ...(await (await route(url)).json()), duration });
    } });
    assert.equal(result.stops.length, 0); assert.equal(result.returnTrip, null);
  }
});

test('separate return points work without an explicit origin and preserve the routing budget', async () => {
  let requests = 0;
  const result = await generateDayPlan({ ...options, origin: null, endTime: '22:00', pace: 'active',
    places: Array.from({ length: 12 }, (_, i) => place(i + 1)) }, { fetchResponse: url => { requests++; return route(url); } });
  assert(result.stops.length > 0); assert(requests <= 24);
  assert.deepEqual(result.returnTrip.stop.location, point);
  assert.equal(result.legs.at(-1).to.type, 'return');
  assert(result.returnTrip.arrival <= result.returnTrip.deadline);
});

test('invalid points, buffers and insufficient departure windows are rejected before routing', async () => {
  for (const returnTrip of [{ point: null, bufferMinutes: 15 }, { point, bufferMinutes: -1 },
    { point, bufferMinutes: 1.5 }, { point, bufferMinutes: 121 }, { point, bufferMinutes: 60 }]) {
    await assert.rejects(generateDayPlan({ ...options, returnTrip, places: [place(1)] }, { fetchResponse: () => assert.fail('Invalid options must not route') }), /Invalid planning/);
  }
});

test('cancelling while the return route is loading cannot publish an assumed return', async () => {
  const controller = new AbortController();
  await assert.rejects(generateDayPlan({ ...options, places: [place(1)] }, { signal: controller.signal, fetchResponse: url => {
    const p = new URL(url, 'https://app.example').searchParams;
    if (+p.get('toLat') === point.latitude) controller.abort();
    return route(url);
  } }), { name: 'AbortError' });
});

test('an adjacent swap cannot be marked applicable when its new final leg misses the return deadline', async () => {
  const start = Date.parse('2026-11-28T08:00:00Z');
  const visits = [1, 2].map(id => ({ ...itineraryStop(place(id), 'place'), duration: 10 }));
  const destination = returnStop(point, 'Return', start + 35 * 60000), stops = [...visits, destination];
  const legs = stops.slice(1).map((to, i) => ({ from: stops[i], to, status: 'ok', duration: 300, distance: 200 }));
  const comparison = await compareStopOrder(stops, visits[0].id, legs, start, 'Europe/Budapest', { fetchResponse: async url => {
    const data = await (await route(url)).json(), p = new URL(url, 'https://app.example').searchParams;
    return Response.json({ ...data, duration: +p.get('toLat') === point.latitude ? 1800 : 300 });
  } });
  assert.equal(comparison.applicable, false);
  assert(comparison.before.finish <= destination.deadline);
  assert(comparison.after.finish > destination.deadline);
});

test('replacement suggestions reject a longer final walk that would miss the return deadline', async () => {
  const start = Date.parse('2026-11-28T08:00:00Z');
  const visit = { ...itineraryStop(place(1), 'place'), duration: 10 };
  const destination = returnStop(point, 'Return', start + 20 * 60000);
  const leg = { from: visit, to: destination, status: 'ok', duration: 300, distance: 200 };
  const candidate = { ...place(3), km: .1 };
  const result = await findAlternatives([visit, destination], visit.id, [leg], start, 'Europe/Budapest', { fetchResponse: async url => {
    if (String(url).startsWith('/api/places?')) return Response.json([candidate]);
    return Response.json({ ...(await (await route(url)).json()), duration: 1800 });
  } });
  assert.deepEqual(result.alternatives, []);
});

test('return settings survive view changes, remain isolated by day and city, and reset with the city plan', () => {
  const entries = new Map(), storage = { getItem: key => entries.get(key), setItem: (key, value) => entries.set(key, value),
    removeItem: key => entries.delete(key), key: i => [...entries.keys()][i], get length() { return entries.size; } };
  const settings = { enabled: true, mode: 'point', point, bufferMinutes: 20 };
  returnTripStore(90101, storage).set(day, settings);
  assert.deepEqual(returnTripStore(90101, storage).read(day).settings, settings);
  assert.equal(returnTripStore(90101, storage).read('2026-11-29').settings.enabled, false);
  assert.equal(returnTripStore(90102, storage).read(day).settings.enabled, false);
  resetCityPlans(90101, storage);
  assert.equal(returnTripStore(90101, storage).read(day).settings.enabled, false);
  const blocked = { getItem() { throw Error('Blocked'); }, setItem() { throw Error('Blocked'); } };
  returnTripStore(90101, blocked).set(day, settings);
  assert.deepEqual(returnTripStore(90101, blocked).read(day), { settings, saved: false });
  resetCityPlans(90101);
  assert.equal(returnTripStore(90101, blocked).read(day).settings.enabled, false);
});
