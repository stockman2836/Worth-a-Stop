import test from 'node:test';
import assert from 'node:assert/strict';
import { generateDayPlan } from '../src/auto-plan.mjs';
import { plannedPause, pauseSettingsStore } from '../src/planned-pause.mjs';
import { arrivalTimes } from '../src/arrival-times.mjs';
import { walkingLegs } from '../src/walking-legs.mjs';
import { itineraryStop, itineraryStore } from '../src/itinerary.mjs';
import { withTripEndpoints } from '../src/return-trip.mjs';
import { resetCityPlans } from '../src/city-plan-state.mjs';
import { compareStopOrder } from '../src/stop-order.mjs';

const day = '2026-11-28', point = { latitude: 47.49, longitude: 19 };
const base = { day, startTime: '09:00', endTime: '14:00', timeZone: 'Europe/Budapest', origin: point,
  pause: { kind: 'meal', from: '10:00', to: '11:00', duration: 30 }, returnTrip: { point, bufferMinutes: 15 } };
const place = id => ({ name: 'View ' + id, names: {}, latitude: 47.5, longitude: 19 + id / 1000,
  category: 'viewpoint', hours: '24/7', km: .1, url: 'https://www.openstreetmap.org/node/' + id });
const instant = time => Date.parse(day + 'T' + time + ':00+01:00');
const route = async url => {
  const p = new URL(url, 'https://app.example').searchParams;
  return Response.json({ status: 'ok', duration: 600, distance: 700, geometry: { type: 'LineString',
    coordinates: [[+p.get('fromLon'), +p.get('fromLat')], [+p.get('toLon'), +p.get('toLat')]] } });
};
const storage = () => { const entries = new Map(); return { getItem: key => entries.get(key), setItem: (key, value) => entries.set(key, value),
  removeItem: key => entries.delete(key), key: i => [...entries.keys()][i], get length() { return entries.size; } }; };

test('a mandatory break fits between visits and preserves the routed return and departure buffer', async () => {
  let requests = 0;
  const result = await generateDayPlan({ ...base, places: Array.from({ length: 8 }, (_, i) => place(i + 1)) }, { fetchResponse: url => { requests++; return route(url); } });
  const pauses = result.entries.filter(entry => entry.stop.type === 'pause');
  assert.equal(pauses.length, 1); assert.equal(result.pause.id, pauses[0].stop.id);
  assert(pauses[0].visitStart >= instant('10:00')); assert(pauses[0].departure <= instant('11:00'));
  assert.equal(pauses[0].departure - pauses[0].visitStart, 30 * 60000);
  const index = result.stops.findIndex(stop => stop.type === 'pause');
  assert(index > 0); assert(index < result.stops.length - 1);
  assert(result.finish <= result.returnTrip.deadline); assert(requests <= 24);
  const stops = withTripEndpoints(result.stops, point, base.returnTrip, { deadline: result.returnTrip.deadline });
  assert.equal(arrivalTimes(stops, result.legs, result.start).at(-1).departure, result.finish);
});

test('waiting for lunch does not extend a museum visit beyond its opening hours', async () => {
  const result = await generateDayPlan({ ...base, origin: null, returnTrip: null, places: [{ ...place(1), hours: '09:00-09:30' }] }, { fetchResponse: route });
  assert.equal(result.entries[0].hours, 'fits'); assert.equal(result.entries[0].departure, instant('09:20'));
  const pause = result.entries.at(-1);
  assert.equal(pause.stop.type, 'pause'); assert.equal(pause.visitStart, instant('10:00'));
  assert.equal(pause.waiting, 40); assert.equal(result.finish, instant('10:30'));
});

test('a break can precede the first event without moving the published session', async () => {
  const event = { title: 'Session', url: 'https://events.example/session', location: { latitude: 47.5, longitude: 19.01 },
    start: instant('14:00'), end: instant('16:00') };
  const result = await generateDayPlan({ ...base, startTime: '12:00', endTime: '17:00',
    pause: { kind: 'rest', from: '13:00', to: '14:00', duration: 45 }, events: [event] }, { fetchResponse: route });
  assert.deepEqual(result.stops.map(stop => stop.type), ['pause', 'event']);
  assert.equal(result.entries[0].visitStart, instant('13:00'));
  assert.equal(result.entries[1].visitStart, event.start); assert.equal(result.entries[1].departure, event.end);
  assert.equal(result.entries[1].late, 0); assert(result.finish <= result.returnTrip.deadline);
});

test('an impossible event-and-break combination never produces a suggestion with a silently missing break', async () => {
  const result = await generateDayPlan({ ...base, startTime: '12:00', endTime: '14:00',
    pause: { kind: 'meal', from: '13:00', to: '13:30', duration: 30 },
    events: [{ title: 'Session', url: 'https://events.example/session', location: { latitude: 47.5, longitude: 19.01 }, start: instant('13:00'), end: instant('13:30') }] }, { fetchResponse: route });
  assert.deepEqual(result.stops, []); assert.equal(result.pause, null); assert.equal(result.returnTrip, null);
});

