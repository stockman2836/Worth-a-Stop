import { findAlternatives, planSignature } from './alternatives.mjs';
import { placeName } from './place-name.mjs';

const copy = {
  ru: { title: 'Найти замену', searching: 'Проверяем ближайшие места и переходы…',
    empty: 'Подходящих замен не найдено среди проверенных мест.',
    changed: 'План изменился. Повторите поиск замены.', error: 'Не удалось проверить варианты.',
    retry: 'Повторить поиск', choose: 'Заменить остановку', map: 'Показать на карте',
    stale: 'Использована сохранённая подборка мест.', partial: 'Часть переходов проверить не удалось.',
    hours: 'Часы работы', visit: 'Проверенное время визита',
    scope: 'Проверяются до трёх ближайших вариантов из подборки в радиусе 2 км.',
    reasons: { location: 'Для поиска нужны координаты остановки.', duration: 'Укажите длительность посещения.',
      arrival: 'Сначала задайте старт и рассчитайте прибытие к остановке.' } },
  en: { title: 'Find a replacement', searching: 'Checking nearby places and walking legs…',
    empty: 'No suitable replacements found among the places checked.',
    changed: 'The plan changed. Search for replacements again.', error: 'Could not check alternatives.',
    retry: 'Search again', choose: 'Replace stop', map: 'Show on map',
    stale: 'Using saved place suggestions.', partial: 'Some walking legs could not be checked.',
    hours: 'Opening hours', visit: 'Verified visit time',
    scope: 'Checks up to three nearby candidates from suggestions within 2 km.',
    reasons: { location: 'The stop needs coordinates to search nearby.', duration: 'Enter the visit duration.',
      arrival: 'Choose a start time and calculate arrival at this stop first.' } },
};

export function alternativesPanel(stop, language, timeZone, getContext, apply, timeline, storage, signal) {
  const text = copy[language];
  const element = document.createElement('details');
  element.className = 'alternatives';
  const summary = document.createElement('summary');
  summary.textContent = text.title;
  const message = document.createElement('p');
  message.setAttribute('role', 'status');
  const list = document.createElement('ul');
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = text.retry;
  retry.hidden = true;
  const scope = document.createElement('p');
  scope.textContent = text.scope;
  element.append(summary, message, list, retry, scope);
  const when = new Intl.DateTimeFormat(language, { timeZone: timeZone || 'UTC', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const distance = new Intl.NumberFormat(language, { style: 'unit', unit: 'meter', maximumFractionDigits: 0 });
  let controller;
  let signature;
  function key(context) { return JSON.stringify([context.day, planSignature(context.stops, context.start, context.legs)]); }
  function changed() {
    if (signature === undefined || signature === key(getContext())) return false;
    controller?.abort();
    list.replaceChildren();
    message.textContent = text.changed;
    retry.hidden = false;
    return true;
  }
  async function search() {
    controller?.abort();
    controller = new AbortController();
    const combined = AbortSignal.any([signal, controller.signal]);
    const context = getContext();
    signature = key(context);
    list.replaceChildren();
    message.textContent = text.searching;
    retry.hidden = true;
    try {
      const result = await findAlternatives(context.stops, stop.id, context.legs, context.start, timeZone,
        { signal: combined, storage });
      if (combined.aborted || changed()) return;
      message.textContent = [result.reason && text.reasons[result.reason],
        !result.reason && !result.alternatives.length && text.empty,
        result.stale && text.stale, result.incomplete && text.partial].filter(Boolean).join(' ');
      for (const alternative of result.alternatives) {
        const item = document.createElement('li');
        const title = document.createElement('a');
        title.href = alternative.stop.url;
        title.textContent = placeName(alternative.stop, language);
        const info = document.createElement('p');
        info.textContent = [distance.format(alternative.km * 1000), text.visit + ' · ' + when.format(alternative.arrival) +
          ' – ' + when.format(alternative.departure), text.hours + ' · ' + alternative.stop.hours].join(' · ');
        const map = document.createElement('button');
        map.type = 'button';
        map.textContent = text.map;
        map.addEventListener('click', () => timeline.showAlternative(alternative.stop));
        const choose = document.createElement('button');
        choose.type = 'button';
        choose.textContent = text.choose;
        choose.addEventListener('click', () => {
          if (changed()) return;
          try { apply(context, stop.id, alternative.stop); }
          catch { message.textContent = text.changed; list.replaceChildren(); retry.hidden = false; }
        });
        item.append(title, info, map, choose);
        list.append(item);
      }
      retry.hidden = false;
    } catch {
      if (combined.aborted) return;
      message.textContent = text.error;
      retry.hidden = false;
    }
  }
  element.addEventListener('toggle', () => {
    if (element.open && signature === undefined) search();
    if (!element.open) { controller?.abort(); signature = undefined; }
  });
  retry.addEventListener('click', search);
  return { element, check: changed };
}
