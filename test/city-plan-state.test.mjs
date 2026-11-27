import test from 'node:test';
import assert from 'node:assert/strict';
import { resetCityPlans, timeMemory } from '../src/city-plan-state.mjs';
import { itineraryStore, itineraryStop } from '../src/itinerary.mjs';
import { startingPointStore } from '../src/starting-point.mjs';

function storage() {
  const values = new Map();
  return { get length() { return values.size; }, key: index => [...values.keys()][index] ?? null,
    getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}
const day = '2026-11-28', next = '2026-11-29';
const place = itineraryStop({ name: 'Museum', url: 'https://www.openstreetmap.org/node/1' }, 'place');

test('resets all dates and planning preferences for one city while preserving other cities and discovery data', () => {
  const saved = storage(), id = 9001;
  for (const city of [id, 90012]) {
    const plans = itineraryStore(city, saved);
    for (const date of [day, next]) {
      plans.add(date, place);
      startingPointStore(city, saved).set(date, { latitude: 50, longitude: 14 });
      for (const kind of ['start', 'end']) saved.setItem(`worth-a-stop.itinerary.${kind}.v1.${city}.${date}`, '10:00');
    }
    saved.setItem(`worth-a-stop.itinerary.day.${city}`, next);
    saved.setItem(`worth-a-stop.auto-plan.pace.${city}`, 'active');
  }
  const preserved = ['worth-a-stop.language', 'worth-a-stop.theme', 'worth-a-stop.places.v4.city.9001.50.14', 'unrelated.key'];
  for (const key of preserved) saved.setItem(key, 'keep');
  assert.deepEqual(resetCityPlans(id, saved), { saved: true });
  for (const date of [day, next]) {
    assert.deepEqual(itineraryStore(id, saved).read(date).stops, []);
    assert.equal(startingPointStore(id, saved).read(date).point, null);
    assert.equal(itineraryStore(90012, saved).read(date).stops.length, 1);
    assert.equal(saved.getItem(`worth-a-stop.itinerary.start.v1.${id}.${date}`), null);
    assert.equal(saved.getItem(`worth-a-stop.itinerary.end.v1.${id}.${date}`), null);
  }
  assert.equal(saved.getItem(`worth-a-stop.itinerary.day.${id}`), null);
  assert.equal(saved.getItem(`worth-a-stop.auto-plan.pace.${id}`), null);
  assert.equal(saved.getItem('worth-a-stop.auto-plan.pace.90012'), 'active');
  for (const key of preserved) assert.equal(saved.getItem(key), 'keep');
});

test('also clears tab-local unsaved stops, origins and times, including when storage is unavailable', () => {
  const id = 9002;
  itineraryStore(id).add(day, place);
  startingPointStore(id).set(day, { latitude: 50, longitude: 14 });
  const key = `worth-a-stop.itinerary.start.v1.${id}.${day}`;
  timeMemory.set(key, '11:00');
  assert.deepEqual(resetCityPlans(id), { saved: false });
  assert.deepEqual(itineraryStore(id).read(day).stops, []);
  assert.equal(startingPointStore(id).read(day).point, null);
  assert.equal(timeMemory.has(key), false);
});

test('restores removed values after a deletion failure and preserves the current plan', () => {
  const saved = storage(), id = 9003;
  const plans = itineraryStore(id, saved);
  plans.add(day, place); plans.add(next, place);
  const original = saved.removeItem;
  let count = 0;
  saved.removeItem = key => { if (++count === 2) throw Error('blocked'); original(key); };
  assert.throws(() => resetCityPlans(id, saved), error => error.partial === false);
  assert.equal(plans.read(day).stops.length, 1);
  assert.equal(plans.read(next).stops.length, 1);
});

test('reports incomplete rollback and rejects invalid city IDs before touching storage', () => {
  const saved = storage(), id = 9004;
  itineraryStore(id, saved).add(day, place);
  saved.removeItem = key => { saved.setItem(key, 'broken'); throw Error('write failed'); };
  saved.setItem = () => { throw Error('blocked'); };
  assert.throws(() => resetCityPlans(id, saved), error => error.partial === true);
  assert.throws(() => resetCityPlans('9004', saved), /Invalid city/);
});

test('a snapshot read failure leaves both persisted and unsaved plans intact', () => {
  const saved = storage(), id = 9005;
  const plans = itineraryStore(id, saved); plans.add(day, place);
  saved.setItem = () => { throw Error('quota'); };
  plans.add(next, place);
  saved.key = () => { throw Error('storage blocked'); };
  assert.throws(() => resetCityPlans(id, saved));
  assert.equal(plans.read(day).stops.length, 1);
  assert.equal(plans.read(next).stops.length, 1);
});
