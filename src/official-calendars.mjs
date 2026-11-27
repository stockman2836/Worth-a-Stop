import https from 'node:https';
import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import { load } from 'cheerio';
import { cityWebsites } from './city-websites.mjs';

function website(value) {
  if (!URL.canParse(value)) return null;
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return null;
  url.protocol = 'https:';
  return url;
}

// Resolve each redirect independently and connect to the vetted address.
export async function page(url, redirects = 0) {
  if (!url || redirects > 4 || !/^[a-z\d.-]+\.[a-z]{2,}$/i.test(url.hostname)) throw Error('Invalid portal URL');
  const { address, family } = await lookup(url.hostname);
  if (ipaddr.process(address).range() !== 'unicast') throw Error('Invalid portal address');
  const response = await new Promise((resolve, reject) => {
    https.get(url, { agent: false, family, autoSelectFamily: false, headers: { 'User-Agent': 'Worth-a-Stop/0.1 (travel calendar discovery)' },
      lookup: (_host, _opts, cb) => cb(null, address, family),
      signal: AbortSignal.timeout(8000) }, resolve).on('error', reject);
  });
  if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
    response.destroy();
    return page(website(new URL(response.headers.location, url).href), redirects + 1);
  }
  if (response.statusCode !== 200 || !response.headers['content-type']?.includes('html')) {
    response.destroy();
    throw Error('Portal unavailable');
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response) {
    bytes += chunk.length;
    if (bytes > 4_000_000) throw Error('Page too large');
    chunks.push(chunk);
  }
  return { url, html: Buffer.concat(chunks).toString() };
}

export function calendarLinks({ url, html }) {
  const $ = load(html);
  const section = /^(events?|what.s on|calendar of events|event calendar|calendar|program|programme|programm|repertoire|repertoár|műsor|veranstaltungen|veranstaltungskalender|akce|kalendář akcí|podujatia|kalendár podujatí|kalendarz (?:wydarzeń|imprez)|wydarzenia|események|programok|agenda|événements|eventos|eventi|evenementen|evenemang|tapahtumat|афиша|события|мероприятия|программа|репертуар|події|календар подій)(?:\s*\(\d+\))?$/iu;
  const links = new Set();
  for (const a of $('a[href]').toArray()) {
    const href = $(a).attr('href');
    if (!href || href.startsWith('#') || !URL.canParse(href, url)) continue;
    const target = website(new URL(href, url).href);
    const host = url.hostname.replace(/^www\./, '');
    if (!target || !(target.hostname.replace(/^www\./, '') === host || target.hostname.endsWith('.' + host))) continue;
    const segment = target.pathname.replace(/\/+$/, '').split('/').pop().replace(/[-_]/g, ' ');
    if (section.test(segment) || section.test($(a).text().replace(/\s+/g, ' ').trim())) { target.hash = ''; links.add(target.href); }
  }
  return [...links].slice(0, 6);
}

export function calendarLink(document) { return calendarLinks(document)[0] ?? null; }

export function visitorLinks({ url, html }) {
  const $ = load(html);
  const links = new Set();
  const label = /^(?:tourism|tourist information|tourism portal|official tourism(?: website| portal)?|visit(?:ors?| .+)?|for visitors|turizmus|turistika|cestovný ruch|pre návštevníkov|pro turisty|tourismus|für gäste|tourisme|turismo|для туристов|туризм)$/iu;
  for (const anchor of $('a[href]').toArray()) {
    if (!label.test($(anchor).text().replace(/\s+/g, ' ').trim())) continue;
    const href = $(anchor).attr('href');
    const target = href && URL.canParse(href, url) && website(new URL(href, url).href);
    if (target && target.href !== url.href) { target.hash = ''; links.add(target.href); }
  }
  return [...links].slice(0, 3);
}

export function venueLinks({ url, html }) {
  const $ = load(html);
  const links = new Set();
  const institution = /theat(?:re|er)|divadl|színház|museum|museo|musée|muze[au]|múze[au]|kultur|kultúr|cultural cent(?:re|er)|culture|concert hall|концертн|театр|музе[йя]|культур/iu;
  for (const anchor of $('a[href]').toArray()) {
    const el = $(anchor);
    const label = [el.text(), el.attr('title'), el.attr('aria-label'), el.find('img').attr('alt')].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    if (label.length > 180 || !institution.test(label)) continue;
    const href = el.attr('href');
    const target = href && URL.canParse(href, url) && website(new URL(href, url).href);
    if (!target || /\.(?:pdf|jpe?g|png|webp|zip)$/i.test(target.pathname)) continue;
    target.hash = '';
    if (target.href !== url.href) links.add(target.href);
  }
  return [...links].slice(0, 4);
}

