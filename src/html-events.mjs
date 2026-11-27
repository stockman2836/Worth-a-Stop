import { eventLocation } from './event-location.mjs';

function calendarDates(language) {
  const normalize = value => value.normalize('NFKD').replace(/[\p{M}.]/gu, '').toLowerCase().trim();
  const months = new Map();
  for (let month = 0; month < 12; month++) {
    for (const style of ['long', 'short', 'numeric']) {
      const formatter = new Intl.DateTimeFormat(language, { day: 'numeric', month: style, year: 'numeric', timeZone: 'UTC' });
      const name = formatter.formatToParts(new Date(Date.UTC(2026, month, 15))).find(part => part.type === 'month').value;
      months.set(normalize(name), month + 1);
    }
  }
  const order = new Intl.DateTimeFormat(language, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    .formatToParts(new Date(Date.UTC(2026, 0, 15))).map(part => part.type).filter(type => ['year', 'month', 'day'].includes(type));
  const pattern = order.map(type => type === 'month' ? '(.+?)' : type === 'year' ? '(\\d{4})' : '(\\d{1,2})').join('[\\s.,/年月日-]+');
  const expression = new RegExp('^' + pattern + '[.日]?$', 'iu');
  return text => {
    if (/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(text)) return text.slice(0, 10);
    const match = expression.exec(text);
    if (!match) return null;
    const parts = Object.fromEntries(order.map((type, index) => [type, match[index + 1]]));
    const month = months.get(normalize(parts.month));
    return month ? `${parts.year}-${String(month).padStart(2, '0')}-${parts.day.padStart(2, '0')}` : null;
  };
}

// Only call on a discovered calendar index, where a dated linked card denotes a listing.
export function calendarCardEvents($, base) {
  const language = $('html').attr('lang')?.replace('_', '-') || 'en';
  let readDate;
  try { readDate = calendarDates(language); } catch { return []; }
  const events = [];
  for (const el of $('a[href]').toArray()) {
    const card = $(el);
    if (card.closest('header, footer, nav').length) continue;
    const title = card.find('h2,h3,h4').first().text().trim();
    const date = card.find('time[datetime], .date').first();
    const href = card.attr('href');
    if (!title || !date.length || !URL.canParse(href, base)) continue;
    const url = new URL(href, base);
    if (url.origin !== base.origin || url.username || url.password) continue;
    try {
      const day = readDate(date.attr('datetime') || date.text().replace(/\s+/g, ' ').trim());
      if (!day || new Date(day).toISOString().slice(0, 10) !== day) continue;
      const clock = /^(?:[01]?\d|2[0-3]):[0-5]\d$/;
      const published = card.find('.times').first().text().trim();
      const time = /^([\d:]+)(?:\s*[–—-]\s*([\d:]+))?(?:\s*(?:Uhr|h))?$/.exec(published);
      const begin = time && clock.test(time[1]) ? day + 'T' + time[1].padStart(5, '0') + ':00' : date.attr('datetime') || day;
      const end = time?.[2] && clock.test(time[2]) && time[2].padStart(5, '0') > time[1].padStart(5, '0') ? day + 'T' + time[2].padStart(5, '0') + ':00' : undefined;
      events.push({ title, url: url.href, begin, ...(end && { end }) });
    } catch { /* An unknown language or date format remains unparsed. */ }
  }
  return events;
}

// Some calendars publish a heading link and a separate year-first date/time/venue row.
export function calendarRowEvents($, base) {
  const events = [];
  for (const el of $('h2 a[href], h3 a[href]').toArray()) {
    const link = $(el), title = link.text().trim();
    const row = link.closest('article, li, aside, .event, .event-item');
    const fields = row.children('span, time, p').toArray().map(field => $(field).text().replace(/\s+/g, ' ').trim());
    const stamp = fields.map(text => /^(\d{4})[./-](\d{2})[./-](\d{2})\.?\s+((?:[01]\d|2[0-3]):[0-5]\d)(?:\s*[–—-]\s*((?:[01]\d|2[0-3]):[0-5]\d))?\s*\|\s*(.+)$/.exec(text)).find(Boolean);
    const href = link.attr('href');
    if (!stamp || !title || !URL.canParse(href, base)) continue;
    const url = new URL(href, base);
    if (url.origin !== base.origin || url.username || url.password) continue;
    const day = `${stamp[1]}-${stamp[2]}-${stamp[3]}`;
    const begin = day + 'T' + stamp[4] + ':00';
    const end = stamp[5] && stamp[5] > stamp[4] ? day + 'T' + stamp[5] + ':00' : undefined;
    if (!Number.isFinite(Date.parse(begin + 'Z')) || new Date(begin + 'Z').toISOString().slice(0, 10) !== day) continue;
    events.push({ title, url: url.href, begin, venue: stamp[6], ...(end && { end }) });
  }
  return events;
}

// Read only explicitly declared event properties, never article publication dates.
export function microdataEvents($, base) {
  function property(scope, name) {
    return scope.find(`[itemprop~="${name}"]`).filter((_, el) =>
      $(el).parents('[itemscope]').first()[0] === scope[0]).first();
  }
  function value(scope, name) {
    const el = property(scope, name);
    return el.attr('content') ?? el.attr('datetime') ?? el.attr('href') ?? el.text().trim();
  }
  const events = [];
  for (const el of $('[itemscope][itemtype]').toArray()) {
    const scope = $(el);
    if (!scope.attr('itemtype').split(/\s+/).some(type => /^https?:\/\/schema.org\/\w*Event$/.test(type))) continue;
    if (/Event(Cancelled|Postponed)$/.test(value(scope, 'eventStatus'))) continue;
    const title = value(scope, 'name');
    const begin = value(scope, 'startDate');
    if (!title || !begin) continue;
    const locationScope = property(scope, 'location');
    const geo = property(locationScope, 'geo');
    const latitude = value(geo, 'latitude');
    const longitude = value(geo, 'longitude');
    const online = /OnlineEventAttendanceMode$/.test(value(scope, 'eventAttendanceMode'));
    const location = !online && latitude && longitude && eventLocation(Number(latitude), Number(longitude));
    const href = value(scope, 'url');
    const url = href && URL.canParse(href, base) ? new URL(href, base) : base;
    const venueText = locationScope.clone();
    venueText.find('[itemscope]').remove();
    events.push({ title, begin, end: value(scope, 'endDate') || undefined,
      url: url.origin === base.origin && !url.username && !url.password ? url.href : base.href,
      venue: value(locationScope, 'name') || venueText.text().trim() || undefined,
      ...(location && { location }) });
  }
  return events;
}
