import test from 'node:test';
import assert from 'node:assert/strict';
import { checkTripWindow } from '../src/trip-window.mjs';

test('checks the final departure against the destination-local deadline and rounds overruns up', () => {
  const check = finish => checkTripWindow('2026-11-27', '09:00', '10:00', 'Europe/Budapest', finish);
  assert.deepEqual(check(Date.parse('2026-11-27T09:00Z')), { state: 'fits', minutes: 0 });
  assert.deepEqual(check(Date.parse('2026-11-27T08:45Z')), { state: 'fits', minutes: 15 });
  assert.deepEqual(check(Date.parse('2026-11-27T09:00:01Z')), { state: 'overrun', minutes: 1 });
  assert.deepEqual(check(Date.parse('2026-11-28T08:00Z')), { state: 'overrun', minutes: 1380 });
});

test('missing and incomplete schedules never claim that a trip fits', () => {
  assert.equal(checkTripWindow('2026-11-27', '09:00', '', 'Europe/Budapest', null).state, 'unset');
  assert.equal(checkTripWindow('2026-11-27', '', '10:00', 'Europe/Budapest', null).state, 'missing-start');
  assert.equal(checkTripWindow('2026-11-27', '09:00', '10:00', 'Europe/Budapest', null).state, 'unknown-finish');
});

test('requires a later same-day deadline and rejects ambiguous or nonexistent local times', () => {
  assert.equal(checkTripWindow('2026-11-27', '10:00', '09:00', 'Europe/Budapest', 1).state, 'end-before-start');
  assert.equal(checkTripWindow('2026-11-27', '09:00', '09:00', 'Europe/Budapest', 1).state, 'end-before-start');
  assert.equal(checkTripWindow('2026-03-29', '01:00', '02:30', 'Europe/Budapest', 1).state, 'invalid-time');
  assert.equal(checkTripWindow('2026-10-25', '02:30', '04:00', 'Europe/Budapest', 1).state, 'invalid-time');
});

test('uses actual destination offsets on the day of a daylight-saving transition', () => {
  assert.deepEqual(checkTripWindow('2026-03-29', '01:00', '04:00', 'Europe/Budapest', Date.parse('2026-03-29T01:30Z')),
    { state: 'fits', minutes: 30 });
});
