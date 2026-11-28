// Translate only missing labels. Published names always take precedence.
export function nameTranslationRequest(properties, language) {
  const text = key => typeof properties?.[key] === 'string' ? properties[key].trim() : '';
  const original = text('name');
  if (language === 'ru' && (text('name:ru') || /^\p{Script=Cyrillic}/u.test(original))) return;
  const english = text('name:en');
  if (language === 'en' && english) return;
  const value = english || text('name:latin') || text('name_en') || original;
  if (!value || value.length > 150 || !['ru', 'en'].includes(language)) return;
  const latin = !/[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u.test(value);
  if (language === 'en' && latin) return;
  return { text: value, source: english && latin ? 'en' : 'autodetect' };
}

export function translationKey(item, target) { return JSON.stringify([target, item.source, item.text]); }
