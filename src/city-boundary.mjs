import { overpassQuery } from './overpass.mjs';
import { cityBoundaryParts } from './city-boundary-parts.mjs';

export function boundaryUnavailable() {
  return Object.assign(Error('City boundary unavailable'), { code: 'CITY_BOUNDARY_UNAVAILABLE' });
}

export async function cityBoundary(city, options = {}) {
  const { latitude, longitude, id, name } = city;
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180 ||
      !Number.isSafeInteger(id) || id < 1 || typeof name !== 'string' || !name.trim() || name.length > 200) throw Error('Invalid city');
  // Only consider boundaries containing the selected point, never a worldwide name match.
  const elements = await overpassQuery(`is_in(${latitude},${longitude});area._[boundary=administrative]->.boundaries;rel(pivot.boundaries);out tags bb;`, {
    ...options, extent: { minlat: latitude, maxlat: latitude, minlon: longitude, maxlon: longitude }, queryTimeout: 6,
  });
  const normalize = value => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[’']/g, '').replace(/\s+/g, ' ').trim();
  function candidates(requestedNames) {
    const requested = requestedNames.map(normalize);
    const matches = [];
    for (const { type, id: relation, tags = {}, bounds } of elements) {
      const level = Number(tags.admin_level);
      if (type !== 'relation' || !Number.isSafeInteger(relation) || relation < 1 || tags.boundary !== 'administrative' ||
          !Number.isInteger(level) || level < 4 || level > 10 || typeof tags.name !== 'string') continue;
      const geonames = tags['geonames:id'];
      if (geonames && geonames !== String(id)) continue;
      const names = Object.entries(tags).filter(([key]) => /^(?:name|official_name|short_name|alt_name|int_name)(?::[\w-]+)?$/.test(key))
        .flatMap(([, value]) => typeof value === 'string' ? value.split(';') : []);
      const identity = geonames === String(id);
      if (!identity && !names.some(value => requested.includes(normalize(value)))) continue;
      const score = (identity ? 100 : 0) + (/^(city|town|village|municipality)$/.test(tags.place) ? 20 : 0) + level;
      matches.push({ relation, name: tags.name, bounds, score });
    }
    return matches.sort((a, b) => b.score - a.score);
  }
  let matches = candidates([name]);
  // OSM may lack the interface-language name (e.g. Russian for Košice).
  // Resolve the existing GeoNames identity to its English name, never guess a translation.
  if (!matches.length) {
    const timeout = AbortSignal.timeout(10000);
    const response = await (options.fetchResponse ?? fetch)(new URL(`https://geocoding-api.open-meteo.com/v1/get?id=${id}&language=en`), {
      signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
    });
    if (!response.ok) throw Error('City identity lookup unavailable');
    const canonical = await response.json();
    options.signal?.throwIfAborted();
    if (canonical?.id === id && canonical.feature_code?.startsWith('PPL') && typeof canonical.name === 'string' && canonical.name.trim()) {
      matches = candidates([canonical.name]);
    }
  }
  if (!matches.length || matches.length > 1 && matches[0].score === matches[1].score) throw boundaryUnavailable();
  const { relation, name: boundaryName, bounds } = matches[0];
  const boundary = { relation, name: boundaryName, bounds, url: `https://www.openstreetmap.org/relation/${relation}` };
  const shape = await cityBoundaryParts(boundary, city, options);
  return { ...boundary, ...shape };
}
