import test from 'node:test';
import assert from 'node:assert/strict';
import { itineraryStop, itineraryStore } from '../src/itinerary.mjs';

function storage() {
  const values = new Map();
  return { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
}
const date = '2026-11-28';
const place = itineraryStop({ name: 'Museum', url: 'https://www.openstreetmap.org/node/1' }, 'place');
const event = itineraryStop({ title: 'Concert', url: 'https://city.example/concert',
  start: Date.parse('2026-11-28T18:00Z'), end: Date.parse('2026-11-28T20:00Z') }, 'event');

test('persists ordered stops, prevents duplicate clicks and keeps city and date plans separate', () => {
  const saved = storage();
  const store = itineraryStore(1, saved);
  store.add(date, place);
  store.add(date, event);
  assert.equal(store.add(date, event).stops.length, 2);
  store.duration(date, place.id, 90);
  store.move(date, event.id, -1);
  const restored = itineraryStore(1, saved).read(date);
  assert.equal(restored.stops[0].id, event.id);
  assert.equal(restored.stops[0].start, event.start);
  assert.equal(restored.stops[1].duration, 90);
  assert.equal(store.read('2026-11-29').stops.length, 0);
  assert.equal(itineraryStore(2, saved).read(date).stops.length, 0);
  assert.equal(store.remove(date, place.id).stops.length, 1);
});
test('edits read the latest saved plan and never assign a visit duration to a fixed event', () => {
  const saved = storage();
  const first = itineraryStore(3, saved);
  const second = itineraryStore(3, saved);
  first.add(date, place);
  second.add(date, event);
  assert.equal(first.duration(date, place.id, 45).stops.length, 2);
  assert.equal(first.duration(date, event.id, 45).stops[1].duration, null);
  assert.throws(() => first.duration(date, place.id, -1));
  assert.throws(() => first.read('2026-02-30'));
});
test('storage failures retain edits in this tab and unsafe source links are rejected', () => {
  const unavailable = { getItem() { throw Error(); }, setItem() { throw Error(); } };
  const store = itineraryStore(4, unavailable);
  assert.equal(store.add(date, place).saved, false);
  assert.equal(itineraryStore(4, unavailable).read(date).stops[0].title, place.title);
  assert.throws(() => itineraryStop({ title: 'Bad', url: 'javascript:alert(1)' }, 'event'));
});
test('a failed write does not replace unsaved changes with an older readable snapshot', () => {
  const saved = storage();
  const store = itineraryStore(5, saved);
  store.add(date, place);
  saved.setItem = () => { throw Error('quota'); };
  assert.equal(store.add(date, event).saved, false);
  assert.equal(itineraryStore(5, saved).read(date).stops.length, 2);
  assert.equal(store.duration(date, place.id, 20).stops.length, 2);
});
