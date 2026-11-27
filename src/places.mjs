const radius = 2; // kilometres from the geocoder's city centre
const categories = {
  tourism: ['attraction', 'museum', 'viewpoint', 'gallery'],
  historic: ['castle', 'monument', 'ruins', 'archaeological_site', 'city_gate'],
  building: ['cathedral'], leisure: ['park', 'garden'], amenity: ['marketplace'],
};

function importance(tags) {
  const landmark = tags.building === 'cathedral' || tags.tourism === 'attraction' || categories.historic.includes(tags.historic);
  return (tags.building === 'cathedral' ? 8 : landmark ? 5 : 0) + (tags.wikidata || tags.wikipedia ? 2 : 0);
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

export async function nearbyPlaces(city, { signal, fetchResponse = fetch } = {}) {
  const { latitude, longitude } = city;
  if (!validPoint(latitude, longitude)) throw Error('Invalid city centre');
  const dy = radius / 110.5;
  const dx = dy / Math.cos(latitude * Math.PI / 180);
  const bounds = Math.abs(latitude) + dy < 90 && Math.abs(longitude) + dx < 180
    ? [latitude - dy, longitude - dx, latitude + dy, longitude + dx].map(n => n.toFixed(5)).join(',')
    : `around:${radius * 1000},${latitude},${longitude}`;
  const filters = Object.entries(categories).map(([tag, values]) =>
    `nwr[${tag}~"^(${values.join('|')})$"][name](${bounds});`);
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
    if (km <= radius) places.push({ latitude: point.lat, longitude: point.lon, name, names: { ru: tags['name:ru'], en: tags['name:en'] }, category: tags[key], km, hours: tags.opening_hours,
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
  // Preserve category variety while preferring landmarks and documented places.
  const first = new Map();
  for (const place of unique) if (!first.has(place.category)) first.set(place.category, place);
  return [...new Set([...first.values(), ...unique])].slice(0, 12)
    .sort((a, b) => b.rank - a.rank || a.km - b.km).map(({ rank, identity, ...place }) => place);
}
