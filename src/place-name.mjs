export function placeName(place, language) {
  const translated = place?.names?.[language];
  return typeof translated === 'string' && translated.trim() ? translated : place?.name || place?.title || '';
}
