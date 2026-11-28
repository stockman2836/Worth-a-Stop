import test from 'node:test';
import assert from 'node:assert/strict';
import { interestKey, normalizeInterests, matchingInterests, shortlistPlaces, readInterests, saveInterests } from '../src/travel-interests.mjs';

const place = (id, category, km = id) => ({ url: `https://www.openstreetmap.org/node/${id}`, category, km, latitude: 50, longitude: 14 + id / 1000 });

test('normalizes saved choices and classifies by known categories without guessing from names', () => {
  assert.deepEqual(normalizeInterests(['art', 'unknown', 'nature', 'art']), ['nature', 'art']);
  assert.deepEqual(normalizeInterests('nature'), []);
  assert.deepEqual(matchingInterests('castle', ['architecture', 'history']), ['history', 'architecture']);
  assert.deepEqual(matchingInterests('museum', ['history']), []); // A museum need not concern history.
  assert.deepEqual(matchingInterests('attraction', ['nature', 'art']), []);
});

test('a matching place beyond the first twelve is considered while general alternatives remain in the bounded pool', () => {
  const museums = Array.from({ length: 25 }, (_, i) => place(i + 1, 'museum'));
  const parks = Array.from({ length: 15 }, (_, i) => place(i + 100, 'park'));
  const selected = shortlistPlaces([...museums, ...parks], ['nature']);
  assert.equal(selected.length, 12);
  assert.equal(selected.filter(place => place.category === 'park').length, 8);
  assert.equal(selected.filter(place => place.category === 'museum').length, 4);
  assert.deepEqual(shortlistPlaces(museums, []), museums.slice(0, 12));
});

test('personal candidates favour the selected starting point and do not duplicate the same object', () => {
  const nearOrigin = { ...place(100, 'park', 100), latitude: 50, longitude: 15 };
  const other = Array.from({ length: 12 }, (_, i) => place(i + 1, 'park', .1));
  const selected = shortlistPlaces([...other, nearOrigin, nearOrigin], ['nature'], { latitude: 50, longitude: 15 });
  assert.equal(selected[0].url, nearOrigin.url);
  assert.equal(new Set(selected.map(place => place.url)).size, selected.length);
});

test('published prominence still matters, while a remote highlight cannot outweigh every nearby alternative', () => {
  const local = { ...place(1, 'park', .1), prominence: 'local' };
  const highlight = { ...place(2, 'park', 2), prominence: 'highlight' };
  const remote = { ...place(3, 'park', 50), prominence: 'highlight' };
  assert.deepEqual(shortlistPlaces([local, remote, highlight], ['nature']).map(place => place.url), [highlight.url, local.url, remote.url]);
});

test('personal preferences persist globally, ignore corrupt data and retain unsaved changes across views', () => {
  const values = new Map(); let blocked = false;
  const storage = { getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { if (blocked) throw Error('Full'); values.set(key, value); } };
  assert.deepEqual(readInterests(storage).interests, []);
  assert.equal(saveInterests(['art', 'nature'], storage).saved, true);
  assert.deepEqual(JSON.parse(values.get(interestKey)), ['nature', 'art']);
  assert.deepEqual(readInterests(storage).interests, ['nature', 'art']);
  blocked = true;
  assert.equal(saveInterests(['museums'], storage).saved, false);
  assert.deepEqual(readInterests(storage), { interests: ['museums'], saved: false });
  blocked = false;
  saveInterests([], storage);
  assert.deepEqual(readInterests(storage).interests, []);
  values.set(interestKey, '{broken');
  assert.deepEqual(readInterests(storage).interests, []);
  saveInterests(['history'], undefined);
  assert.deepEqual(readInterests(undefined), { interests: ['history'], saved: false });
  saveInterests([], undefined);
});
