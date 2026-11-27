import { overpassQuery } from './overpass.mjs';
import { validExtent } from './overpass-coverage.mjs';

// Connected boundary ways bound each island separately. Never infer a smaller
// search area from the city centre or accept a replica's incomplete relation.
export function connectedBounds(elements, relation) {
  const boundary = elements.find(element => element.type === 'relation' && element.id === relation);
  if (!Array.isArray(boundary?.members) || boundary.members.some(member =>
    member.type === 'relation' && member.role !== 'subarea')) return null;
  const ids = new Set(boundary.members.filter(member => member.type === 'way').map(member => member.ref));
  if (!ids.size) return null;
  const ways = new Map(elements.filter(element => element.type === 'way' && ids.has(element.id)).map(way => [way.id, way]));
  if (ways.size !== ids.size || [...ways.values()].some(way => !validExtent(way.bounds) ||
      !Array.isArray(way.nodes) || way.nodes.length < 2 || way.nodes.some(node => !Number.isSafeInteger(node)))) return null;
  const owners = new Map(), parent = new Map([...ids].map(id => [id, id]));
  function root(id) {
    if (parent.get(id) !== id) parent.set(id, root(parent.get(id)));
    return parent.get(id);
  }
  for (const way of ways.values()) for (const node of way.nodes) {
    if (owners.has(node)) parent.set(root(way.id), root(owners.get(node)));
    else owners.set(node, way.id);
  }
  const groups = new Map();
  for (const way of ways.values()) {
    const id = root(way.id), box = way.bounds, previous = groups.get(id);
    groups.set(id, previous ? {
      minlat: Math.min(previous.minlat, box.minlat), minlon: Math.min(previous.minlon, box.minlon),
      maxlat: Math.max(previous.maxlat, box.maxlat), maxlon: Math.max(previous.maxlon, box.maxlon),
    } : { ...box });
  }
  return [...groups.values()];
}

export async function cityBoundaryParts(boundary, city, { force = false, queryCache, ...options } = {}) {
  const box = boundary.bounds;
  if (!validExtent(box)) return undefined;
  const key = 'shape-v1/' + boundary.relation;
  const saved = await queryCache?.get(key).catch(() => undefined);
  if (saved?.expires > Date.now() && saved.value?.parts && saved.value.segments) return saved.value;
  if (!force && Math.max(box.maxlat - box.minlat, box.maxlon - box.minlon) <= 2) return undefined;
  const { latitude, longitude } = city;
  const elements = await overpassQuery(`rel(${boundary.relation})->.boundary;.boundary out body;way(r.boundary);out body bb geom;`, {
    ...options, extent: { minlat: latitude, maxlat: latitude, minlon: longitude, maxlon: longitude }, queryTimeout: 8,
    accept: elements => connectedBounds(elements, boundary.relation) !== null && boundarySegments(elements, boundary.relation) !== null,
  });
  const value = { parts: connectedBounds(elements, boundary.relation), segments: boundarySegments(elements, boundary.relation) };
  await queryCache?.set(key, { expires: Date.now() + 86400000, value }).catch(() => {});
  return value;
}

export function boundarySegments(elements, relation) {
  const members = elements.find(element => element.type === 'relation' && element.id === relation)?.members;
  if (!members) return null;
  const ids = new Set(members.filter(member => member.type === 'way').map(member => member.ref));
  const segments = [], ends = new Map();
  for (const way of elements.filter(element => element.type === 'way' && ids.has(element.id))) {
    if (!Array.isArray(way.geometry) || way.geometry.length !== way.nodes?.length ||
      way.geometry.some(point => !Number.isFinite(point?.lat) || Math.abs(point.lat) > 90 ||
        !Number.isFinite(point?.lon) || Math.abs(point.lon) > 180)) return null;
    for (const id of [way.nodes[0], way.nodes.at(-1)]) ends.set(id, (ends.get(id) || 0) + 1);
    for (let index = 1; index < way.geometry.length; index++) {
      const a = way.geometry[index - 1], b = way.geometry[index];
      if (Math.abs(a.lon - b.lon) > 180) return null;
      segments.push([a.lat, a.lon, b.lat, b.lon]);
    }
  }
  return segments.length && [...ends.values()].every(count => count % 2 === 0) ? segments : null;
}

export function containsPoint(segments) {
  // Index ray intersections by latitude rather than scanning every boundary
  // segment for every point in a densely mapped city.
  const bands = new Map();
  for (const segment of segments) {
    const [ay, , by] = segment;
    for (let band = Math.floor(Math.min(ay, by) * 10); band <= Math.floor(Math.max(ay, by) * 10); band++) {
      if (!bands.has(band)) bands.set(band, []);
      bands.get(band).push(segment);
    }
  }
  return point => {
    if (!Number.isFinite(point?.lat) || !Number.isFinite(point?.lon)) return false;
    const { lat: y, lon: x } = point;
    let inside = false;
    for (const [ay, ax, by, bx] of bands.get(Math.floor(y * 10)) || []) {
      if (Math.abs((x - ax) * (by - ay) - (y - ay) * (bx - ax)) < 1e-10 &&
        x >= Math.min(ax, bx) && x <= Math.max(ax, bx) && y >= Math.min(ay, by) && y <= Math.max(ay, by)) return true;
      if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
    }
    return inside;
  };
}

export function tiledBounds(parts, size = .2) {
  return parts.flatMap(box => {
    const rows = Math.max(1, Math.ceil((box.maxlat - box.minlat) / size));
    const columns = Math.max(1, Math.ceil((box.maxlon - box.minlon) / size));
    const result = [];
    for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) result.push({
      minlat: box.minlat + (box.maxlat - box.minlat) * row / rows,
      maxlat: box.minlat + (box.maxlat - box.minlat) * (row + 1) / rows,
      minlon: box.minlon + (box.maxlon - box.minlon) * column / columns,
      maxlon: box.minlon + (box.maxlon - box.minlon) * (column + 1) / columns,
    });
    return result;
  });
}
