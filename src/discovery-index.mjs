import Supercluster from 'supercluster';

export function discoveryIndex(items) {
  const byKey = new Map(items.map(item => [item.key, item]));
  const index = new Supercluster({ radius: 80, extent: 256, maxZoom: 19,
    map: properties => ({ places: properties.kind === 'place' ? 1 : 0, events: properties.kind === 'event' ? 1 : 0 }),
    reduce: (sum, properties) => { sum.places += properties.places; sum.events += properties.events; },
  }).load(items.map(item => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [item.longitude, item.latitude] },
    properties: { key: item.key, kind: item.kind } })));
  return {
    visible: (bounds, zoom) => index.getClusters(bounds, zoom),
    item: feature => byKey.get(feature.properties.key),
    expansionZoom: id => index.getClusterExpansionZoom(id),
    members: (id, offset = 0, limit = 20) => index.getLeaves(id, limit, offset).map(feature => byKey.get(feature.properties.key)),
  };
}