test('invalid and ambiguous break windows fail before any routing, while disabled breaks preserve the old planner', async () => {
  for (const pause of [{ ...base.pause, from: '11:00' }, { ...base.pause, duration: 0 }, { ...base.pause, duration: 181 },
    { ...base.pause, duration: 90 }, { ...base.pause, kind: 'unknown' }, { ...base.pause, from: '' }]) {
    await assert.rejects(generateDayPlan({ ...base, pause, places: [place(1)] }, { fetchResponse: () => assert.fail('Invalid break must not route') }), /Invalid pause/);
  }
  await assert.rejects(generateDayPlan({ ...base, day: '2026-10-25', startTime: '00:00', endTime: '05:00',
    pause: { kind: 'rest', from: '02:30', to: '04:00', duration: 30 } }), /Invalid pause/);
  const original = await generateDayPlan({ ...base, pause: null, places: [place(1)] }, { fetchResponse: route });
  assert(!original.stops.some(stop => stop.type === 'pause'));
});

test('only a pause at the same coordinates gets a zero-length leg, and manual detours are routed', async () => {
  const visit = { ...itineraryStop(place(1), 'place'), duration: 20 };
  const pause = plannedPause({ kind: 'meal', start: instant('10:00'), end: instant('11:00'), duration: 30 }, visit.location);
  let requests = 0;
  const fetchResponse = url => { requests++; return route(url); };
  assert.equal((await walkingLegs([visit, pause], { fetchResponse }))[0].duration, 0); assert.equal(requests, 0);
  const other = { ...itineraryStop(place(2), 'place'), duration: 20 };
  assert.equal((await walkingLegs([other, pause], { fetchResponse }))[0].duration, 600); assert.equal(requests, 1);
});

test('applied breaks survive storage and duration edits reveal an overrun without changing the fixed window', () => {
  const saved = storage(), store = itineraryStore(81001, saved);
  const pause = plannedPause({ kind: 'meal', start: instant('10:00'), end: instant('11:00'), duration: 30 }, point);
  store.replaceAll(day, [pause], []);
  const restored = itineraryStore(81001, saved).read(day).stops[0];
  assert.deepEqual(restored, pause);
  const changed = store.duration(day, pause.id, 90).stops[0];
  const timing = arrivalTimes([changed], [], instant('10:00'))[0];
  assert.equal(timing.reason, 'pause-window'); assert.equal(timing.late, 30);
  assert.equal(changed.start, pause.start); assert.equal(changed.end, pause.end);
  assert.throws(() => store.duration(day, pause.id, null), /Invalid planned pause/);
});

test('break preferences are isolated by day and city and reset with persisted and temporary plans', () => {
  const saved = storage(), value = { enabled: true, ...base.pause };
  pauseSettingsStore(81002, saved).set(day, value);
  assert.deepEqual(pauseSettingsStore(81002, saved).read(day).settings, value);
  assert.equal(pauseSettingsStore(81002, saved).read('2026-11-29').settings.enabled, false);
  assert.equal(pauseSettingsStore(81003, saved).read(day).settings.enabled, false);
  resetCityPlans(81002, saved); assert.equal(pauseSettingsStore(81002, saved).read(day).settings.enabled, false);
  const blocked = { getItem() { throw Error('Blocked'); }, setItem() { throw Error('Blocked'); } };
  pauseSettingsStore(81002, blocked).set(day, value);
  assert.deepEqual(pauseSettingsStore(81002, blocked).read(day), { settings: value, saved: false });
  resetCityPlans(81002); assert.equal(pauseSettingsStore(81002, blocked).read(day).settings.enabled, false);
});

test('order comparisons reject a detour which pushes the break outside its time window', async () => {
  const a = { ...itineraryStop(place(1), 'place'), duration: 10 }, b = { ...itineraryStop(place(2), 'place'), duration: 10 };
  const pause = plannedPause({ kind: 'rest', start: instant('09:30'), end: instant('10:00'), duration: 30 }, b.location);
  const legs = [{ from: a, to: b, status: 'ok', duration: 300 }, { from: b, to: pause, status: 'ok', duration: 0 }];
  const result = await compareStopOrder([a, b, pause], a.id, legs, instant('09:00'), 'Europe/Budapest', { fetchResponse: async url => {
    const p = new URL(url, 'https://app.example').searchParams;
    return Response.json({ ...(await (await route(url)).json()), duration: +p.get('toLon') === b.location.longitude ? 1200 : 300 });
  } });
  assert.equal(result.applicable, false); assert.equal(result.after.visits.at(-1).reason, 'pause-window');
});
