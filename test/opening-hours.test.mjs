import test from 'node:test';
import assert from 'node:assert/strict';
import { openingState, localClock } from '../src/opening-hours.mjs';

const zone = 'Europe/Prague';
test('evaluates weekends, split intervals and closing boundaries', () => {
  const hours = 'Mo-Fr 09:00-12:00,13:00-18:00; Sa 10:00-14:00; Su off';
  assert.equal(openingState(hours, '2026-11-27', '10:00', zone), 'open');
  assert.equal(openingState(hours, '2026-11-27', '12:00', zone), 'closed');
  assert.equal(openingState(hours, '2026-11-28', '13:59', zone), 'open');
  assert.equal(openingState(hours, '2026-11-28', '14:00', zone), 'closed');
  assert.equal(openingState(hours, '2026-11-29', '11:00', zone), 'closed');
});
test('handles overnight hours and a destination in a different time zone', () => {
  assert.equal(openingState('Fr 22:00-02:00', '2026-11-28', '01:00', 'Asia/Tokyo'), 'open');
  assert.equal(openingState('Fr 22:00-02:00', '2026-11-28', '02:00', 'Asia/Tokyo'), 'closed');
  assert.equal(localClock('Asia/Tokyo', new Date('2026-11-26T16:30Z')), '01:30');
});
test('unknown data, holidays and invalid or nonexistent times remain unknown', () => {
  for (const hours of [undefined, '', 'by appointment', 'Mo-Fr 09:00-18:00; PH off', 'sunrise-sunset', '10:00+']) {
    assert.equal(openingState(hours, '2026-11-27', '23:00', zone), 'unknown');
  }
  assert.equal(openingState('24/7', '2026-02-30', '10:00', zone), 'unknown');
  assert.equal(openingState('24/7', '2026-03-29', '02:30', zone), 'unknown');
  assert.equal(openingState('24/7', '2026-11-27', '25:00', zone), 'unknown');
  assert.equal(openingState('24/7', '2026-11-27', '10:00', zone), 'open');
});
