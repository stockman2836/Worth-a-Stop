import { containsPoint } from './city-boundary-parts.mjs';

const valid = point => Number.isFinite(point?.lat) && Math.abs(point.lat) <= 90 && Number.isFinite(point?.lon) && Math.abs(point.lon) <= 180;

function polygonSegments(element) {
  if (element.tags?.area === 'no') return null;
  let lines;
  if (element.type === 'way') lines = [element.geometry];
  else if (element.type === 'relation' && ['multipolygon', 'boundary'].includes(element.tags?.type)) {
    const members = element.members?.filter(member => ['', 'outer', 'inner'].includes(member.role));
    if (!members?.length || members.some(member => member.type !== 'way')) return null;
    lines = members.map(member => member.geometry);
  } else return null;
  const ends = new Map(), segments = [];
  for (const line of lines) {
    if (!Array.isArray(line) || line.length < 2 || !line.every(valid)) return null;
    for (const point of [line[0], line.at(-1)]) {
      const key = `${point.lat}/${point.lon}`;
      ends.set(key, (ends.get(key) ?? 0) + 1);
    }
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1], b = line[i];
      if (Math.abs(a.lon - b.lon) > 180) return null;
      if (a.lat !== b.lat || a.lon !== b.lon) segments.push([a.lat, a.lon, b.lat, b.lon]);
    }
  }
  return segments.length && [...ends.values()].every(count => count % 2 === 0) ? segments : null;
}

function interiorPoint(segments, centre) {
  const inside = containsPoint(segments);
  if (inside(centre)) return centre;
  function row(lat) {
    const crossings = segments.flatMap(([ay, ax, by, bx]) =>
      (ay > lat) !== (by > lat) ? [ax + (lat - ay) * (bx - ax) / (by - ay)] : []).sort((a, b) => a - b);
    let widest = 0, point;
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const width = crossings[i + 1] - crossings[i];
      if (width > widest) { widest = width; point = { lat, lon: (crossings[i] + crossings[i + 1]) / 2 }; }
    }
    return point && inside(point) ? point : undefined;
  }
  const middle = row(centre.lat);
  if (middle) return middle;
  // A multipart feature may have no land at its bounding-box mid-latitude.
  // Rows between vertex heights avoid degenerate intersections at corners.
  const heights = [...new Set(segments.flatMap(([ay, , by]) => [ay, by]))].sort((a, b) => a - b);
  const gaps = heights.slice(1).map((height, i) => ({ lat: (height + heights[i]) / 2, width: height - heights[i] }))
    .sort((a, b) => b.width - a.width);
  for (const gap of gaps) { const point = row(gap.lat); if (point) return point; }
}

export function placePoint(element) {
  if (element.type === 'node' && valid(element)) return { lat: element.lat, lon: element.lon };
  const points = element.geometry ?? element.members?.flatMap(member => member.geometry ?? [member]) ?? [];
  let south = Infinity, west = Infinity, north = -Infinity, east = -Infinity;
  for (const point of points) {
    if (!valid(point)) continue;
    south = Math.min(south, point.lat); north = Math.max(north, point.lat);
    west = Math.min(west, point.lon); east = Math.max(east, point.lon);
  }
  const centre = valid(element.center) ? element.center : { lat: (south + north) / 2, lon: (west + east) / 2 };
  const segments = polygonSegments(element);
  if (segments) return interiorPoint(segments, centre) ?? centre;
  return valid(centre) ? centre : valid(element) ? { lat: element.lat, lon: element.lon } : undefined;
}
