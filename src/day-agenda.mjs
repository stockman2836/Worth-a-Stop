import { nearbyVenues, openAgendaDataset } from './sources.mjs';
import { eventLocation } from './event-location.mjs';

const isoDay = /^\d{4}-\d{2}-\d{2}$/;

function localDates(timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
}

export function todayIn(timeZone, now = new Date()) {
  return localDates(timeZone).format(now);
}

export function nextDate(day) {
  const date = new Date(day + 'T00:00:00Z');
  if (!isoDay.test(day) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day) {
    throw new Error('Invalid date.');
  }
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function instant(value) {
  // Never interpret an offset-less clock time in the browser's time zone.
  if (!/(Z|[+-]\d\d:\d\d)$/i.test(value)) throw new Error('Missing time zone.');
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error('Invalid event time.');
  return ms;
}

function slotOnDay({ begin, end }, day, dates) {
  if (isoDay.test(begin)) {
    if (end && (!isoDay.test(end) || end < begin)) throw new Error('Invalid date range.');
    if (begin > day || (day !== begin && (!end || day >= end))) return null;
    return { start: null, end: null, startsEarlier: false, endsLater: false };
  }
  const start = instant(begin);
  const finish = end ? instant(end) : start;
  if (finish < start) throw new Error('Invalid time range.');
  const first = dates.format(start);
  // A session ending at midnight belongs to the preceding day only.
  const last = dates.format(finish > start ? finish - 1 : start);
  if (first > day || last < day) return null;
  const endsLater = dates.format(finish) > day;
  const coversDay = endsLater && dates.format(start - 1) < day;
  return { start, end: finish > start ? finish : null, startsEarlier: first < day, endsLater, coversDay };
}

function parseField(value) {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function withOffset(value, offsets) {
  if (!value || !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?$/.test(value)) return value;
  const wall = Date.parse(value + 'Z');
  let guess = wall;
  for (let i = 0; i < 3; i++) {
    const zone = offsets.formatToParts(guess).find(p => p.type === 'timeZoneName').value;
    const offset = zone.slice(3) || '+00:00';
    const next = Date.parse(value + offset);
    if (next === guess) return value + offset;
    guess = next;
  }
  throw Error('Unresolvable local time');
}

export function officialOnDay(data, day, zone) {
  const dates = localDates(zone);
  const offsets = new Intl.DateTimeFormat('en', { timeZone: zone, timeZoneName: 'longOffset' });
  const events = [];
  let incomplete = data.incomplete;
  for (const event of data.events) {
    try {
      let { begin, end } = event;
      if (event.daily && end && begin.slice(0, 10) !== end.slice(0, 10)) {
        if (day < begin.slice(0, 10) || day > end.slice(0, 10)) continue;
        begin = day + begin.slice(10);
        end = day + end.slice(10);
      }
      if (isoDay.test(end)) end = nextDate(end); // Publication dates include the final day.
      const timing = slotOnDay({ begin: withOffset(begin, offsets), end: withOffset(end, offsets) }, day, dates);
      if (timing) events.push({ ...event, ...timing });
    } catch { incomplete = true; }
  }
  return { events, incomplete, ...(Array.isArray(data.sources) && { sources: data.sources }),
    ...(data.unavailable && { unavailable: true, retryAt: data.retryAt }) };
}

export function mergeListings(events) {
  const unique = [];
  const seen = new Set();
  const normalize = value => (value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  for (const event of events.toSorted((a, b) => Number(Boolean(b.begin)) - Number(Boolean(a.begin)))) {
    const place = normalize(event.venue);
    const keys = [JSON.stringify([event.url, normalize(event.title), event.start])];
    if (place) keys.push(JSON.stringify([place, normalize(event.title), event.start]));
    if (!keys.some(key => seen.has(key))) unique.push(event);
    for (const key of keys) seen.add(key);
  }
  return unique.sort((a,b) => (a.start ?? -Infinity) - (b.start ?? -Infinity) || a.title.localeCompare(b.title));
}

function eventsOnDay(rows, day, dates) {
  if (!Array.isArray(rows)) throw new Error('Invalid OpenAgenda export.');
  const events = new Map();
  let incomplete = false;
  for (const row of rows) {
    try {
      const status = parseField(row.status)?.id;
      const withdrawn = status === 4 || status === 6;
      const link = new URL(row.canonicalurl);
      const slots = parseField(row.timings);
      if (withdrawn && !slots?.length) continue;
      if (!['https:', 'http:'].includes(link.protocol) || !row.title_fr || !row.uid || !Array.isArray(slots) || !slots.length) {
        throw new Error('Incomplete event listing.');
      }
      for (const slot of slots) {
        let timing;
        try {
          timing = slotOnDay(slot, day, dates);
        } catch {
          incomplete = true;
          continue;
        }
        if (!timing) continue;
        // Syndicated copies can have different event IDs but share a venue, title and start.
        const identity = row.location_uid ? [row.location_uid, row.title_fr.trim().normalize().toLowerCase()] : [row.uid];
        const key = JSON.stringify([...identity, timing.start ?? slot.begin]);
        if (!events.has(key)) {
          const location = status === 3 ? undefined : eventLocation(row.location_coordinates?.lat, row.location_coordinates?.lon);
          events.set(key, withdrawn ? null : { title: row.title_fr, venue: row.location_name, url: link.href, status, ...timing,
            ...(location && { location }) });
        }
      }
    } catch {
      incomplete = true;
    }
  }
  return { events: [...events.values()].filter(Boolean).sort((a, b) =>
    (a.start ?? -Infinity) - (b.start ?? -Infinity) || a.title.localeCompare(b.title)), incomplete };
}

export async function findDayEvents(city, day, { signal, fetchResponse = fetch } = {}) {
  const next = nextDate(day);
  const timezone = city.timezone || 'UTC';
  const dates = localDates(timezone);
  async function nearby(radiusKm) {
    const url = new URL(openAgendaDataset + '/exports/json');
    url.search = new URLSearchParams({
      select: 'uid,title_fr,canonicalurl,location_uid,location_name,location_coordinates,timings,status',
      where: `${nearbyVenues(city, radiusKm)} AND firstdate_begin < date'${next}T00:00:00' AND lastdate_end >= date'${day}T00:00:00'`,
      order_by: 'updatedat desc,uid', timezone,
    });
    const timeout = AbortSignal.timeout(20_000);
    const response = await fetchResponse(url, { signal: signal ? AbortSignal.any([timeout, signal]) : timeout, cache: 'no-cache' });
    if (!response.ok) throw new Error(`OpenAgenda returned HTTP ${response.status}.`);
    return { ...eventsOnDay(await response.json(), day, dates), radiusKm };
  }
  const inner = await nearby(5);
  if (inner.events.length) return inner;
  return nearby(25);
}
