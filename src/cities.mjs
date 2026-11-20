function readCities(payload) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Геокодер вернул неожиданный формат ответа.');
  }
  // Open-Meteo omits the results field when there are no matches.
  const { results = [] } = payload;
  if (!Array.isArray(results)) {
    throw new Error('Геокодер вернул некорректный список мест.');
  }

  // GeoNames uses the PPL prefix for populated places.
  const settlements = results.filter(place => place?.feature_code?.startsWith('PPL'));
  return settlements.map(place => {
    const { id, name, latitude, longitude } = place;
    if (!Number.isSafeInteger(id) || typeof name !== 'string' || !name.trim()) {
      throw new Error('У найденного города отсутствует название или идентификатор.');
    }
    if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 ||
        !Number.isFinite(longitude) || Math.abs(longitude) > 180) {
      throw new Error('У найденного города некорректные координаты.');
    }
    return {
      id, name, latitude, longitude,
      region: place.admin1 ?? null,
      country: place.country ?? null,
      countryCode: place.country_code ?? null,
      timezone: place.timezone ?? null,
    };
  });
}

export async function searchCities(query, fetchResponse = fetch, language = 'ru', countryCode) {
  const name = query.trim();
  if (Array.from(name).length < 2) {
    throw new Error('Введите хотя бы два символа названия города.');
  }

  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.search = new URLSearchParams({ name, language, count: '20' }).toString();
  if (countryCode) url.searchParams.set('countryCode', countryCode);
  const response = await fetchResponse(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    throw new Error(`Геокодер недоступен (HTTP ${response.status}).`);
  }
  return readCities(await response.json());
}

function folded(name) {
  return name.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').trim();
}

// Adjacent transpositions count as one edit (e.g. "Lnodon").
function spellingDistance(left, right) {
  const a = Array.from(folded(left));
  const b = Array.from(folded(right));
  const rows = Array.from({ length: a.length + 1 }, () => Array(b.length + 1));
  for (let i = 0; i <= a.length; i++) rows[i][0] = i;
  for (let j = 0; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + Number(a[i - 1] !== b[j - 1]));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
      }
    }
  }
  return rows[a.length][b.length];
}

export async function suggestCities(query, fetchResponse = fetch, language = 'ru', countryCode) {
  const name = query.trim();
  const cities = await searchCities(name, fetchResponse, language, countryCode);
  const chars = Array.from(name);
  if (cities.length || chars.length < 4 || chars.length > 80 || name.includes(',')) {
    return { cities, correction: null };
  }
  const spellingLanguage = /\p{Script=Cyrillic}/u.test(name) ? 'ru' : 'en';
  const maxDistance = chars.length >= 7 ? 2 : 1;
  const prefix = chars.slice(0, 3).join('');
  const candidates = await searchCities(prefix, fetchResponse, spellingLanguage, countryCode);
  const ranked = candidates.map(city => ({ city, distance: spellingDistance(name, city.name) }))
    .filter(match => match.distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance);
  let correction = ranked[0]?.city.name;

  if (!correction) {
    const url = new URL(`https://${spellingLanguage}.wikipedia.org/w/api.php`);
    url.search = new URLSearchParams({ action: 'query', list: 'search', srsearch: name, srinfo: 'suggestion',
      srprop: '', srlimit: '1', format: 'json', origin: '*' });
    let suggestion;
    try {
      const response = await fetchResponse(url, { signal: AbortSignal.timeout(6000) });
      if (response.ok) suggestion = (await response.json()).query?.searchinfo?.suggestion;
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      // The geocoder already returned a valid empty result.
    }
    if (suggestion && suggestion.length <= 80 && folded(suggestion) !== folded(name) &&
        spellingDistance(name, suggestion) <= maxDistance) {
      const candidates = await searchCities(suggestion, fetchResponse, spellingLanguage, countryCode);
      correction = candidates.find(city => folded(city.name) === folded(suggestion))?.name;
      if (correction && language === spellingLanguage) return { cities: candidates, correction };
    }
  }
  if (!correction) return { cities, correction: null };
  const matches = await searchCities(correction, fetchResponse, language, countryCode);
  return { cities: matches, correction: matches.length ? correction : null };
}
