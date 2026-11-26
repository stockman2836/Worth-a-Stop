import { suggestCities } from './cities.mjs';
import { featuredCities } from './sources.mjs';
import { calendarsPanel } from './calendar-panel.mjs';
import { placesPanel } from './places-panel.mjs';

const copy = {
  ru: {
    official: 'Официальная афиша города', officialWait: 'Ищем официальную афишу…',
    officialEmpty: 'Ссылку на официальную афишу найти не удалось.', officialError: 'Не удалось проверить городские источники.',
    heading: 'В какой город поедешь?', label: 'Название города', placeholder: 'Например, Будапешт',
    search: 'Найти', language: 'Язык', attribution: 'Геоданные', loading: 'Ищем города…',
    short: 'Введите хотя бы два символа.', empty: 'Совпадений нет. Попробуйте другое написание.',
    error: 'Не удалось получить данные. Попробуйте ещё раз.', found: count => `Найдено городов — ${count}`,
    featured: 'Города с афишей', corrected: name => `Возможно, вы имели в виду «${name}»?`,
    guide: 'Путеводитель Wikivoyage', guideLinks: 'Фестивали и события из путеводителя',
    guideWait: 'Ищем местный путеводитель…', guideError: 'Не удалось проверить Wikivoyage.',
    day: 'Афиша на день', calendars: 'Календари площадок и путеводитель', looking: 'Ищем программы площадок в OpenAgenda…',
    none: km => `В OpenAgenda нет программ с текущими или предстоящими событиями в радиусе ${km} км.`,
    unavailable: 'Не удалось проверить каталог OpenAgenda.', refresh: 'Проверить снова',
    nearby: km => `Программы OpenAgenda в радиусе ${km} км`, feed: 'Календарь (.ics)',
    saved: 'Каталог недоступен. Показан сохранённый результат.', checked: 'Проверено',
  },
  en: {
    official: 'Official city events', officialWait: 'Looking for the official city calendar…',
    officialEmpty: 'No official calendar link found.', officialError: 'Could not check the city sources.',
    heading: 'Which city are you visiting?', label: 'City name', placeholder: 'For example, Budapest',
    search: 'Search', language: 'Language', attribution: 'Location data', loading: 'Searching for cities…',
    short: 'Enter at least two characters.', empty: 'No matches. Try another spelling.',
    error: 'Could not load cities. Try again.', found: count => `Cities found — ${count}`,
    featured: 'Cities with event listings', corrected: name => `Did you mean “${name}”?`,
    guide: 'Wikivoyage travel guide', guideLinks: 'Festival and event links from the guide',
    guideWait: 'Looking for a local travel guide…', guideError: 'Could not check Wikivoyage.',
    day: 'Events by day', calendars: 'Venue calendars and travel guide', looking: 'Looking up venue calendars on OpenAgenda…',
    none: km => `OpenAgenda lists no calendars with current or upcoming events within ${km} km.`,
    unavailable: 'The OpenAgenda directory could not be checked.', refresh: 'Check again',
    nearby: km => `OpenAgenda calendars within ${km} km`, feed: 'Calendar (.ics)',
    saved: 'The directory is unavailable. Showing the saved result.', checked: 'Checked',
  },
};

const form = document.querySelector('#search-form');
const input = document.querySelector('#query');
const status = document.querySelector('#status');
const results = document.querySelector('#results');
const buttons = document.querySelectorAll('[data-language]');
const preferenceKey = 'worth-a-stop.language';
let language = navigator.language.toLowerCase().startsWith('ru') ? 'ru' : 'en';
let storage;
try {
  storage = window.localStorage;
  const saved = storage.getItem(preferenceKey);
  if (Object.hasOwn(copy, saved)) language = saved;
} catch { /* The site also works when the browser disables storage. */ }

let submittedQuery = null;
let requestId = 0;
let timer;
let searchController;
let selectedCountry;
const featured = document.querySelector('#featured');
const featuredList = document.querySelector('#featured-cities');

function renderLanguage() {
  const text = copy[language];
  document.documentElement.lang = language;
  document.title = `${text.label} · Worth a Stop`;
  document.querySelector('#heading').textContent = text.heading;
  document.querySelector('#query-label').textContent = text.label;
  document.querySelector('#submit').textContent = text.search;
  document.querySelector('#attribution').textContent = text.attribution;
  document.querySelector('#languages').setAttribute('aria-label', text.language);
  input.placeholder = text.placeholder;
  document.querySelector('#featured-label').textContent = text.featured;
  for (const button of buttons) {
    button.setAttribute('aria-pressed', String(button.dataset.language === language));
  }
}

