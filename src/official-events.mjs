import { load } from 'cheerio';
import { officialCalendars, page } from './official-calendars.mjs';
import { eventLocation } from './event-location.mjs';
import { readNuxtData } from './embedded-data.mjs';
import { microdataEvents, calendarCardEvents } from './html-events.mjs';

function embeddedEvents($, base) {
  const links = $('a[href]').toArray().map(anchor => linkedPage($(anchor).attr('href'), base)).filter(Boolean);
  const events = new Map();
  let remaining = 100000;
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (--remaining < 0) throw Error('Embedded event limit exceeded');
    if (typeof value.start_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.start_date) &&
        typeof value.title === 'string') {
      const slugs = [value.slug, value.slug_en, value.slug_sk, value.slug_pl, value.slug_hu].filter(Boolean);
      const link = [base, ...links].find(url => slugs.includes(url.pathname.replace(/\/$/, '').split('/').pop()));
      if (link) {
        const single = !value.end_date || value.end_date === value.start_date;
        const clock = typeof value.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value.time) ? value.time : null;
        const location = eventLocation(value.google_place?.lat, value.google_place?.lng);
        events.set(link.href, { title: load(value.title).text(), url: link.href,
          venue: value.google_place?.name, begin: value.start_date + (single && clock ? 'T' + clock + ':00' : ''),
          ...(single ? {} : { end: value.end_date, publishedTime: value.time }),
          ...(location && { location }) });
      }
    }
    for (const item of Object.values(value)) if (item && typeof item === 'object') visit(item);
  }
  for (const script of $('script').toArray()) {
    const source = $(script).text();
    if (!source.includes('window.__NUXT__')) continue;
    try { visit(readNuxtData(source)); } catch { /* Unsupported payloads can use other published formats. */ }
  }
  return [...events.values()];
}

function linkedPage(value, base) {
  if (!value || !URL.canParse(value, base)) return null;
  const url = new URL(value, base);
  return url.origin === base.origin && !url.username && !url.password ? url : null;
}

function schemaEvents(node, base, out, parent = {}) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) schemaEvents(child, base, out, parent);
    return;
  }
  if (node['@graph']) schemaEvents(node['@graph'], base, out);
  if (node.itemListElement) schemaEvents(node.itemListElement, base, out);
  if (node.item) schemaEvents(node.item, base, out);
  if (![].concat(node['@type'] || []).some(type => /Event$/.test(type))) return;
  if (/Event(Cancelled|Postponed)$/.test(node.eventStatus)) return;
  const geo = node.location?.geo || node.geos?.[0] || node.geo;
  const online = /OnlineEventAttendanceMode$/.test(node.eventAttendanceMode);
  const location = online ? undefined : geo ? eventLocation(geo.latitude, geo.longitude) : node.location ? undefined : parent.location;
  const listing = {
    title: node.name || parent.title,
    venue: node.location?.name || node.addresses?.[0]?.name || parent.venue,
    url: linkedPage(node.url, base)?.href || parent.url || base.href,
    ...(location && { location }),
  };
  if (node.subEvent?.length || node.subEvent?.startDate) {
    schemaEvents(node.subEvent, base, out, listing);
  } else if (listing.title && node.startDate && !node.eventSchedule) {
    out.push({ ...listing, begin: node.startDate, end: node.endDate });
  }
}

function portalDate(value) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})(?: (\d{2}:\d{2}))?$/.exec(value);
  return match && match[3] + '-' + match[2] + '-' + match[1] + (match[4] ? 'T' + match[4] : '');
}

export function publishedEvents({ html, url }) {
  const $ = load(html);
  const events = [];
  for (const script of $('script[type="application/ld+json"]').toArray()) {
    let json;
    try { json = JSON.parse($(script).text()); } catch { continue; }
    schemaEvents(json, url, events);
  }
  events.push(...microdataEvents($, url));
  if (events.length) return events;
  events.push(...embeddedEvents($, url));
  if (events.length) return events;
  const title = $('h1').first().text().trim();
  const venue = $('.article-head__top').parent().find('p a[href*="/objevujte/"]').first().text().trim();
  for (const el of $('[data-date_list]').toArray()) {
    const dates = JSON.parse($(el).attr('data-date_list'));
    for (const entry of dates.flat()) {
      const begin = portalDate(entry.start);
      const end = portalDate(entry.end);
      if (!begin || !title) continue;
      const daily = /,\s*\d{1,2}:\d{2}\s*[–—-]\s*\d{1,2}:\d{2}/.test(entry.format);
      const hasTime = /\d:\d{2}/.test(entry.format);
      events.push({ title, venue, url: url.href, begin: hasTime ? begin : begin.slice(0, 10),
        end: hasTime ? end : end?.slice(0, 10), daily });
    }
  }
  return events;
}

