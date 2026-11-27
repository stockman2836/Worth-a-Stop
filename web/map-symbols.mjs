import { icon } from './icons.mjs';

export const placeSymbols = {
  museum: { icon: 'landmark', label: 'legendMuseums' }, gallery: { icon: 'palette', label: 'legendArt' },
  theatre: { icon: 'drama', label: 'theatre' },
  historic: { icon: 'castle', label: 'legendHistoric' }, worship: { icon: 'church', label: 'legendWorship' },
  nature: { icon: 'trees', label: 'legendNature' }, viewpoint: { icon: 'binoculars', label: 'viewpoint' },
  marketplace: { icon: 'shopping-basket', label: 'marketplace' }, attraction: { icon: 'map-pin', label: 'attraction' },
};

export function placeGroup(category) {
  if (category === 'artwork') return 'gallery';
  if (['castle', 'monument', 'ruins', 'archaeological_site', 'city_gate', 'amphitheatre', 'fort', 'palace'].includes(category)) return 'historic';
  if (['cathedral', 'basilica', 'church', 'temple', 'monastery'].includes(category)) return 'worship';
  if (['park', 'garden'].includes(category)) return 'nature';
  return Object.hasOwn(placeSymbols, category) ? category : 'attraction';
}

export function markerFace(name) {
  const face = document.createElement('span'); face.className = 'marker-face';
  face.append(icon(name));
  return face;
}

export function updateLegend(element, places, labels) {
  element.replaceChildren();
  element.setAttribute('aria-label', labels.legend);
  const groups = [...new Set(places.map(place => placeGroup(place.category)))];
  const entries = groups.map(group => ({ group, ...placeSymbols[group] }));
  entries.push({ group: 'event', icon: 'calendar-days', label: 'legendEvents' },
    { group: 'origin', icon: 'flag', label: 'origin' }, { group: 'route', label: 'legendRoute' }, { group: 'cluster', label: 'legendCluster' });
  for (const entry of entries) {
    const item = document.createElement('li'); item.dataset.group = entry.group;
    const symbol = document.createElement('span'); symbol.className = 'legend-symbol';
    symbol.append(entry.icon ? icon(entry.icon) : document.createTextNode(entry.group === 'cluster' ? '12' : '1'));
    item.append(symbol, document.createTextNode(labels[entry.label])); element.append(item);
  }
}
