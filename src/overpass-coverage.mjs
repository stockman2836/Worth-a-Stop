// Provider dataset names, not a list of supported cities or countries.
const paths = { europe: 'api', 'north-america': 'api-na', 'central-america': 'api-ca',
  'south-america': 'api-sa', asia: 'api-as', africa: 'api-af', 'australia-oceania': 'api-oc' };

export function validExtent(box) {
  return box && ['minlat', 'minlon', 'maxlat', 'maxlon'].every(key => Number.isFinite(box[key])) &&
    box.minlat >= -90 && box.maxlat <= 90 && box.minlon >= -180 && box.maxlon <= 180 &&
    box.minlat <= box.maxlat && box.minlon <= box.maxlon;
}

function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[i], [bx, by] = ring[j];
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

// Conservative containment: even a boundary segment's box overlapping the query
// rules out this replica. This may skip a usable replica, but cannot clip a city.
function covers(polygon, box) {
  if (polygon.some(ring => !Array.isArray(ring) || ring.length < 4 || ring.some((point, index) =>
    !Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1]) ||
    Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90 || Math.abs(point[0] - ring[(index + 1) % ring.length][0]) > 180))) return false;
  const points = [[box.minlon, box.minlat], [box.maxlon, box.minlat], [box.maxlon, box.maxlat], [box.minlon, box.maxlat]];
  if (!points.every(([x, y]) => inRing(x, y, polygon[0]) && !polygon.slice(1).some(ring => inRing(x, y, ring)))) return false;
  return polygon.every(ring => ring.every(([x, y], index) => {
    const [px, py] = ring[(index + 1) % ring.length];
    return Math.max(x, px) < box.minlon || Math.min(x, px) > box.maxlon ||
      Math.max(y, py) < box.minlat || Math.min(y, py) > box.maxlat;
  }));
}

export function coveringMirrors(index, extent) {
  if (!validExtent(extent)) return [];
  return (index?.features ?? []).flatMap(feature => {
    const path = paths[feature.properties?.id];
    const geometry = feature.geometry;
    const polygons = geometry?.type === 'MultiPolygon' ? geometry.coordinates : geometry?.type === 'Polygon' ? [geometry.coordinates] : [];
    if (!path || !polygons.some(polygon => polygon.length && covers(polygon, extent))) return [];
    return [`https://ovp.dresel.systems/${path}/interpreter`];
  });
}

export function createCoverageLookup({ fetchResponse = fetch, now = Date.now } = {}) {
  let index, expires = 0, pending;
  return async extent => {
    if (!validExtent(extent)) return [];
    if (now() >= expires && !pending) {
      pending = (async () => {
        try {
          const response = await fetchResponse(new URL('https://download.geofabrik.de/index-v1.json'), {
            signal: AbortSignal.timeout(5000), headers: { 'User-Agent': 'Worth-a-Stop/0.1 (city travel planner)' },
          });
          if (!response.ok) throw Error('Coverage index unavailable');
          const data = await response.json();
          if (data.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw Error('Invalid coverage index');
          coveringMirrors(data, extent);
          index = data;
          expires = now() + 86400000;
        } catch { expires = now() + 300000; }
      })().finally(() => { pending = undefined; });
    }
    await pending;
    try { return coveringMirrors(index, extent); } catch { return []; }
  };
}