export function calendarPageLinks(document) {
  const $ = load(document.html);
  const prefix = document.url.pathname.replace(/\/(?:categories?|kategorie(?:-podujati)?)\/.*$/, '/').replace(/\/?$/, '/');
  const next = new Set();
  const details = new Set();
  const anchors = $('main, article, [role="main"]').length ? $('main a[href], article a[href], [role="main"] a[href]') : $('a[href]');
  for (const el of $('link[rel~="next"][href], a[rel~="next"][href]').toArray()) {
    const url = linkedPage($(el).attr('href'), document.url);
    if (url) { url.hash = ''; next.add(url.href); }
  }
  for (const el of anchors.toArray()) {
    const anchor = $(el);
    if (anchor.closest('nav:not(.pagination), header, footer').length) continue;
    const url = linkedPage(anchor.attr('href'), document.url);
    if (!url) continue;
    url.hash = '';
    if (anchor.is('.next, .next-page') || /^(next|next page|ďalšia|ďalej|další|weiter|suivant|siguiente|следующая)(?:\s*[→»›])?$/iu.test(anchor.text().trim())) {
      next.add(url.href);
      continue;
    }
    const datedCard = anchor.find('h2,h3,h4').length && anchor.find('time[datetime], .date, [itemprop~="startDate"]').length;
    if ((!datedCard && (!url.pathname.startsWith(prefix) || url.pathname.length <= prefix.length || url.search)) ||
        /\/(?:categor(?:y|ies)|kategorie[^/]*|tag|page)\//i.test(url.pathname) ||
        /\.(?:pdf|jpe?g|png|webp|ics|zip)$/i.test(url.pathname)) continue;
    details.add(url.href);
  }
  return { next: [...next], details: [...details] };
}

export async function collectCalendar(calendar, { readPage = page, maxPages = 24 } = {}) {
  const queue = [{ url: calendar, index: true }];
  const seen = new Set([calendar]);
  const events = new Map();
  let pagesRead = 0, failedPages = 0, indexes = 0, limited = false;
  while (queue.length && pagesRead < maxPages) {
    const batch = queue.splice(0, Math.min(3, maxPages - pagesRead));
    pagesRead += batch.length;
    const results = await Promise.allSettled(batch.map(async job => ({ job, document: await readPage(new URL(job.url)) })));
    for (const result of results) {
      if (result.status === 'rejected') { failedPages++; continue; }
      const { job, document } = result.value;
      let parsed;
      try { parsed = publishedEvents(document); } catch { failedPages++; continue; }
      if (job.index) {
        const cards = calendarCardEvents(load(document.html), document.url);
        const known = new Set(parsed.map(event => event.url));
        parsed.push(...cards.filter(event => !known.has(event.url)));
      }
      for (const event of parsed) events.set(JSON.stringify([event.url, event.title, event.begin]), event);
      if (!job.index) continue;
      indexes++;
      const links = calendarPageLinks(document);
      for (const href of links.next) {
        if (seen.has(href)) continue;
        seen.add(href);
        if (indexes + queue.filter(item => item.index).length >= 4) { limited = true; continue; }
        queue.unshift({ url: href, index: true });
      }
      for (const href of links.details) {
        if (!seen.has(href)) { seen.add(href); queue.push({ url: href, index: false }); }
      }
    }
  }
  limited ||= queue.length > 0;
  return { events: [...events.values()], incomplete: limited || failedPages > 0 || !events.size,
    source: { url: calendar, pagesRead, failedPages, eventsFound: events.size, limited } };
}

const cache = new Map();
export async function officialEvents(id, { refresh = false } = {}) {
  const saved = cache.get(id);
  if (!refresh && saved?.expires > Date.now()) return saved.promise;
  const promise = (async () => {
    const calendars = await officialCalendars(id, refresh ? {} : undefined);
    const results = await Promise.allSettled(calendars.map(calendar => collectCalendar(calendar)));
    return { events: results.flatMap(r => r.status === 'fulfilled' ? r.value.events : []),
      sources: results.map((r, index) => r.status === 'fulfilled' ? r.value.source :
        { url: calendars[index], pagesRead: 0, failedPages: 1, eventsFound: 0, limited: false }),
      incomplete: !calendars.length || results.some(r => r.status === 'rejected' || r.value.incomplete) };
  })();
  if (cache.size >= 40) cache.delete(cache.keys().next().value);
  cache.set(id, { expires: Date.now() + 600000, promise });
  try { return await promise; } catch (error) { if (cache.get(id)?.promise === promise) cache.delete(id); throw error; }
}
