export function validTerritory(value) {
  return typeof value?.name === 'string' && Boolean(value.name.trim()) &&
    typeof value.names === 'object' && value.names !== null &&
    /^https:\/\/www\.openstreetmap\.org\/relation\/[1-9]\d*$/.test(value.url) &&
    ['country', 'territory'].includes(value.kind) &&
    (value.countryCode === undefined || /^[A-Z]{2}$/.test(value.countryCode));
}

export function territoryLabel(value, language) {
  if (!validTerritory(value)) return '';
  const caption = value.kind === 'country' ? language === 'ru' ? 'Страна' : 'Country' : language === 'ru' ? 'Территория' : 'Territory';
  return `${caption}: ${value.names[language] || value.name}${value.countryCode ? ` (${value.countryCode})` : ''}`;
}
