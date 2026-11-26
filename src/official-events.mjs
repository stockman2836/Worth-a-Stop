import { load } from 'cheerio';
import { officialCalendars, page } from './official-calendars.mjs';

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
  const listing = {
    title: node.name || parent.title,
    venue: node.location?.name || node.addresses?.[0]?.name || parent.venue,
    url: linkedPage(node.url, base)?.href || parent.url || base.href,
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

async function collect(calendar) {
  const index = await page(new URL(calendar));
  const events = publishedEvents(index);
  if (events.length) return { events, incomplete: false };
  const $ = load(index.html);
  const prefix = index.url.pathname.replace(/\/?$/, '/');
  const links = new Set();
  for (const el of $('main a[href], article a[href]').toArray()) {
    const url = linkedPage($(el).attr('href'), index.url);
    if (url && url.pathname.startsWith(prefix) && url.pathname.length > prefix.length && !url.search) {
      url.hash = '';
      links.add(url.href);
    }
  }
  // Read the first twelve detail pages, three at a time, from the public listing.
  const urls = [...links].slice(0, 12);
  let failed = false;
  for (let i = 0; i < urls.length; i += 3) {
    const group = await Promise.allSettled(urls.slice(i, i + 3).map(async link => publishedEvents(await page(new URL(link)))));
    for (const result of group) {
      if (result.status === 'fulfilled') events.push(...result.value);
      else failed = true;
    }
  }
  return { events, incomplete: failed || links.size > urls.length || !events.length };
}

const cache = new Map();
export async function officialEvents(id) {
  const saved = cache.get(id);
  if (saved?.expires > Date.now()) return saved.promise;
  const promise = (async () => {
    const calendars = await officialCalendars(id);
    const results = await Promise.allSettled(calendars.map(collect));
    if (results.length && results.every(r => r.status === 'rejected')) throw Error('Calendars unavailable');
    return { events: results.flatMap(r => r.status === 'fulfilled' ? r.value.events : []),
      incomplete: results.some(r => r.status === 'rejected' || r.value.incomplete) };
  })();
  if (cache.size >= 40) cache.delete(cache.keys().next().value);
  cache.set(id, { expires: Date.now() + 600000, promise });
  try { return await promise; } catch (error) { if (cache.get(id)?.promise === promise) cache.delete(id); throw error; }
}
