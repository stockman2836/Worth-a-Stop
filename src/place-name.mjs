import { nameTranslationRequest } from './name-translation.mjs';

const machineNames = new Map();
export function rememberNameTranslations(entries, language) {
  for (const { text, translation } of entries) {
    machineNames.set(JSON.stringify([language, text]), translation);
    if (machineNames.size > 2000) machineNames.delete(machineNames.keys().next().value);
  }
}
export function placeTranslationRequest(place, language) {
  return nameTranslationRequest({ name: place?.name || place?.title,
    'name:ru': place?.names?.ru, 'name:en': place?.names?.en }, language);
}
export function machinePlaceName(place, language) {
  const request = placeTranslationRequest(place, language);
  return request && machineNames.get(JSON.stringify([language, request.text]));
}
export function placeName(place, language) {
  const original = place?.name || place?.title || '';
  const translated = place?.names?.[language];
  if (typeof translated === 'string' && translated.trim()) return translated;
  const machine = machinePlaceName(place, language);
  if (machine) return machine;
  if (language === 'ru') {
    if (/^\p{Script=Cyrillic}/u.test(original.trimStart())) return original;
    const english = place?.names?.en;
    if (typeof english === 'string' && english.trim()) return english;
  }
  return original;
}
