import ICAL from 'ical.js';

function calendarTime(property, calendarZone) {
  if (!property) return null;
  const value = property.getFirstValue();
  if (!(value instanceof ICAL.Time)) throw new Error(`Invalid calendar date in ${property.name}.`);
  const timestamp = value.toString();
  // ICAL.Time can roll an impossible date forward. Compare with the published jCal value.
  if (timestamp !== property.toJSON()[3]) throw new Error(`Invalid calendar date in ${property.name}.`);
  const date = timestamp.slice(0, 10);
  if (value.isDate) return { date, time: null, timezone: null };

  const timezone = timestamp.endsWith('Z') ? 'UTC' : property.getParameter('tzid') ?? calendarZone;
  return { date, time: timestamp.slice(11, 19), timezone };
}

function eventLink(value, sourceUrl) {
  if (value && URL.canParse(value, sourceUrl)) {
    const url = new URL(value, sourceUrl);
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
  }
  return sourceUrl;
}

function readEvents(text, sourceUrl) {
  const calendar = new ICAL.Component(ICAL.parse(text.trim()));
  if (calendar.name !== 'vcalendar') throw new Error('Expected an iCalendar (VCALENDAR) feed.');

  const zone = calendar.getFirstPropertyValue('x-wr-timezone');
  const cancelled = calendar.getFirstPropertyValue('method')?.toUpperCase() === 'CANCEL';
  return calendar.getAllSubcomponents('vevent').map(component => {
    const uid = component.getFirstPropertyValue('uid');
    const start = calendarTime(component.getFirstProperty('dtstart'), zone);
    const status = cancelled ? 'CANCELLED' : component.getFirstPropertyValue('status');
    if (!uid || (!start && status !== 'CANCELLED')) {
      throw new Error('Calendar event is missing its UID or start date.');
    }
    return {
      uid,
      title: component.getFirstPropertyValue('summary'),
      location: component.getFirstPropertyValue('location'),
      start,
      end: calendarTime(component.getFirstProperty('dtend'), zone),
      duration: component.getFirstPropertyValue('duration')?.toString() ?? null,
      status,
      url: eventLink(component.getFirstPropertyValue('url'), sourceUrl),
      recurring: component.hasProperty('rrule') || component.hasProperty('rdate'),
      recurrenceId: calendarTime(component.getFirstProperty('recurrence-id'), zone),
    };
  });
}

export async function importCalendar(source, fetchResponse = fetch) {
  const url = new URL(source);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Use an HTTP or HTTPS calendar URL.');
  }
  const response = await fetchResponse(url, {
    headers: { Accept: 'text/calendar, application/octet-stream;q=0.8, */*;q=0.1' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Calendar source returned HTTP ${response.status}.`);

  const sourceUrl = response.url || url.href;
  const events = readEvents(await response.text(), sourceUrl);
  return { sourceUrl, checkedAt: new Date().toISOString(), events };
}
