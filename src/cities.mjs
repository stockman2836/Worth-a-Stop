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

export async function searchCities(query, fetchResponse = fetch) {
  const name = query.trim();
  if (Array.from(name).length < 2) {
    throw new Error('Введите хотя бы два символа названия города.');
  }

  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.search = new URLSearchParams({ name, language: 'ru', count: '20' }).toString();
  const response = await fetchResponse(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    throw new Error(`Геокодер недоступен (HTTP ${response.status}).`);
  }
  return readCities(await response.json());
}
