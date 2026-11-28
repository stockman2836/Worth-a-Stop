import { validPlaceReference } from './place-reference.mjs';

export function referenceLink(place, labels) {
  if (!validPlaceReference(place.reference, place.wikidata) || !place.reference.wikipediaLanguages) return null;
  const link = document.createElement('a');
  link.className = 'place-reference';
  link.href = place.reference.url;
  link.textContent = `${labels.referenceLanguages}: ${place.reference.wikipediaLanguages}`;
  link.title = labels.prominenceReasons?.encyclopedic ?? '';
  return link;
}
