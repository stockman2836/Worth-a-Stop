export function validPlaceReference(reference, id) {
  return typeof id === 'string' && /^Q[1-9]\d*$/.test(id) && reference?.url === `https://www.wikidata.org/wiki/${id}` &&
    Number.isInteger(reference.wikipediaLanguages) && reference.wikipediaLanguages >= 0 && reference.wikipediaLanguages <= 1000 &&
    Number.isFinite(reference.checkedAt) && reference.checkedAt >= 0 && reference.checkedAt <= Date.now() &&
    (reference.names === undefined || reference.names !== null && typeof reference.names === 'object' && !Array.isArray(reference.names) &&
      Object.entries(reference.names).every(([language, value]) => ['ru', 'en'].includes(language) && typeof value === 'string' && value.trim() && value.length <= 500));
}
