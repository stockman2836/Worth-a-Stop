// A geographic fallback for towns missing a GeoNames association in Wikidata.
export async function cityWebsites(id, fetchJSON) {
  const city = await fetchJSON(new URL('https://geocoding-api.open-meteo.com/v1/get?id=' + id));
  if (String(city.id) !== id || !city.feature_code?.startsWith('PPL') || typeof city.name !== 'string' ||
      !Number.isFinite(city.latitude) || !Number.isFinite(city.longitude)) return [];
  const url = new URL('https://en.wikipedia.org/w/api.php');
  url.search = new URLSearchParams({ action: 'query', list: 'geosearch',
    gscoord: `${city.latitude}|${city.longitude}`, gsradius: '5000', gslimit: '30', format: 'json', formatversion: '2' });
  const normalize = value => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s*\([^)]*\)$/, '').trim();
  const candidates = (await fetchJSON(url)).query.geosearch.filter(item => normalize(item.title) === normalize(city.name)).slice(0, 2);
  const rows = [];
  for (const candidate of candidates) {
    const props = new URL('https://en.wikipedia.org/w/api.php');
    props.search = new URLSearchParams({ action: 'query', pageids: String(candidate.pageid), prop: 'pageprops', format: 'json', formatversion: '2' });
    const entityId = (await fetchJSON(props)).query.pages[0]?.pageprops?.wikibase_item;
    if (!/^Q[1-9]\d*$/.test(entityId)) continue;
    const entity = (await fetchJSON(new URL(`https://www.wikidata.org/wiki/Special:EntityData/${entityId}.json`))).entities[entityId];
    const association = entity?.claims?.P1566?.map(claim => claim.mainsnak?.datavalue?.value).filter(Boolean) || [];
    if (association.length && !association.includes(id)) continue;
    for (const claim of entity?.claims?.P856 || []) {
      if (claim.rank === 'deprecated') continue;
      const site = claim.mainsnak?.datavalue?.value;
      if (typeof site === 'string') rows.push({ site: { value: site }, title: { value: candidate.title }, wiki: { value: 'https://en.wikipedia.org/' } });
    }
  }
  return rows;
}