// Follow a short, published path from the municipality to cultural directories and venues.
export async function siteCalendars(site, readPage = page) {
  const queue = [{ url: site, depth: 0 }];
  const seen = new Set([site.href]);
  const links = new Set();
  let attempts = 0, failed = false;
  while (queue.length && attempts < 8) {
    const jobs = queue.splice(0, Math.min(2, 8 - attempts));
    attempts += jobs.length;
    const results = await Promise.allSettled(jobs.map(async job => ({ job, document: await readPage(job.url) })));
    for (const result of results) {
      if (result.status === 'rejected') { failed = true; continue; }
      const { job, document } = result.value;
      seen.add(document.url.href);
      for (const link of calendarLinks(document)) links.add(link);
      if (job.depth >= 2) continue;
      for (const href of [...visitorLinks(document), ...venueLinks(document)]) {
        if (seen.has(href)) continue;
        seen.add(href);
        queue.push({ url: new URL(href), depth: job.depth + 1 });
      }
    }
  }
  if (!links.size && failed) throw Error('Linked calendars unavailable');
  return [...links];
}

async function json(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000),
    headers: { Accept: 'application/json', 'User-Agent': 'Worth-a-Stop/0.1 (travel calendar discovery)' } });
  if (!response.ok) throw Error('Directory unavailable');
  const data = await response.json();
  if (data.error) throw Error('Directory lookup failed');
  return data;
}

async function tourismPortal(title, language, fetchJSON) {
  async function article(params) {
    const url = new URL(`https://${language}.wikipedia.org/w/api.php`);
    url.search = new URLSearchParams({ action: 'parse', page: title, format: 'json', formatversion: '2', ...params });
    return (await fetchJSON(url)).parse;
  }
  const { sections } = await article({ prop: 'sections' });
  const section = sections.find(s => /^(External_links|Externé_odkazy|Externí_odkazy|Weblinks|Liens_externes|Enlaces_externos|Collegamenti_esterni|Linki_zewnętrzne|További_információk|Ссылки|Посилання)$/iu.test(s.anchor));
  if (!section) return null;
  const $ = load((await article({ prop: 'text', section: section.index })).text);
  const link = $('a.external').toArray().find(a => /official.*(?:touris|visitor)|(?:touris|visitor).*official|ofici[aá]ln[yaí].*turis|offizielle.*touris|touris.*officiel|oficjaln.*turyst|официальн.*турис/iu.test($(a).text()));
  return link && website($(link).attr('href'));
}

async function discoverCalendars(id, { fetchJSON = json, readPage = page } = {}) {
  if (!/^[1-9]\d{0,9}$/.test(id)) throw Error('Invalid GeoNames ID');
  const query = `SELECT ?site ?title ?wiki WHERE { ?city wdt:P1566 "${id}". OPTIONAL { ?city wdt:P856 ?site }
    OPTIONAL { ?article schema:about ?city; schema:isPartOf ?wiki; schema:name ?title.
      FILTER(CONTAINS(STR(?wiki), ".wikipedia.org/")) } } LIMIT 1000`;
  const url = new URL('https://query.wikidata.org/sparql');
  url.search = new URLSearchParams({ format: 'json', query });
  let rows = [], directoryError;
  try { rows = (await fetchJSON(url)).results.bindings; } catch (error) { directoryError = error; }
  if (!rows.some(row => row.site?.value)) {
    try { rows.push(...await cityWebsites(id, fetchJSON)); }
    catch (error) { if (directoryError) throw directoryError; if (!rows.length) throw error; }
  }
  const sites = [...new Set(rows.map(r => r.site?.value).filter(Boolean))].map(website).filter(Boolean).slice(0, 4);
  const local = sites[0]?.hostname.split('.').pop();
  const articles = new Map();
  for (const row of rows) {
    const language = /^https:\/\/([a-z-]+)\.wikipedia\.org\/$/.exec(row.wiki?.value)?.[1];
    if (language && row.title) articles.set(language, row.title.value);
  }
  const languages = [...articles.keys()].sort((a,b) =>
    Number(b === local) - Number(a === local) || Number(b === 'en') - Number(a === 'en')).slice(0, 3);
  const jobs = sites.map(site => Promise.resolve(site));
  for (const language of languages) jobs.push(tourismPortal(articles.get(language), language, fetchJSON));
  const pages = new Map();
  const sharedPage = address => {
    if (!pages.has(address.href)) pages.set(address.href, readPage(address));
    return pages.get(address.href);
  };
  const results = await Promise.allSettled(jobs.map(async job => {
    const site = await job;
    if (!site) return [];
    return siteCalendars(site, sharedPage);
  }));
  const links = [...new Set(results.flatMap(r => r.status === 'fulfilled' ? r.value : []))].slice(0, 8);
  if (!links.length && results.some(r => r.status === 'rejected')) throw results.find(r => r.status === 'rejected').reason;
  return links;
}

const cache = new Map();
export async function officialCalendars(id, dependencies) {
  if (!/^[1-9]\d{0,9}$/.test(id)) throw Error('Invalid GeoNames ID');
  if (dependencies) return discoverCalendars(id, dependencies);
  const saved = cache.get(id);
  if (saved?.expires > Date.now()) return saved.promise;
  const promise = discoverCalendars(id);
  if (cache.size >= 80) cache.delete(cache.keys().next().value);
  cache.set(id, { promise, expires: Date.now() + 600000 });
  try { return await promise; } catch (error) { if (cache.get(id)?.promise === promise) cache.delete(id); throw error; }
}
