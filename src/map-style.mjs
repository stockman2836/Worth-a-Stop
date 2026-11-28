export function localizedMapStyle(style, language) {
  if (!['ru', 'en'].includes(language)) throw Error('Unsupported map language');
  if (style?.version !== 8 || !Array.isArray(style.layers) || !style.sources) throw Error('Invalid map style');
  const result = structuredClone(style);
  // Legacy name_en can contain the local script when no translation exists.
  // Prefer the provider's explicit Latin label before that legacy fallback.
  const fields = ['name:en', 'name:latin', 'name_en', 'name'];
  let name = fields.reduceRight((fallback, field) => {
    const value = ['get', field];
    return ['case', ['!=', ['coalesce', value, ''], ''], value, fallback];
  }, '');
  const translated = ['coalesce', ['get', name, ['coalesce', ['global-state', 'translatedNames'], ['literal', {}]]], name];
  if (language === 'ru') {
    const local = ['coalesce', ['get', 'name'], ''];
    const first = ['slice', local, 0, 1];
    const russian = ['get', 'name:ru'];
    // Keep readable local Cyrillic names instead of romanizing Russian cities.
    name = ['case', ['!=', ['coalesce', russian, ''], ''], russian,
      ['all', ['>=', first, '\u0400'], ['<=', first, '\u052f']], local, translated];
  } else name = ['case', ['!=', ['coalesce', ['get', 'name:en'], ''], ''], ['get', 'name:en'], translated];
  result.state = { ...result.state, translatedNames: { default: {} } };
  for (const layer of result.layers) {
    const field = layer.layout?.['text-field'];
    // Numeric shields, runway references and other non-name labels stay intact.
    if (field !== undefined && /(?:"name(?::|_|"))|\{name(?::|_|\})/.test(JSON.stringify(field))) layer.layout['text-field'] = name;
  }
  return result;
}
