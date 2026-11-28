export function localizedMapStyle(style, language) {
  if (!['ru', 'en'].includes(language)) throw Error('Unsupported map language');
  if (style?.version !== 8 || !Array.isArray(style.layers) || !style.sources) throw Error('Invalid map style');
  const result = structuredClone(style);
  const fields = language === 'en' ? ['name:en', 'name_en', 'name'] : ['name:ru', 'name'];
  const name = fields.reduceRight((fallback, field) => {
    const value = ['get', field];
    return ['case', ['!=', ['coalesce', value, ''], ''], value, fallback];
  }, '');
  for (const layer of result.layers) {
    const field = layer.layout?.['text-field'];
    // Numeric shields, runway references and other non-name labels stay intact.
    if (field !== undefined && /(?:"name(?::|_|"))|\{name(?::|_|\})/.test(JSON.stringify(field))) layer.layout['text-field'] = name;
  }
  return result;
}
