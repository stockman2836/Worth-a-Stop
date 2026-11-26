const copy = {
  ru: { title: 'Места рядом', loading: 'Ищем места…', empty: 'В радиусе 2 км подходящих мест не найдено.',
    scope: 'До 2 км от центра по прямой', error: 'Не удалось загрузить места.', retry: 'Попробовать снова',
    hours: 'Часы работы', museum: 'Музей', gallery: 'Галерея', viewpoint: 'Смотровая площадка',
    park: 'Парк', garden: 'Сад', marketplace: 'Рынок' },
  en: { title: 'Nearby places', loading: 'Looking for places…', empty: 'No matching places within 2 km.',
    scope: 'Within 2 km of the centre, straight-line distance', error: 'Could not load places.', retry: 'Try again',
    hours: 'Opening hours', museum: 'Museum', gallery: 'Gallery', viewpoint: 'Viewpoint',
    park: 'Park', garden: 'Garden', marketplace: 'Market' },
};

export function placesPanel(city, language, signal, open) {
  const text = copy[language];
  const details = document.createElement('details');
  details.dataset.placesId = city.id;
  const summary = document.createElement('summary');
  summary.textContent = text.title;
  summary.setAttribute('aria-label', text.title + ' · ' + city.name);
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  const list = document.createElement('ul');
  list.className = 'places';
  const credit = document.createElement('a');
  credit.href = 'https://www.openstreetmap.org/copyright';
  credit.textContent = '© OpenStreetMap contributors';
  const retry = document.createElement('button');
  retry.textContent = text.retry;
  retry.type = 'button';
  retry.hidden = true;
  details.append(summary, status, retry, list, credit);
  const km = new Intl.NumberFormat(language, { style: 'unit', unit: 'kilometer', maximumFractionDigits: 1 });
  const metres = new Intl.NumberFormat(language, { style: 'unit', unit: 'meter', maximumFractionDigits: 0 });
  async function load() {
    retry.hidden = true;
    status.textContent = text.loading;
    try {
      const query = new URLSearchParams({ lat: city.latitude, lon: city.longitude });
      const response = await fetch('/api/places?' + query, { signal });
      if (!response.ok) throw Error('Places unavailable');
      const places = await response.json();
      if (signal.aborted) return;
      for (const place of places) {
        const item = document.createElement('li');
        const link = document.createElement('a');
        link.href = place.url;
        link.textContent = place.names[language] || place.name;
        const info = document.createElement('span');
        info.className = 'event-venue';
        const distance = place.km < 1 ? metres.format(place.km * 1000) : km.format(place.km);
        info.textContent = [text[place.category], distance, place.hours && text.hours + ' · ' + place.hours].filter(Boolean).join(' · ');
        item.append(link, info);
        list.append(item);
      }
      status.textContent = places.length ? text.scope : text.empty;
    } catch {
      if (signal.aborted) return;
      status.textContent = text.error;
      retry.hidden = false;
    }
  }
  details.addEventListener('toggle', () => { if (details.open && !status.textContent) load(); });
  retry.addEventListener('click', load);
  details.open = open;
  return details;
}
