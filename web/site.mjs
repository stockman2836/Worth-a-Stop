import { searchCities } from './cities.mjs';
import { findSources } from './sources.mjs';

const copy = {
  ru: {
    heading: 'В какой город поедешь?', label: 'Название города', placeholder: 'Например, Будапешт',
    search: 'Найти', language: 'Язык', attribution: 'Геоданные', loading: 'Ищем города…',
    short: 'Введите хотя бы два символа.', empty: 'Совпадений нет. Попробуйте другое написание.',
    error: 'Не удалось получить данные. Попробуйте ещё раз.', found: count => `Найдено городов — ${count}`,
    calendars: 'Афиши рядом', looking: 'Ищем программы площадок в OpenAgenda…',
    none: 'В OpenAgenda нет программ с текущими или предстоящими событиями в радиусе 5 км.',
    unavailable: 'Не удалось проверить каталог OpenAgenda.', refresh: 'Проверить снова',
    nearby: 'Программы OpenAgenda в радиусе 5 км', feed: 'Календарь (.ics)',
    saved: 'Каталог недоступен. Показан сохранённый результат.', checked: 'Проверено',
  },
  en: {
    heading: 'Which city are you visiting?', label: 'City name', placeholder: 'For example, Budapest',
    search: 'Search', language: 'Language', attribution: 'Location data', loading: 'Searching for cities…',
    short: 'Enter at least two characters.', empty: 'No matches. Try another spelling.',
    error: 'Could not load cities. Try again.', found: count => `Cities found — ${count}`,
    calendars: 'Nearby calendars', looking: 'Looking up venue calendars on OpenAgenda…',
    none: 'OpenAgenda lists no calendars with current or upcoming events within 5 km.',
    unavailable: 'The OpenAgenda directory could not be checked.', refresh: 'Check again',
    nearby: 'OpenAgenda calendars within 5 km', feed: 'Calendar (.ics)',
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

function calendarsPanel(city, open) {
  const text = copy[language];
  const details = document.createElement('details');
  details.name = 'nearby-calendars';
  details.dataset.cityId = String(city.id);
  const summary = document.createElement('summary');
  summary.textContent = text.calendars;
  summary.setAttribute('aria-label', `${text.calendars} · ${city.name}`);
  const message = document.createElement('p');
  message.setAttribute('role', 'status');
  const list = document.createElement('ul');
  list.className = 'calendars';
  const refresh = document.createElement('button');
  refresh.type = 'button';
  refresh.textContent = text.refresh;
  details.append(summary, message, list, refresh);

  async function load(force) {
    refresh.disabled = true;
    message.textContent = text.looking;
    try {
      const { sources, stale, checkedAt } = await findSources(city, { storage, refresh: force });
      list.replaceChildren(...sources.map(source => {
        const item = document.createElement('li');
        const page = document.createElement('a');
        page.href = source.pageUrl;
        page.textContent = source.venue === source.agenda ? source.venue : `${source.venue} · ${source.agenda}`;
        const feed = document.createElement('a');
        feed.href = source.calendarUrl;
        feed.textContent = text.feed;
        item.append(page, feed);
        return item;
      }));
      const when = new Intl.DateTimeFormat(language, { dateStyle: 'short', timeStyle: 'short' }).format(checkedAt);
      message.textContent = [stale && text.saved, sources.length ? text.nearby : text.none, `${text.checked} ${when}`]
        .filter(Boolean).join(' · ');
    } catch {
      message.textContent = text.unavailable;
    } finally {
      refresh.disabled = false;
    }
  }
  details.addEventListener('toggle', () => {
    if (details.open && !message.textContent) load(false);
  });
  refresh.addEventListener('click', () => load(true));
  details.open = open;
  return details;
}

function cityRow(city, openId) {
  const row = document.createElement('li');
  const name = document.createElement('strong');
  const area = document.createElement('span');
  const zone = document.createElement('span');
  name.textContent = city.name;
  area.textContent = [city.region, city.country ?? city.countryCode].filter(Boolean).join(', ');
  zone.textContent = city.timezone;
  zone.className = 'zone';
  row.append(name, area, zone, calendarsPanel(city, String(city.id) === openId));
  return row;
}

async function showSearch(query, openId) {
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
    results.replaceChildren(...cities.map(city => cityRow(city, openId)));
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
    try { storage?.setItem(preferenceKey, language); } catch { /* Optional preference. */ }
    renderLanguage();
    if (submittedQuery !== null) showSearch(submittedQuery, results.querySelector('details[open]')?.dataset.cityId);
  });
}

renderLanguage();
