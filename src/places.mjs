import { overpassQuery } from './overpass.mjs';
import { cityBoundary } from './city-boundary.mjs';
import { validExtent } from './overpass-coverage.mjs';

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

export async function nearbyPlaces(city, { signal, fetchResponse = fetch, scope = 'nearby', resolveBoundary = cityBoundary } = {}) {
  const { latitude, longitude } = city;
  if (!validPoint(latitude, longitude)) throw Error('Invalid city centre');
  if (!['city', 'nearby'].includes(scope)) throw Error('Invalid place search scope');
  const boundary = scope === 'city' ? await resolveBoundary(city, { signal, fetchResponse }) : null;
  function bounds(radius) {
    const dy = radius / 110.5;
    const dx = dy / Math.cos(latitude * Math.PI / 180);
    return Math.abs(latitude) + dy < 90 && Math.abs(longitude) + dx < 180
      ? [latitude - dy, longitude - dx, latitude + dy, longitude + dx].map(n => n.toFixed(5)).join(',')
      : `around:${radius * 1000},${latitude},${longitude}`;
  }
  const box = boundary?.bounds;
  const cityBox = validExtent(box) ? `(${box.minlat},${box.minlon},${box.maxlat},${box.maxlon})` : '';
  const spatial = cityBox ? `nwr${cityBox}[name]->.nearby;` : '';
  const filters = Object.entries(categories).map(([tag, values]) =>
    cityBox ? `nwr.nearby[${tag}~"^(${values.join('|')})$"];` :
      `nwr[${tag}~"^(${values.join('|')})$"][name](${boundary ? 'area.city' : bounds(2)});`);
  // Use the spatial index first, then apply polygon membership once to all candidates.
  const membership = boundary && cityBox ? '->.candidates;nwr.candidates(area.city)' : '';
  const elements = await overpassQuery(`${boundary ? `rel(${boundary.relation});map_to_area->.city;.city out tags;` : ''}${spatial}(${filters.join('')})${membership};out tags center;`, {
    signal, fetchResponse, extent: boundary?.bounds,
    queryTimeout: boundary ? 20 : 8,
    accept: elements => !boundary || elements.some(element => element.type === 'area'),
  });
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
    if (boundary || km <= 2) places.push({ latitude: point.lat, longitude: point.lon, name, names: { ru: tags['name:ru'], en: tags['name:en'] }, category: tags[key], km, hours: tags.opening_hours,
      rank: importance(tags),
      identity: tags.wikidata,
      url: `https://www.openstreetmap.org/${type}/${id}` });
  }
  places.sort((a, b) => b.rank - a.rank || a.km - b.km);
  const unique = [];
  const limit = boundary ? 24 : 12;
  const normalize = value => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().trim();
  for (const place of places) {
    const duplicate = unique.some(other => place.identity && place.identity === other.identity ||
      normalize(place.name) === normalize(other.name) &&
      distance(place.latitude, place.longitude, other.latitude, other.longitude) < .2);
    if (!duplicate) unique.push(place);
    if (unique.length === limit) break;
  }
  // Category quotas must not displace better documented landmarks.
  const shortlist = unique.map(({ rank, identity, ...place }) => place);
  return boundary ? { places: shortlist, boundary: { name: boundary.name, url: boundary.url } } : shortlist;
}
