import { validPlaceReference } from './place-reference.mjs';

export function referenceLink(place, labels) {
  if (!validPlaceReference(place.reference, place.wikidata) || !place.reference.wikipediaLanguages && !place.reference.names) return null;
  const link = document.createElement('a');
  link.className = 'place-reference';
  link.href = place.reference.url;
  link.textContent = place.reference.wikipediaLanguages ? `${labels.referenceLanguages}: ${place.reference.wikipediaLanguages}` : labels.nameReference;
  link.title = labels.prominenceReasons?.encyclopedic ?? '';
  return link;
}
