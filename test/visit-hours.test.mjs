import test from 'node:test';
import assert from 'node:assert/strict';
import { visitOpeningState } from '../src/opening-hours.mjs';
import { itineraryStop, itineraryStore } from '../src/itinerary.mjs';

const zone = 'Europe/Prague';
const at = time => Date.parse('2026-11-28T' + time + ':00+01:00');
test('checks the whole visit and allows departure exactly at closing time', () => {
  assert.equal(visitOpeningState('Sa 09:00-18:00', at('10:00'), at('11:00'), zone).state, 'fits');
  assert.equal(visitOpeningState('Sa 09:00-18:00', at('17:00'), at('18:00'), zone).state, 'fits');
  assert.equal(visitOpeningState('Sa 09:00-18:00', at('18:00'), at('19:00'), zone).state, 'closed-arrival');
  const closing = visitOpeningState('Sa 09:00-18:00', at('17:30'), at('18:30'), zone);
  assert.equal(closing.state, 'closes-during');
  assert.equal(closing.closedAt, at('18:00'));
  assert.equal(closing.availableMinutes, 30);
});
test('finds a break even when both arrival and departure are during opening hours', () => {
  const result = visitOpeningState('Sa 09:00-12:00,13:00-18:00', at('11:30'), at('14:00'), zone);
  assert.equal(result.state, 'break');
  assert.equal(result.closedAt, at('12:00'));
  assert.equal(result.reopensAt, at('13:00'));
  assert.equal(visitOpeningState('Sa 09:00-12:00,12:01-18:00', at('11:59'), at('12:02'), zone).state, 'break');
});
test('handles overnight visits and daylight-saving changes in the destination', () => {
  const overnight = visitOpeningState('Sa 22:00-02:00', at('23:30'), Date.parse('2026-11-29T01:00:00+01:00'), zone);
  assert.equal(overnight.state, 'fits');
  assert.equal(visitOpeningState('Su 00:00-04:00', Date.parse('2026-03-29T00:30Z'), Date.parse('2026-03-29T01:30Z'), zone).state, 'fits');
  assert.equal(visitOpeningState('Su 00:00-04:00', Date.parse('2026-10-25T00:00Z'), Date.parse('2026-10-25T02:30Z'), zone).state, 'unknown');
});
test('missing schedules, holiday rules, uncertain intervals and unknown arrival remain unverified', () => {
  for (const hours of [null, 'Sa 09:00-18:00; PH off', 'sunrise-sunset', 'by appointment']) {
    assert.equal(visitOpeningState(hours, at('10:00'), at('11:00'), zone).state, 'unknown');
  }
  assert.equal(visitOpeningState('Sa 09:00-12:00, Sa 12:00-13:00 unknown', at('11:30'), at('12:30'), zone).state, 'unknown');
  assert.equal(visitOpeningState('24/7', null, at('11:00'), zone).state, 'unknown-time');
});
test('refreshing saved hours preserves stop order and visit duration, and old stops stay readable', () => {
  const values = new Map();
  const store = itineraryStore(70, { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) });
  const item = { name: 'Museum', url: 'https://www.openstreetmap.org/node/1' };
  const stop = itineraryStop(item, 'place');
  store.add('2026-11-28', stop);
  store.duration('2026-11-28', stop.id, 90);
  const saved = store.add('2026-11-28', itineraryStop({ ...item, hours: 'Sa 10:00-18:00' }, 'place'));
  assert.equal(saved.stops.length, 1);
  assert.equal(saved.stops[0].duration, 90);
  assert.equal(store.read('2026-11-28').stops[0].hours, 'Sa 10:00-18:00');
});
