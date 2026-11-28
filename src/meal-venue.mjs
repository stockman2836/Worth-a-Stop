import { eventLocation } from './event-location.mjs';

export const mealCategories = ['cafe', 'restaurant', 'fast_food', 'food_court'];
export function validMealVenue(value) {
  return Boolean(value && typeof value.name === 'string' && value.name.trim() && value.name.length <= 300 &&
    eventLocation(value.latitude, value.longitude) && mealCategories.includes(value.category) &&
    /^https:\/\/www\.openstreetmap\.org\/(node|way|relation)\/[1-9]\d*$/.test(value.url) &&
    value.names && typeof value.names === 'object' && !Array.isArray(value.names) && ['ru', 'en'].every(language => value.names[language] == null ||
      typeof value.names[language] === 'string' && value.names[language].length <= 300) &&
    (value.hours == null || typeof value.hours === 'string' && value.hours.length <= 2000));
}

export function mealVenue(value) {
  if (!validMealVenue(value)) throw Error('Invalid meal venue');
  const names = Object.fromEntries(['ru', 'en'].filter(language => typeof value.names[language] === 'string' && value.names[language].trim())
    .map(language => [language, value.names[language].trim()]));
  return { name: value.name.trim(), names, latitude: value.latitude, longitude: value.longitude,
    category: value.category, hours: value.hours?.trim() || null, url: value.url,
    ...(Number.isFinite(value.checkedAt) && { checkedAt: value.checkedAt }) };
}
