async function wiki(language, params, fetchResponse) {
  const url = new URL(`https://${language}.wikivoyage.org/w/api.php`);
  url.search = new URLSearchParams({ ...params, format: 'json', formatversion: '2', origin: '*' });
  const response = await fetchResponse(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Wikivoyage returned HTTP ${response.status}.`);
  const data = await response.json();
  if (data.error) throw new Error('Wikivoyage lookup failed.');
  return data;
}

async function nearbyGuide(city, language, fetchResponse) {
  const { query } = await wiki(language, { action: 'query', list: 'geosearch',
    gscoord: `${city.latitude}|${city.longitude}`, gsradius: '5000', gslimit: '20' }, fetchResponse);
  const pages = query.geosearch;
  const page = pages.find(item => item.title.localeCompare(city.name, language, { sensitivity: 'base' }) === 0) ?? pages[0];
  if (!page) return null;
  const params = { action: 'parse', pageid: page.pageid };
  const article = new URL(`https://${language}.wikivoyage.org/wiki/${encodeURIComponent(page.title.replaceAll(' ', '_'))}`);
  const guide = { title: page.title, language, url: article.href, links: [] };
  let sections;
  try {
    const { parse } = await wiki(language, { ...params, prop: 'sections' }, fetchResponse);
    sections = parse.sections;
  } catch {
    return guide;
  }
  const headings = sections.filter(section => /^(events?|festivals?|события|фестивали|праздники)(?:$|[\s:])/iu.test(section.line));
  if (headings.length) article.hash = headings[0].anchor;
  const responses = await Promise.allSettled(headings.slice(0, 2).map(heading =>
    wiki(language, { ...params, section: heading.index, prop: 'externallinks' }, fetchResponse)));
  const resources = new Map();
  for (const response of responses) {
    if (response.status === 'rejected') continue;
    for (const link of response.value.parse.externallinks) {
      if (!URL.canParse(link)) continue;
      const url = new URL(link);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) continue;
      const label = url.hostname.replace(/^www\./, '');
      if (!resources.has(label)) resources.set(label, { label, url: url.href });
    }
  }
  return { ...guide, url: article.href, links: [...resources.values()] };
}

export async function findGuide(city, language, fetchResponse = fetch) {
  if (language !== 'ru') return nearbyGuide(city, 'en', fetchResponse);
  let local;
  let localError;
  try {
    local = await nearbyGuide(city, 'ru', fetchResponse);
  } catch (error) {
    localError = error;
  }
  if (local?.links.length) return local;
  try {
    const english = await nearbyGuide(city, 'en', fetchResponse);
    if (english?.links.length) return english;
    if (!local && !english && localError) throw localError;
    return local ?? english;
  } catch (error) {
    if (local) return local;
    throw error;
  }
}
