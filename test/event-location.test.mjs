import test from 'node:test';
import assert from 'node:assert/strict';
import { eventLocation } from '../src/event-location.mjs';
import { publishedEvents } from '../src/official-events.mjs';
import { findDayEvents } from '../src/day-agenda.mjs';

test('missing coordinates never become a marker at the equator', () => {
  assert.equal(eventLocation(null, null), undefined);
  assert.equal(eventLocation('', '14'), undefined);
  assert.equal(eventLocation(91, 14), undefined);
  assert.deepEqual(eventLocation('0', '0'), { latitude: 0, longitude: 0 });
});

test('a performance inherits published venue coordinates, while a different venue and online event do not', () => {
  const event = { '@type': 'MusicEvent', name: 'Concert', geos: [{ latitude: 48.2, longitude: 16.3 }],
    subEvent: [
      { '@type': 'Event', startDate: '2026-11-28T15:00Z' },
      { '@type': 'Event', startDate: '2026-11-29T15:00Z', location: { name: 'Elsewhere' } },
      { '@type': 'Event', startDate: '2026-11-30T15:00Z', eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode' },
    ] };
  const events = publishedEvents({ url: new URL('https://city.example/concert'), html:
    '<script type="application/ld+json">' + JSON.stringify(event) + '</script>' });
  assert.deepEqual(events[0].location, { latitude: 48.2, longitude: 16.3 });
  assert.equal(events[1].location, undefined);
  assert.equal(events[2].location, undefined);
});

test('OpenAgenda keeps a session without coordinates alongside a mapped session', async () => {
  const row = { uid: '1', title_fr: 'Market', canonicalurl: 'https://events.example/1', location_name: 'Square',
    timings: JSON.stringify([{ begin: '2026-11-28T10:00:00Z' }]), location_coordinates: { lat: 50, lon: 14 } };
  const { events } = await findDayEvents({ latitude: 50, longitude: 14, timezone: 'Europe/Prague' }, '2026-11-28', {
    fetchResponse: async () => Response.json([row, { ...row, uid: '2', title_fr: 'Walk', location_coordinates: null }]),
  });
  assert.deepEqual(events.find(e => e.title === 'Market').location, { latitude: 50, longitude: 14 });
  assert.equal(events.find(e => e.title === 'Walk').location, undefined);
});
