import { suggestCities } from './cities.mjs';
import { featuredCities } from './sources.mjs';
import { cityWorkspace } from './city-workspace.mjs';

const copy = {
  ru: {
    official: 'Официальная афиша города', officialWait: 'Ищем официальную афишу…',
    officialEmpty: 'Ссылку на официальную афишу найти не удалось.', officialError: 'Не удалось проверить городские источники.',
    heading: 'Новый город. Твой день.', label: 'Куда отправимся?', placeholder: 'Например, Будапешт',
    eyebrow: 'ПРОГУЛКИ, КОТОРЫЕ ЗАПОМНЯТСЯ', lead: 'Интересные места, местная афиша и маршрут, который складывается в твой день.', tagline: 'Каждая остановка — открытие.',
    journey: 'Один город. Твой маршрут.',
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
    heading: 'A new city. A day of your own.', label: 'Where shall we go?', placeholder: 'For example, Budapest',
    eyebrow: 'MAKE A DAY OF IT', lead: 'Discover interesting places, find local events and build a day worth remembering.', tagline: 'Make every stop count.',
    journey: 'One city. Your way.',
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
let workspaceController;
let activeWorkspace;
let selectedCountry;
const featured = document.querySelector('#featured');
const featuredList = document.querySelector('#featured-cities');

function renderLanguage() {
  const text = copy[language];
  document.documentElement.lang = language;
  document.title = `${text.label} · Worth a Stop`;
  const split = text.heading.indexOf('.') + 1;
  const accent = document.createElement('span');
  accent.className = 'heading-accent';
  accent.textContent = text.heading.slice(split).trim();
  document.querySelector('#heading').replaceChildren(text.heading.slice(0, split), document.createElement('br'), accent);
  document.querySelector('#journey-caption').textContent = text.journey;
  document.querySelector('#intro-eyebrow').textContent = text.eyebrow;
  document.querySelector('#intro-lead').textContent = text.lead;
  document.querySelector('#tagline').textContent = text.tagline;
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

function cityRow(city) {
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
  name.addEventListener('click', () => openCity(city));
  row.append(name, area, zone);
  return row;
}

function closeCity() {
  workspaceController?.abort();
  activeWorkspace = undefined;
  document.body.classList.remove('workspace-active');
  results.replaceChildren();
  status.textContent = '';
  selectedCountry = undefined;
  renderLanguage();
  input.focus();
  input.select();
}

function openCity(city, selection) {
  cancelSearch();
  workspaceController?.abort();
  workspaceController = new AbortController();
  const view = cityWorkspace(city, language, copy[language], storage, workspaceController.signal, selection, closeCity);
  activeWorkspace = { city, view };
  input.value = submittedQuery = city.name;
  selectedCountry = city.countryCode;
  document.body.classList.add('workspace-active');
  const shell = document.createElement('li');
  shell.className = 'workspace-shell';
  shell.append(view.element);
  results.replaceChildren(shell);
  status.textContent = '';
  featured.hidden = true;
  document.title = `${city.name} · Worth a Stop`;
  const title = view.element.querySelector('h1');
  title.tabIndex = -1;
  title.focus({ preventScroll: true });
}

function cancelSearch() {
  clearTimeout(timer);
  searchController?.abort();
  requestId++;
}

async function showSearch(query, openSingle = false) {
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
    if (openSingle && cities.length === 1) { openCity(cities[0]); return; }
    results.replaceChildren(...cities.map(cityRow));
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
  showSearch(submittedQuery, true);
});

for (const button of buttons) {
  button.addEventListener('click', () => {
    if (language === button.dataset.language) return;
    language = button.dataset.language;
    try { storage?.setItem(preferenceKey, language); } catch { /* Optional preference. */ }
    renderLanguage();
    if (activeWorkspace) openCity(activeWorkspace.city, activeWorkspace.view.selection());
    else if (submittedQuery !== null) showSearch(submittedQuery);
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
      showSearch(city.name, true);
    });
    featuredList.append(button);
  }
  featured.hidden = Boolean(input.value.trim()) || !cities.length;
}).catch(() => { /* City search works independently of the suggested destinations. */ });
