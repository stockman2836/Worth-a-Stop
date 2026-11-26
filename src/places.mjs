const radius = 2; // kilometres from the geocoder's city centre
const categories = { tourism: ['museum', 'viewpoint', 'gallery'], leisure: ['park', 'garden'], amenity: ['marketplace'] };

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
  async function query(endpoint) {
    const url = new URL(endpoint);
    url.searchParams.set('data', `[out:json][timeout:12];(${filters.join('')});out tags center;`);
    const timeout = AbortSignal.timeout(18000);
    const response = await fetchResponse(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    if (!response.ok) throw Error('Place search unavailable');
    const { elements, remark } = await response.json();
    if (remark || !Array.isArray(elements)) throw Error('Incomplete place search');
    return elements;
  }
  let elements;
  try {
    elements = await query('https://maps.mail.ru/osm/tools/overpass/api/interpreter');
  } catch {
    signal?.throwIfAborted();
    elements = await query('https://overpass-api.de/api/interpreter');
  }
  const places = [];
  for (const { type, id, lat, lon, center, tags = {} } of elements) {
    const point = center ?? { lat, lon };
    if (!validPoint(point.lat, point.lon) || !['node', 'way', 'relation'].includes(type) || !Number.isSafeInteger(id)) continue;
    const key = Object.keys(categories).find(k => categories[k].includes(tags[k]));
    const name = tags.name;
    if (!key || !name || ['private', 'no'].includes(tags.access) || tags.opening_hours === 'off') continue;
    const km = distance(latitude, longitude, point.lat, point.lon);
    if (km <= radius) places.push({ latitude: point.lat, longitude: point.lon, name, names: { ru: tags['name:ru'], en: tags['name:en'] }, category: tags[key], km, hours: tags.opening_hours,
      url: `https://www.openstreetmap.org/${type}/${id}` });
  }
  places.sort((a, b) => a.km - b.km);
  // Keep the nearest example of each available category before filling the shortlist.
  const first = new Map();
  for (const place of places) if (!first.has(place.category)) first.set(place.category, place);
  return [...new Set([...first.values(), ...places])].slice(0, 12).sort((a, b) => a.km - b.km);
}
