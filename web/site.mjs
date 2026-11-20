import { searchCities } from './cities.mjs';

const copy = {
  ru: {
    heading: 'В какой город поедешь?', label: 'Название города', placeholder: 'Например, Будапешт',
    search: 'Найти', language: 'Язык', attribution: 'Геоданные', loading: 'Ищем города…',
    short: 'Введите хотя бы два символа.', empty: 'Совпадений нет. Попробуйте другое написание.',
    error: 'Не удалось получить данные. Попробуйте ещё раз.', found: count => `Найдено городов — ${count}`,
  },
  en: {
    heading: 'Which city are you visiting?', label: 'City name', placeholder: 'For example, Budapest',
    search: 'Search', language: 'Language', attribution: 'Location data', loading: 'Searching for cities…',
    short: 'Enter at least two characters.', empty: 'No matches. Try another spelling.',
    error: 'Could not load cities. Try again.', found: count => `Cities found — ${count}`,
  },
};

const form = document.querySelector('#search-form');
const input = document.querySelector('#query');
const status = document.querySelector('#status');
const results = document.querySelector('#results');
const buttons = document.querySelectorAll('[data-language]');
const preferenceKey = 'worth-a-stop.language';
let language = navigator.language.toLowerCase().startsWith('ru') ? 'ru' : 'en';
try {
  const saved = localStorage.getItem(preferenceKey);
  if (Object.hasOwn(copy, saved)) language = saved;
} catch { /* The site also works when the browser disables storage. */ }

let submittedQuery = null;
let requestId = 0;

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
  for (const button of buttons) {
    button.setAttribute('aria-pressed', String(button.dataset.language === language));
  }
}

function cityRow(city) {
  const row = document.createElement('li');
  const name = document.createElement('strong');
  const area = document.createElement('span');
  const zone = document.createElement('span');
  name.textContent = city.name;
  area.textContent = [city.region, city.country ?? city.countryCode].filter(Boolean).join(', ');
  zone.textContent = city.timezone;
  zone.className = 'zone';
  row.append(name, area, zone);
  return row;
}

async function showSearch(query) {
  const currentRequest = ++requestId;
  const text = copy[language];
  results.replaceChildren();
  if (Array.from(query).length < 2) {
    status.textContent = text.short;
    return;
  }
  status.textContent = text.loading;
  try {
    const cities = await searchCities(query, fetch, language);
    if (currentRequest !== requestId) return;
    results.replaceChildren(...cities.map(cityRow));
    status.textContent = cities.length ? text.found(cities.length) : text.empty;
  } catch {
    if (currentRequest === requestId) status.textContent = text.error;
  }
}

form.addEventListener('submit', event => {
  event.preventDefault();
  submittedQuery = input.value.trim();
  showSearch(submittedQuery);
});

for (const button of buttons) {
  button.addEventListener('click', () => {
    if (language === button.dataset.language) return;
    language = button.dataset.language;
    try { localStorage.setItem(preferenceKey, language); } catch { /* Optional preference. */ }
    renderLanguage();
    if (submittedQuery !== null) showSearch(submittedQuery);
  });
}

renderLanguage();
