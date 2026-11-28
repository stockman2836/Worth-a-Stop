import { cityBoundary } from './city-boundary.mjs';
import { containsPoint, cityBoundaryParts } from './city-boundary-parts.mjs';
import { prominenceSignals, classifyProminence } from './place-prominence.mjs';
import { categories, documentedCategories, placeElements } from './place-elements.mjs';
import { validTerritory } from './territory.mjs';
import { cityEnclaves } from './city-enclaves.mjs';
import { initialCityBounds } from './place-preview.mjs';

function importance(tags, translations) {
  const landmark = categories.building.includes(tags.building) || tags.tourism === 'attraction' || categories.historic.includes(tags.historic);
  // Source annotations indicate prominence without a hand-maintained list of famous sites.
  return (landmark ? 3 : tags.tourism === 'museum' ? 2 : 0) + Math.log2(1 + translations) * 6 +
    (tags.wikidata ? 2 : 0) + (tags.wikipedia ? 3 : 0) + (tags.heritage ? 3 : 0) +
    (tags['ref:whc'] || /unesco|whc/i.test(tags['heritage:operator'] || '') ? 2 : 0) +
    (tags.importance === 'international' ? 4 : 0) + (['yes', '1'].includes(tags.landmark) ? 2 : 0);
}

function validPoint(lat, lon) {
  return Number.isFinite(lat) && Math.abs(lat) <= 90 && Number.isFinite(lon) && Math.abs(lon) <= 180;
}

function elementPoint({ center, lat, lon, geometry, members }) {
  if (validPoint(center?.lat, center?.lon)) return center;
  if (validPoint(lat, lon)) return { lat, lon };
  // Overpass geometry output overrides its centre output. Derive the same
  // bounding-box centre from way coordinates and relation member geometry.
  const points = geometry ?? members?.flatMap(member => member.geometry ?? [member]) ?? [];
  let south = Infinity, west = Infinity, north = -Infinity, east = -Infinity;
  for (const point of points) {
    if (!validPoint(point?.lat, point?.lon)) continue;
    south = Math.min(south, point.lat); north = Math.max(north, point.lat);
    west = Math.min(west, point.lon); east = Math.max(east, point.lon);
  }
  return { lat: (south + north) / 2, lon: (west + east) / 2 };
}

function distance(lat, lon, otherLat, otherLon) {
  const rad = Math.PI / 180;
  const a = Math.sin((otherLat - lat) * rad / 2) ** 2 +
    Math.cos(lat * rad) * Math.cos(otherLat * rad) * Math.sin((otherLon - lon) * rad / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(Math.min(1, a)));
}

