import test from 'node:test';
import assert from 'node:assert/strict';
import { eventState } from '../src/event-state.mjs';
import { localInstant } from '../src/opening-hours.mjs';

test('uses the destination time across midnight and treats ending time as exclusive', () => {
  const event = { start: Date.parse('2026-11-27T22:00Z'), end: Date.parse('2026-11-28T01:00Z') };
  assert.equal(eventState(event, localInstant('2026-11-27', '21:00', 'Europe/Prague')), 'upcoming');
  assert.equal(eventState(event, localInstant('2026-11-27', '22:00', 'Europe/Prague')), 'soon');
  assert.equal(eventState(event, localInstant('2026-11-27', '23:00', 'Europe/Prague')), 'ongoing');
  assert.equal(eventState(event, localInstant('2026-11-28', '01:00', 'Europe/Prague')), 'ongoing');
  assert.equal(eventState(event, localInstant('2026-11-28', '02:00', 'Europe/Prague')), 'ended');
});
test('missing times, indefinite duration and daylight-saving gaps remain unknown', () => {
  const start = Date.parse('2026-11-27T22:00Z');
  assert.equal(eventState({ start: null }, start), 'unknown');
  assert.equal(eventState({ start, end: null }, start + 1), 'unknown');
  assert.equal(eventState({ start, end: null }, start - 1), 'soon');
  assert.equal(eventState({ start }, localInstant('2026-03-29', '02:30', 'Europe/Prague')), 'unknown');
  assert.equal(eventState({ start }, localInstant('2026-10-25', '02:30', 'Europe/Prague')), 'unknown');
});
