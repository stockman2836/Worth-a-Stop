import assert from 'node:assert/strict';
import test from 'node:test';
import { findDayEvents, nextDate, todayIn } from '../src/day-agenda.mjs';

const city = { latitude: 47.2, longitude: -1.55, timezone: 'Europe/Paris' };
const day = '2026-11-21';
const morning = { begin: day + 'T10:00:00+01:00', end: day + 'T11:00:00+01:00' };

function listing(title, slots, extra = {}) {
  return {
    uid: title, title_fr: title, canonicalurl: 'https://events.example/show',
    location_uid: '10', location_name: 'Town Hall', status: '{"id":1}', timings: JSON.stringify(slots), ...extra,
  };
}

function lookup(rows, date = day, place = city) {
  return findDayEvents(place, date, { fetchResponse: async () => Response.json(rows) });
}

test('Today follows the city, and Tomorrow advances a calendar date across DST and year changes', () => {
  const instant = new Date('2026-12-31T17:00:00Z');
  assert.equal(todayIn('Asia/Tokyo', instant), '2027-01-01');
  assert.equal(todayIn('America/Vancouver', instant), '2026-12-31');
  assert.equal(nextDate('2026-12-31'), '2027-01-01');
  assert.equal(nextDate('2026-03-29'), '2026-03-30');
  assert.throws(() => nextDate('2026-02-30'));
});

test('includes overlapping sessions, floating dates and point events, excluding the midnight end and gaps in a series', async () => {
  const friday = '2026-11-20';
  const sunday = '2026-11-22';
  const { events, radiusKm } = await lookup([
    listing('Fair', [{ begin: friday + 'T12:00:00+01:00', end: sunday + 'T16:00:00+01:00' }]),
    listing('Opens at midnight', [{ begin: day + 'T00:00:00+01:00', end: sunday + 'T00:00:00+01:00' }]),
    listing('Overnight', [{ begin: friday + 'T22:30:00Z', end: day + 'T01:00:00Z' }]),
    listing('Film', [morning, { begin: day + 'T17:00:00Z' }]),
    listing('Date announced', [{ begin: day }]),
    listing('Midnight finish', [{ begin: friday + 'T16:00:00Z', end: friday + 'T23:00:00Z' }]),
    listing('Date-only end', [{ begin: friday, end: day }]),
    listing('No Saturday show', [{ begin: friday + 'T12:00:00Z' }, { begin: sunday + 'T12:00:00Z' }]),
  ]);
  assert.equal(radiusKm, 5);
  assert.deepEqual(events.map(e => e.title), ['Date announced', 'Fair', 'Overnight', 'Opens at midnight', 'Film', 'Film']);
  assert.equal(events[0].start, null);
  assert.ok(events[1].coversDay && events[3].coversDay);
  assert.ok(events[2].startsEarlier && !events[2].endsLater);
  assert.equal(events.at(-1).end, null);
});

test('handles both instances of a repeated clock hour and local midnight on a 25-hour day', async () => {
  const { events } = await lookup([listing('Evening', [
    { begin: '2026-10-24T22:00:00Z' }, { begin: '2026-10-25T02:30:00+02:00' },
    { begin: '2026-10-25T02:30:00+01:00' }, { begin: '2026-10-25T22:45:00Z' }, { begin: '2026-10-25T23:00:00Z' },
  ])], '2026-10-25');
  assert.equal(events.length, 4);
  assert.equal(events[2].start - events[1].start, 3_600_000);
});

test('keeps the latest publication for a session, suppresses withdrawn sessions and retains other performances', async () => {
  const { events } = await lookup([
    listing('Fair', [morning], { uid: 'new', canonicalurl: 'https://events.example/new' }),
    listing('Fair', [morning], { uid: 'reprint' }),
    listing('Talk', [morning], { status: '{"id":6}' }),
    listing('Talk', [morning], { uid: 'archived-reprint' }),
    listing('Postponed', [morning], { status: '{"id":4}' }),
    listing('Recital', [morning], { status: '{"id":5}' }),
    listing('Fair', [morning], { location_uid: '11' }),
  ]);
  assert.deepEqual(events.map(e => e.title), ['Fair', 'Fair', 'Recital']);
  assert.equal(events[0].url, 'https://events.example/new');
  assert.equal(events[2].status, 5);
});

test('widens the search only after checking actual sessions and queries both city-local day boundaries', async () => {
  const radii = [];
  const result = await findDayEvents(city, day, { fetchResponse: async url => {
    const where = url.searchParams.get('where');
    assert.equal(url.searchParams.get('timezone'), 'Europe/Paris');
    assert.ok(where.includes("firstdate_begin < date'2026-11-22T00:00:00'"));
    assert.ok(where.includes("lastdate_end >= date'2026-11-21T00:00:00'"));
    radii.push(where.match(/,(\d+)km\)/)[1]);
    return Response.json(radii.length === 1 ? [listing('Weekly', [{ begin: '2026-11-25T12:00:00Z' }])] : [listing('Market', [morning])]);
  } });
  assert.deepEqual(radii, ['5', '25']);
  assert.equal(result.radiusKm, 25);
  assert.equal(result.events[0].title, 'Market');
});

test('distinguishes an empty day, a partial response and a provider outage', async () => {
  assert.deepEqual(await lookup([]), { events: [], radiusKm: 25, incomplete: false });
  const partial = await lookup([listing('Fair', [{ begin: 'broken' }, morning]), listing('Bad link', [morning], { canonicalurl: 'javascript:void(0)' })]);
  assert.equal(partial.incomplete, true);
  assert.equal(partial.events.length, 1);
  await assert.rejects(lookup({}), /export/);
  await assert.rejects(findDayEvents(city, day, { fetchResponse: async () => new Response(null, { status: 503 }) }), /503/);
});