export async function nearbyPlaces(city, { signal, fetchResponse = fetch, scope = 'nearby', resolveBoundary = cityBoundary, queryCache, onProgress } = {}) {
  const { latitude, longitude } = city;
  if (!validPoint(latitude, longitude)) throw Error('Invalid city centre');
  if (!['city', 'nearby'].includes(scope)) throw Error('Invalid place search scope');
  let boundary = scope === 'city' ? await resolveBoundary(city, { signal, fetchResponse }) : null;
  if (boundary && !boundary.segments) {
    const shape = await cityBoundaryParts(boundary, city, { signal, fetchResponse, queryCache });
    if (shape) boundary = { ...boundary, ...shape };
  }
  let inside = boundary?.segments ? containsPoint(boundary.segments) : null;
  let hostRecords = [], previewRecords = [];
  const territoryRecords = new Map();
  let enclaves = boundary?.enclaves ?? [];
  const describe = ({ bounds, ...territory }) => territory;
  const clean = elements => elements.map(({ territory: ignored, ...record }) => record);
  function records() {
    const key = element => `${element.type}/${element.id}`;
    const hostIds = new Set(hostRecords.map(key));
    let result = hostRecords.concat(previewRecords.filter(element => !hostIds.has(key(element))));
    for (const additions of territoryRecords.values()) {
      const ids = new Set(additions.map(key));
      result = result.filter(element => !ids.has(key(element))).concat(additions);
    }
    return result;
  }
  let ready;
  const primaryReady = new Promise(resolve => { ready = resolve; });
  function report() {
    const snapshot = present(records(), true);
    if ((snapshot.places ?? snapshot).length) { ready(); onProgress?.(snapshot); }
  }
  const preview = onProgress && initialCityBounds(city, boundary);
  if (preview) {
    const timeout = AbortSignal.timeout(7000);
    try {
      const first = await placeElements(city, boundary, { fetchResponse, queryCache, queryBounds: preview,
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
      previewRecords = clean(first.elements); report();
    } catch (error) { signal?.throwIfAborted(); }
  }
  let incomplete = Boolean(boundary?.incomplete);
  async function loadHost() {
    const options = { signal, fetchResponse, queryCache, onElements: onProgress ? elements => {
      hostRecords = clean(elements); report();
    } : undefined };
    try {
      let data;
      try { data = await placeElements(city, boundary, options); }
      catch (error) {
        if (error.code !== 'PLACE_QUERY_TOO_LARGE' || !boundary || inside) throw error;
        const shape = await cityBoundaryParts(boundary, city, { signal, fetchResponse, queryCache, force: true });
        if (!shape) throw error;
        boundary = { ...boundary, ...shape }; inside = containsPoint(shape.segments);
        data = await placeElements(city, boundary, options);
      }
      hostRecords = clean(data.elements);
      incomplete ||= data.incomplete;
      if (!data.incomplete) previewRecords = [];
      report();
    } finally { ready(); }
  }
  async function loadTerritories() {
    if (!boundary?.innerWays?.length && !enclaves.length) return;
    await primaryReady;
    signal?.throwIfAborted();
    if (boundary.innerWays?.length && boundary.enclaves === undefined) {
      try { enclaves = await cityEnclaves(boundary, { signal, fetchResponse, queryCache }); }
      catch (error) { signal?.throwIfAborted(); incomplete = true; return; }
    }
    for (const enclave of enclaves) {
      signal?.throwIfAborted();
      try {
        const additional = await placeElements(city, enclave, { signal, fetchResponse, queryCache });
        territoryRecords.set(enclave.relation, clean(additional.elements).map(element => ({ ...element, territory: describe(enclave) })));
        incomplete ||= additional.incomplete; report();
      } catch (error) { signal?.throwIfAborted(); incomplete = true; }
    }
  }
  const outcomes = await Promise.allSettled([loadHost(), loadTerritories()]);
  signal?.throwIfAborted();
  const failure = outcomes.find(outcome => outcome.status === 'rejected');
  if (failure) {
    const available = present(records(), true);
    if (!(available.places ?? available).length) throw failure.reason;
    incomplete = true;
  }
  const result = present(records(), incomplete);
  // A mapped settlement footprint can exclude its visitor sites. Keep that
  // boundary explicit and label a separate nearby fallback, never a city result.
  if (boundary?.kind === 'settlement' && !incomplete && !result.places.length) {
    try {
      const places = await nearbyPlaces(city, { signal, fetchResponse, scope: 'nearby', queryCache });
      return { ...result, places, surroundings: true };
    } catch (error) { signal?.throwIfAborted(); return { ...result, incomplete: true }; }
  }
  return result;

  function present(elements, incomplete) {
    const places = [];
    for (const { type, id, lat, lon, center, geometry, members, territory, tags = {} } of elements) {
      const point = elementPoint({ center, lat, lon, geometry, members });
      if (!validPoint(point.lat, point.lon) || !['node', 'way', 'relation'].includes(type) || !Number.isSafeInteger(id)) continue;
      if (!territory && inside && !inside(point) && !geometry?.some(inside) && !members?.some(member => inside(member) || member.geometry?.some(inside))) continue;
      const key = tags.building === 'cathedral' || tags.tourism === 'attraction' && categories.building.includes(tags.building) ? 'building' :
        categories.historic.includes(tags.historic) ? 'historic' : Object.keys(categories).find(k => categories[k].includes(tags[k]));
      const name = tags.name;
      if (!key || !name || ['private', 'no'].includes(tags.access) || tags.opening_hours === 'off') continue;
      const signals = prominenceSignals(tags);
      if (documentedCategories[key]?.includes(tags[key]) && !signals.documented && !signals.heritage) continue;
      if (key === 'amenity' && tags.amenity === 'marketplace' && (tags.shop || !(
        type !== 'node' || tags.marketplace || tags.market || tags.wikidata || tags.building === 'marketplace'
      ))) continue;
      const km = distance(latitude, longitude, point.lat, point.lon);
      if (!boundary && km > 2) continue;
      places.push({ latitude: point.lat, longitude: point.lon, name, names: { ru: tags['name:ru'], en: tags['name:en'] }, category: tags[key], km, hours: tags.opening_hours,
        rank: importance(tags, signals.languages),
        signals,
        identity: tags.wikidata,
        ...(validTerritory(territory) && { territory }),
        url: `https://www.openstreetmap.org/${type}/${id}` });
    }
    places.sort((a, b) => b.rank - a.rank || Number(Boolean(b.territory)) - Number(Boolean(a.territory)) || a.km - b.km);
    const unique = [];
    const identities = new Set(), names = new Map();
    const normalize = value => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().trim();
    for (const place of places) {
      if (place.identity && identities.has(place.identity)) continue;
      const name = normalize(place.name), matches = names.get(name) || [];
      if (matches.some(other => distance(place.latitude, place.longitude, other.latitude, other.longitude) < .2)) continue;
      unique.push(place); matches.push(place); names.set(name, matches);
      if (place.identity) identities.add(place.identity);
      if (!boundary && unique.length === 12) break;
    }
    const result = classifyProminence(unique);
    return boundary ? { places: result, boundary: { name: boundary.name, url: boundary.url, ...(boundary.kind && { kind: boundary.kind }),
      ...(enclaves.length && { enclaves: enclaves.map(describe) }) }, ...(incomplete && { incomplete }) } : result;
  }
}
