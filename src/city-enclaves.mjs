import { overpassQuery } from './overpass.mjs';
import { validExtent } from './overpass-coverage.mjs';
import { validTerritory } from './territory.mjs';

export function enclosedTerritories(host, elements) {
  const holes = new Set(host.innerWays);
  const outlines = new Map();
  for (const element of elements) {
    const { id, tags = {}, members, bounds } = element;
    const level = Number(tags.admin_level);
    if (element.type !== 'relation' || id === host.relation || !Number.isSafeInteger(id) || id < 1 ||
      tags.boundary !== 'administrative' || !Number.isInteger(level) || level < 2 || level > 10 ||
      typeof tags.name !== 'string' || !tags.name.trim() || !Array.isArray(members) || !validExtent(bounds)) continue;
    if (validExtent(host.bounds) && (bounds.minlat < host.bounds.minlat || bounds.maxlat > host.bounds.maxlat ||
      bounds.minlon < host.bounds.minlon || bounds.maxlon > host.bounds.maxlon)) continue;
    const outer = members.filter(member => member.role === 'outer' || member.role === '');
    if (!outer.length || !outer.every(member => member.type === 'way' && holes.has(member.ref))) continue;
    const key = [...new Set(outer.map(member => member.ref))].sort((a, b) => a - b).join(',');
    const value = { relation: id, name: tags.name, names: { ru: tags['name:ru'], en: tags['name:en'] }, bounds,
      url: `https://www.openstreetmap.org/relation/${id}`, kind: level === 2 ? 'country' : 'territory', level,
      ...(/^[A-Z]{2}$/.test(tags['ISO3166-1:alpha2'] || tags['ISO3166-1']) && { countryCode: tags['ISO3166-1:alpha2'] || tags['ISO3166-1'] }) };
    if (!outlines.has(key)) outlines.set(key, []);
    outlines.get(key).push(value);
  }
  const result = [];
  for (const candidates of outlines.values()) {
    candidates.sort((a, b) => a.level - b.level);
    // Coextensive country/city relations describe one territory. Conflicting
    // relations at the same administrative level do not establish its identity.
    if (candidates.length > 1 && candidates[0].level === candidates[1].level) continue;
    const { level, ...territory } = candidates[0];
    result.push(territory);
  }
  return result.sort((a, b) => a.relation - b.relation);
}

export async function cityEnclaves(host, { queryCache, ...options } = {}) {
  if (!host.innerWays?.length) return [];
  const ids = [...new Set(host.innerWays)].filter(id => Number.isSafeInteger(id) && id > 0);
  if (ids.length !== host.innerWays.length) throw Error('Invalid inner boundary ways');
  const key = `enclaves-v1/${host.relation}/${ids.toSorted((a, b) => a - b).join(',')}`;
  const saved = await queryCache?.get(key).catch(() => undefined);
  if (saved?.expires > Date.now() && Array.isArray(saved.value) && saved.value.every(value =>
    validTerritory(value) && validExtent(value.bounds) && Number.isSafeInteger(value.relation) && value.relation > 0)) return saved.value;
  const elements = await overpassQuery(`way(id:${ids.join(',')})->.holes;rel(bw.holes)[boundary=administrative];out body bb;`, {
    ...options, extent: host.bounds, queryTimeout: 8,
  });
  const value = enclosedTerritories(host, elements);
  await queryCache?.set(key, { expires: Date.now() + 86400000, value }).catch(() => {});
  return value;
}
