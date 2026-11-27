import test from 'node:test';
import assert from 'node:assert/strict';
import { discoveryIndex } from '../src/discovery-index.mjs';

test('clusters a crowded city while preserving every place and event and their separate counts', () => {
  const items = Array.from({ length: 2000 }, (_, index) => ({ key: 'item:' + index, kind: index < 1200 ? 'place' : 'event',
    latitude: 48.85 + index % 25 / 10000, longitude: 2.35 + index % 40 / 10000 }));
  const index = discoveryIndex(items);
  const groups = index.visible([-180, -85, 180, 85], 10);
  assert.equal(groups.length, 1);
  const group = groups[0].properties;
  assert.equal(group.point_count, 2000); assert.equal(group.places, 1200); assert.equal(group.events, 800);
  const found = [];
  for (let offset = 0; offset < group.point_count; offset += 20) found.push(...index.members(group.cluster_id, offset));
  assert.deepEqual(new Set(found.map(item => item.key)), new Set(items.map(item => item.key)));
  assert.ok(index.visible([-180, -85, 180, 85], 19).length > 1);
});

test('keeps coincident sessions accessible as a group at the largest map zoom', () => {
  const items = Array.from({ length: 100 }, (_, n) => ({ key: 'event:' + n, kind: 'event', latitude: 48.85, longitude: 2.35 }));
  const index = discoveryIndex(items), group = index.visible([-180, -85, 180, 85], 19)[0];
  assert.equal(group.properties.point_count, 100);
  assert.ok(index.expansionZoom(group.properties.cluster_id) > 19);
  assert.equal(index.members(group.properties.cluster_id, 80).length, 20);
});

test('a filtered index counts only supplied items and returns nothing outside the viewport', () => {
  const item = { key: 'place:1', kind: 'place', latitude: 48.85, longitude: 2.35 };
  const index = discoveryIndex([item]);
  assert.deepEqual(index.visible([10, 10, 20, 20], 15), []);
  assert.deepEqual(index.item(index.visible([-180, -85, 180, 85], 15)[0]), item);
});
