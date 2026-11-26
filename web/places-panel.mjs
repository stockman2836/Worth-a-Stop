import { loadPlaces } from './saved-places.mjs';
import { placesMap } from './places-map.mjs';

const copy = {
  ru: { title: 'Места рядом', loading: 'Ищем места…', empty: 'В радиусе 2 км подходящих мест не найдено.',
    scope: 'До 2 км от центра по прямой', error: 'Не удалось загрузить места.', retry: 'Попробовать снова',
    hours: 'Часы работы', museum: 'Музей', gallery: 'Галерея', viewpoint: 'Смотровая площадка',
    park: 'Парк', garden: 'Сад', marketplace: 'Рынок', map: 'Карта мест',
    zoomIn: 'Приблизить', zoomOut: 'Отдалить', unknown: 'Часы работы не указаны',
    tilesError: 'Не удалось загрузить часть карты.', saved: 'Источник недоступен. Показана сохранённая подборка от',
    source: 'Открыть в OpenStreetMap', legend: 'Круги — места · ромбы — события выбранного дня' },
  en: { title: 'Nearby places', loading: 'Looking for places…', empty: 'No matching places within 2 km.',
    scope: 'Within 2 km of the centre, straight-line distance', error: 'Could not load places.', retry: 'Try again',
    hours: 'Opening hours', museum: 'Museum', gallery: 'Gallery', viewpoint: 'Viewpoint',
    park: 'Park', garden: 'Garden', marketplace: 'Market', map: 'Map of places',
    zoomIn: 'Zoom in', zoomOut: 'Zoom out', unknown: 'Opening hours unspecified',
    tilesError: 'Some map tiles could not be loaded.', saved: 'Source unavailable. Showing places saved on',
    source: 'Open in OpenStreetMap', legend: 'Circles — places · diamonds — events for the selected day' },
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
  const mapBox = document.createElement('div');
  mapBox.className = 'places-map';
  mapBox.setAttribute('role', 'region');
  mapBox.setAttribute('aria-label', text.map + ' · ' + city.name);
  mapBox.hidden = true;
  let map;
  let events = [];
  let selectedEvent;
  function ensureMap() {
    if (map || !details.open || signal.aborted) return;
    mapBox.hidden = false;
    map = placesMap(mapBox, city, [], { ...text, name: place => place.names[language] || place.name }, () => {});
    map.setEvents(events);
  }
  let storage;
  try { storage = window.localStorage; } catch { /* Optional saved results. */ }
  signal.addEventListener('abort', () => map?.destroy(), { once: true });
  const credit = document.createElement('a');
  credit.href = 'https://www.openstreetmap.org/copyright';
  credit.textContent = '© OpenStreetMap contributors';
  const retry = document.createElement('button');
  retry.textContent = text.retry;
  retry.type = 'button';
  retry.hidden = true;
  const legend = document.createElement('p');
  legend.textContent = text.legend;
  details.append(summary, status, retry, mapBox, legend, list, credit);
  const km = new Intl.NumberFormat(language, { style: 'unit', unit: 'kilometer', maximumFractionDigits: 1 });
  const metres = new Intl.NumberFormat(language, { style: 'unit', unit: 'meter', maximumFractionDigits: 0 });
  async function load() {
    retry.hidden = true;
    status.textContent = text.loading;
    try {
      const { places, stale, checkedAt } = await loadPlaces(city, { signal, storage });
      if (signal.aborted) return;
      map?.destroy();
      map = undefined;
      list.replaceChildren();
      mapBox.hidden = false;
      function select(index) {
        for (const [i, item] of [...list.children].entries()) {
          item.classList.toggle('selected', i === index);
          item.querySelector('button').setAttribute('aria-pressed', String(i === index));
        }
      }
      map = placesMap(mapBox, city, places, { ...text, name: place => place.names[language] || place.name }, select);
      map.setEvents(events);
      if (selectedEvent && events.includes(selectedEvent)) map.selectEvent(selectedEvent);
      for (const [index, place] of places.entries()) {
        const item = document.createElement('li');
        const show = document.createElement('button');
        show.type = 'button';
        show.className = 'show-place';
        show.textContent = place.names[language] || place.name;
        show.setAttribute('aria-pressed', 'false');
        show.addEventListener('click', () => map.select(index));
        const link = document.createElement('a');
        link.href = place.url;
        link.textContent = text.source;
        const info = document.createElement('span');
        info.className = 'event-venue';
        const distance = place.km < 1 ? metres.format(place.km * 1000) : km.format(place.km);
        info.textContent = [text[place.category], distance, place.hours && text.hours + ' · ' + place.hours].filter(Boolean).join(' · ');
        item.append(show, info, link);
        list.append(item);
      }
      const date = new Intl.DateTimeFormat(language, { dateStyle: 'short', timeStyle: 'short' }).format(checkedAt);
      status.textContent = [places.length ? text.scope : text.empty, stale && text.saved + ' ' + date].filter(Boolean).join(' · ');
      retry.hidden = !stale;
    } catch {
      if (signal.aborted) return;
      status.textContent = text.error;
      retry.hidden = false;
    }
  }
  details.addEventListener('toggle', () => {
    if (details.open) { ensureMap(); if (!status.textContent) load(); }
  });
  retry.addEventListener('click', load);
  details.open = open;
  return {
    element: details,
    setEvents(value) { events = value; selectedEvent = undefined; map?.setEvents(events); },
    selectEvent(event) {
      selectedEvent = event;
      details.open = true;
      ensureMap();
      map?.selectEvent(event);
      mapBox.scrollIntoView({ block: 'center', behavior: 'auto' });
    },
  };
}