function cityRow(city, openId, initialDate, signal, placesId, selection) {
  const row = document.createElement('li');
  const name = document.createElement('button');
  name.type = 'button';
  name.className = 'city-name';
  const area = document.createElement('span');
  const zone = document.createElement('span');
  name.textContent = city.name;
  area.textContent = [city.region, city.country ?? city.countryCode].filter(Boolean).join(', ');
  zone.textContent = city.timezone;
  zone.className = 'zone';
  const open = String(city.id) === openId;
  const places = placesPanel(city, language, signal, String(city.id) === placesId, selection);
  const panel = calendarsPanel(city, open, language, copy[language], storage, open ? initialDate : undefined, signal, places);
  name.addEventListener('click', () => {
    input.value = city.name;
    submittedQuery = city.name;
    selectedCountry = city.countryCode;
    results.replaceChildren(row);
    status.textContent = '';
    panel.open = true;
    panel.querySelector('summary').focus();
  });
  row.append(name, area, zone, places.element, panel);
  return row;
}

function cancelSearch() {
  clearTimeout(timer);
  searchController?.abort();
  requestId++;
}

async function showSearch(query, openId, openSingle = false, initialDate, placesId, selection) {
  cancelSearch();
  const currentRequest = requestId;
  searchController = new AbortController();
  const { signal } = searchController;
  const text = copy[language];
  results.replaceChildren();
  if (Array.from(query).length < 2) {
    status.textContent = text.short;
    return;
  }
  status.textContent = text.loading;
  try {
    const lookup = (url, options) => fetch(url, { ...options, signal: AbortSignal.any([options.signal, signal]) });
    const { cities, correction } = await suggestCities(query, lookup, language, selectedCountry);
    if (currentRequest !== requestId) return;
    if (!openId && openSingle && cities.length === 1) openId = String(cities[0].id);
    results.replaceChildren(...cities.map(city => cityRow(city, openId, initialDate, signal, placesId, selection)));
    status.textContent = correction ? text.corrected(correction) : cities.length ? text.found(cities.length) : text.empty;
  } catch {
    if (currentRequest === requestId) status.textContent = text.error;
  }
}

function queueSearch(event) {
  cancelSearch();
  selectedCountry = undefined;
  submittedQuery = null;
  results.replaceChildren();
  status.textContent = '';
  const query = input.value.trim();
  featured.hidden = Boolean(query) || !featuredList.childElementCount;
  if (event.isComposing || Array.from(query).length < 2) return;
  timer = setTimeout(() => {
    submittedQuery = query;
    showSearch(query);
  }, 300);
}
input.addEventListener('input', queueSearch);
input.addEventListener('compositionend', queueSearch);
input.addEventListener('keydown', event => {
  if (event.key === 'ArrowDown' && results.firstElementChild) {
    event.preventDefault();
    results.querySelector('.city-name').focus();
  }
});

form.addEventListener('submit', event => {
  event.preventDefault();
  submittedQuery = input.value.trim();
  featured.hidden = Boolean(submittedQuery) || !featuredList.childElementCount;
  showSearch(submittedQuery, undefined, true);
});

for (const button of buttons) {
  button.addEventListener('click', () => {
    if (language === button.dataset.language) return;
    language = button.dataset.language;
    try { storage?.setItem(preferenceKey, language); } catch { /* Optional preference. */ }
    renderLanguage();
    if (submittedQuery !== null) {
      const panel = results.querySelector('details[data-city-id][open]');
      const placesId = results.querySelector('details[data-places-id][open]')?.dataset.placesId;
      const selectedPlaces = results.querySelector('details[data-places-id][open]');
      const selection = selectedPlaces && { date: selectedPlaces.querySelector('input[type=date]').value,
        time: selectedPlaces.querySelector('input[type=time]').value };
      showSearch(submittedQuery, panel?.dataset.cityId, false, panel?.querySelector('input[type=date]')?.value, placesId, selection);
    }
  });
}

renderLanguage();
featuredCities().then(cities => {
  for (const city of cities) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `${city.name} · ${city.countryCode}`;
    button.addEventListener('click', () => {
      input.value = city.name;
      submittedQuery = city.name;
      selectedCountry = city.countryCode;
      featured.hidden = true;
      showSearch(city.name, undefined, true);
    });
    featuredList.append(button);
  }
  featured.hidden = Boolean(input.value.trim()) || !cities.length;
}).catch(() => { /* City search works independently of the suggested destinations. */ });
