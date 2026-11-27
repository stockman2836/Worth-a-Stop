const categories = {
  tourism: ['attraction', 'museum', 'viewpoint', 'gallery'],
  historic: ['castle', 'monument', 'ruins', 'archaeological_site', 'city_gate', 'amphitheatre', 'fort', 'palace', 'church', 'temple', 'monastery'],
  building: ['cathedral', 'basilica', 'church', 'temple', 'monastery'], leisure: ['park', 'garden'], amenity: ['marketplace'],
};

function importance(tags) {
  const landmark = categories.building.includes(tags.building) || tags.tourism === 'attraction' || categories.historic.includes(tags.historic);
  const translations = Object.keys(tags).filter(key => /^name:[a-z]{2,3}(?:-[a-z\d]+)*$/i.test(key) && tags[key]).length;
  // Source annotations indicate prominence without a hand-maintained list of famous sites.
  return (landmark ? 3 : tags.tourism === 'museum' ? 2 : 0) + Math.log2(1 + translations) * 6 +
    (tags.wikidata ? 2 : 0) + (tags.wikipedia ? 3 : 0) + (tags.heritage ? 3 : 0) +
    (tags['ref:whc'] || /unesco|whc/i.test(tags['heritage:operator'] || '') ? 2 : 0) +
    (tags.importance === 'international' ? 4 : 0) + (['yes', '1'].includes(tags.landmark) ? 2 : 0);
}

function validPoint(lat, lon) {
  return Number.isFinite(lat) && Math.abs(lat) <= 90 && Number.isFinite(lon) && Math.abs(lon) <= 180;
}

function distance(lat, lon, otherLat, otherLon) {
  const rad = Math.PI / 180;
  const a = Math.sin((otherLat - lat) * rad / 2) ** 2 +
    Math.cos(lat * rad) * Math.cos(otherLat * rad) * Math.sin((otherLon - lon) * rad / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(Math.min(1, a)));
}

export async function nearbyPlaces(city, { signal, fetchResponse = fetch, radiusKm = 2 } = {}) {
  const { latitude, longitude } = city;
  if (!validPoint(latitude, longitude)) throw Error('Invalid city centre');
  if (![2, 6].includes(radiusKm)) throw Error('Invalid place search radius');
  function bounds(radius) {
    const dy = radius / 110.5;
    const dx = dy / Math.cos(latitude * Math.PI / 180);
    return Math.abs(latitude) + dy < 90 && Math.abs(longitude) + dx < 180
      ? [latitude - dy, longitude - dx, latitude + dy, longitude + dx].map(n => n.toFixed(5)).join(',')
      : `around:${radius * 1000},${latitude},${longitude}`;
  }
  const filters = Object.entries(categories).map(([tag, values]) =>
    `nwr[${tag}~"^(${values.join('|')})$"][name](${bounds(2)});`);
  if (radiusKm > 2) for (const tag of ['wikidata', 'wikipedia', 'heritage']) filters.push(`nwr[name][${tag}](${bounds(radiusKm)});`);
  async function query(endpoint, post = false) {
    const url = new URL(endpoint);
    const data = `[out:json][timeout:12];(${filters.join('')});out tags center;`;
    if (!post) url.searchParams.set('data', data);
    const timeout = AbortSignal.timeout(18000);
    const response = await fetchResponse(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: { 'User-Agent': 'Worth-a-Stop/0.1 (city travel planner)', ...(post && { 'Content-Type': 'application/x-www-form-urlencoded' }) },
      ...(post && { method: 'POST', body: new URLSearchParams({ data }).toString() }) });
    if (!response.ok) throw Error('Place search unavailable');
    const { elements, remark } = await response.json();
    if (remark || !Array.isArray(elements)) throw Error('Incomplete place search');
    return elements;
  }
  let elements;
  const endpoints = ['https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
  for (const [index, endpoint] of endpoints.entries()) {
    try { elements = await query(endpoint, index === 2); break; }
    catch (error) { signal?.throwIfAborted(); if (index === endpoints.length - 1) throw error; }
  }
  const places = [];
  for (const { type, id, lat, lon, center, tags = {} } of elements) {
    const point = center ?? { lat, lon };
    if (!validPoint(point.lat, point.lon) || !['node', 'way', 'relation'].includes(type) || !Number.isSafeInteger(id)) continue;
    const key = tags.building === 'cathedral' ? 'building' :
      categories.historic.includes(tags.historic) ? 'historic' : Object.keys(categories).find(k => categories[k].includes(tags[k]));
    const name = tags.name;
    if (!key || !name || ['private', 'no'].includes(tags.access) || tags.opening_hours === 'off') continue;
    if (key === 'amenity' && (tags.shop || !(
      type !== 'node' || tags.marketplace || tags.market || tags.wikidata || tags.building === 'marketplace'
    ))) continue;
    const km = distance(latitude, longitude, point.lat, point.lon);
    if (km <= radiusKm && (km <= 2 || tags.wikidata || tags.wikipedia || tags.heritage)) places.push({ latitude: point.lat, longitude: point.lon, name, names: { ru: tags['name:ru'], en: tags['name:en'] }, category: tags[key], km, hours: tags.opening_hours,
      rank: importance(tags),
      identity: tags.wikidata,
      url: `https://www.openstreetmap.org/${type}/${id}` });
  }
  places.sort((a, b) => b.rank - a.rank || a.km - b.km);
  const unique = [];
  const normalize = value => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().trim();
  for (const place of places) {
    const duplicate = unique.some(other => place.identity && place.identity === other.identity ||
      normalize(place.name) === normalize(other.name) &&
      distance(place.latitude, place.longitude, other.latitude, other.longitude) < .2);
    if (!duplicate) unique.push(place);
  }
  // Category quotas must not displace better documented landmarks.
  return unique.slice(0, radiusKm === 6 ? 24 : 12).map(({ rank, identity, ...place }) => place);
}
