import test from 'node:test';
import assert from 'node:assert/strict';
import { arrivalTimes } from '../src/arrival-times.mjs';
import { localInstant } from '../src/opening-hours.mjs';

const start = Date.parse('2026-11-28T11:00:00Z');
const museum = { id: 'museum', type: 'place', duration: 60 };
const concert = { id: 'concert', type: 'event', start: start + 3 * 3600000, end: start + 4 * 3600000 };
const park = { id: 'park', type: 'place', duration: 30 };
function leg(from, to, duration = 600) { return { from, to, status: 'ok', duration }; }

test('adds visits and walking time, waits for a fixed event and resumes at its published end', () => {
  const times = arrivalTimes([museum, concert, park], [leg(museum, concert), leg(concert, park)], start);
  assert.equal(times[0].arrival, start);
  assert.equal(times[0].departure, start + 3600000);
  assert.equal(times[1].waiting, 110);
  assert.equal(times[1].departure, concert.end);
  assert.equal(times[2].arrival, concert.end + 600000);
  assert.equal(times[2].departure, concert.end + 2400000);
});
test('rounds walking estimates up to displayed minutes and carries dates across midnight and DST', () => {
  const first = { ...museum, duration: 30 };
  const midnight = localInstant('2026-11-28', '23:40', 'Europe/Prague');
  const times = arrivalTimes([first, park], [leg(first, park, 149.6)], midnight);
  assert.equal(times[1].arrival, Date.parse('2026-11-28T23:13:00Z'));
  const spring = localInstant('2026-03-29', '01:30', 'Europe/Prague');
  assert.equal(arrivalTimes([museum], [], spring)[0].departure, Date.parse('2026-03-29T01:30Z'));
});
test('missing durations and failed or obsolete legs block downstream arrival estimates', () => {
  assert.equal(arrivalTimes([{ ...museum, duration: null }, concert], [leg(museum, concert)], start)[1].arrival, null);
  assert.equal(arrivalTimes([museum, concert], [], start)[1].reason, 'walking-leg');
  assert.equal(arrivalTimes([museum, park], [leg(museum, concert)], start)[1].arrival, null);
  assert.equal(arrivalTimes([museum], [], undefined)[0].reason, 'start-time');
});
test('lateness keeps a published end, while a missed event or unknown end blocks the following stop', () => {
  const late = arrivalTimes([concert], [], concert.start + 300000)[0];
  assert.equal(late.late, 5);
  assert.equal(late.departure, concert.end);
  const missed = arrivalTimes([concert, park], [leg(concert, park)], concert.end);
  assert.equal(missed[0].reason, 'event-ended');
  assert.equal(missed[1].arrival, null);
  const indefinite = arrivalTimes([{ ...concert, end: null }, park], [leg(concert, park)], start);
  assert.equal(indefinite[0].reason, 'event-end');
  assert.equal(indefinite[1].arrival, null);
  assert.equal(arrivalTimes([{ ...concert, start: null }], [], start)[0].reason, 'event-time');
});
