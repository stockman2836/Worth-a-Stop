import { validPlaceReference } from './place-reference.mjs';

const entityId = value => typeof value === 'string' && /^Q[1-9]\d*$/.test(value);
const order = { highlight: 0, notable: 1, local: 2 };

export function wikipediaLanguages(sitelinks) {
  if (!sitelinks || typeof sitelinks !== 'object' || Array.isArray(sitelinks)) throw Error('Invalid Wikidata sitelinks');
  const languages = new Set();
  for (const [site, article] of Object.entries(sitelinks)) {
    const match = /^([a-z]{2,3}(?:_[a-z-]+)*|simple)wiki$/.exec(site);
    if (match && article?.site === site && typeof article.title === 'string' && article.title.trim()) languages.add(match[1].split('_')[0]);
  }
  return languages.size;
}

// Optional corroboration of existing mapped objects. Never search by a guessed
// name or introduce coordinates or places from an unrelated entity.
export async function enrichPlaceReferences(result, { signal, fetchResponse = fetch, queryCache, timeout = 6000, now = Date.now } = {}) {
  const ids = [...new Set(result.places.map(place => place.wikidata).filter(entityId))].sort();
  if (!ids.length) return result;
  const deadline = AbortSignal.timeout(timeout);
  const taskSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const references = new Map();
  const batches = [];
  for (let i = 0; i < ids.length; i += 50) batches.push(ids.slice(i, i + 50));
  let next = 0;
  async function worker() {
    while (next < batches.length && !taskSignal.aborted) {
      const batch = batches[next++], key = 'place-references-v1/' + batch.join('|');
      try {
        const saved = await queryCache?.get(key).catch(() => undefined);
        let values = saved?.expires > now() && Array.isArray(saved.value) && saved.value.length > 0 && saved.value.length <= batch.length &&
          new Set(saved.value.map(entry => entry?.[0])).size === saved.value.length &&
          saved.value.every(entry => Array.isArray(entry) && entry.length === 2 && batch.includes(entry[0]) && validPlaceReference(entry[1], entry[0])) ? saved.value : undefined;
        if (!values) {
          taskSignal.throwIfAborted();
          const url = new URL('https://www.wikidata.org/w/api.php');
          url.search = new URLSearchParams({ action: 'wbgetentities', ids: batch.join('|'), props: 'sitelinks', format: 'json' });
          const response = await fetchResponse(url, { signal: taskSignal,
            headers: { 'User-Agent': 'Worth-a-Stop/0.1 (travel place references)' } });
          if (!response.ok) throw Error('Wikidata unavailable');
          const data = await response.json();
          if (data.error || !data.entities || Array.isArray(data.entities)) throw Error('Invalid Wikidata response');
          values = batch.flatMap(id => {
            const entity = data.entities[id];
            if (entity?.id !== id || entity.missing !== undefined) return [];
            try {
              return [[id, { url: `https://www.wikidata.org/wiki/${id}`, wikipediaLanguages: wikipediaLanguages(entity.sitelinks), checkedAt: now() }]];
            } catch { return []; }
          });
          taskSignal.throwIfAborted();
          if (values.length) await queryCache?.set(key, { expires: now() + (values.length === batch.length ? 7 * 86400000 : 3600000), value: values }).catch(() => {});
        }
        for (const [id, reference] of values) references.set(id, reference);
      } catch { /* Optional evidence never discards the mapped catalogue. */ }
    }
  }
  await Promise.all([worker(), worker()]);
  signal?.throwIfAborted();
  const places = result.places.map(place => {
    const reference = references.get(place.wikidata);
    if (!reference) return place;
    // Broad encyclopedic coverage corroborates prominence; lack of it never
    // demotes an existing highlight. This is a threshold, not a city quota.
    const promoted = reference.wikipediaLanguages >= 30;
    return { ...place, reference, ...(promoted && { prominence: 'highlight',
      prominenceReasons: [...new Set([...(place.prominenceReasons ?? []), 'encyclopedic'])] }) };
  }).sort((a, b) => (order[a.prominence] ?? 2) - (order[b.prominence] ?? 2));
  return { ...result, places, referencesStatus: references.size === ids.length ? 'checked' : references.size ? 'partial' : 'unavailable' };
}
