import { itineraryStop, itineraryStore } from './itinerary.mjs';
import { nextDate, todayIn } from './day-agenda.mjs';
import { walkingPanel } from './walking-panel.mjs';

const copy = {
  ru: { title: 'План дня', date: 'Дата плана', add: 'Добавить в план', empty: 'Добавьте места и события из подборки.',
    saved: 'План сохранён на этом устройстве.', temporary: 'Не удалось сохранить план. Изменения доступны в текущей вкладке.',
    added: 'Остановка добавлена в план.', duplicate: 'Эта остановка уже в плане.', up: 'Выше', down: 'Ниже', remove: 'Убрать',
    minutes: 'Время посещения, мин', unknown: 'Время события не указано', invalid: 'Укажите от 1 до 1440 минут.',
    fixed: 'Время организатора', invalidDate: 'Выберите дату плана.' },
  en: { title: 'Daily itinerary', date: 'Plan date', add: 'Add to plan', empty: 'Add places and events from the suggestions.',
    saved: 'Plan saved on this device.', temporary: 'Could not save the plan. Changes are available in this tab.',
    added: 'Stop added to the plan.', duplicate: 'This stop is already in the plan.', up: 'Move up', down: 'Move down', remove: 'Remove',
    minutes: 'Visit duration, min', unknown: 'Event time unspecified', invalid: 'Enter 1 to 1440 minutes.',
    fixed: 'Publisher time', invalidDate: 'Choose a plan date.' },
};

export function itineraryPanel(city, language, timeline, storage, signal) {
  const text = copy[language];
  const store = itineraryStore(city.id, storage);
  const element = document.createElement('section');
  element.className = 'itinerary';
  const title = document.createElement('h2');
  title.textContent = text.title;
  const label = document.createElement('label');
  label.className = 'day-picker';
  const caption = document.createElement('span');
  caption.textContent = text.date;
  const date = document.createElement('input');
  date.type = 'date';
  date.required = true;
  const preference = 'worth-a-stop.itinerary.day.' + city.id;
  try {
    const day = storage?.getItem(preference);
    if (day) { nextDate(day); timeline.setDay(day); }
  } catch { /* A previous selection is optional. */ }
  try { nextDate(timeline.getDay()); } catch { timeline.setDay(todayIn(city.timezone || 'UTC')); }
  date.value = timeline.getDay();
  let activeDay = date.value;
  label.append(caption, date);
  const zone = document.createElement('p');
  zone.textContent = city.timezone || 'UTC';
  const list = document.createElement('ol');
  list.className = 'itinerary-stops';
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  element.append(title, label, zone, list, status);
  const walking = walkingPanel(language, timeline, signal);
  element.append(walking.element);
  const when = new Intl.DateTimeFormat(language, { timeZone: city.timezone || 'UTC', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  function button(labelText, action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = labelText;
    button.addEventListener('click', action);
    return button;
  }
  function render(result = store.read(activeDay), feedback = '') {
    list.replaceChildren();
    for (const [index, stop] of result.stops.entries()) {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.href = stop.url;
      link.textContent = stop.names?.[language] || stop.title;
      item.append(link);
      if (stop.type === 'event') {
        const time = document.createElement('p');
        time.textContent = stop.start === null ? text.unknown : text.fixed + ' · ' + when.format(stop.start) +
          (stop.end === null ? '' : ' – ' + when.format(stop.end));
        item.append(time);
      } else {
        const label = document.createElement('label');
        label.className = 'day-picker';
        const input = document.createElement('input');
        input.type = 'number';
        input.min = '1';
        input.max = '1440';
        input.step = '1';
        input.value = stop.duration ?? '';
        label.append(text.minutes, input);
        input.addEventListener('change', () => {
          if (!input.validity.valid) { status.textContent = text.invalid; return; }
          render(store.duration(activeDay, stop.id, input.value ? Number(input.value) : null));
        });
        item.append(label);
      }
      const actions = document.createElement('div');
      actions.className = 'itinerary-actions';
      const up = button(text.up, () => render(store.move(activeDay, stop.id, -1)));
      up.disabled = index === 0;
      const down = button(text.down, () => render(store.move(activeDay, stop.id, 1)));
      down.disabled = index === result.stops.length - 1;
      actions.append(up, down, button(text.remove, () => render(store.remove(activeDay, stop.id))));
      item.append(actions);
      list.append(item);
    }
    status.textContent = [feedback, !result.stops.length && text.empty, result.saved ? text.saved : text.temporary].filter(Boolean).join(' ');
    walking.update(result.stops);
  }
  function setDay(day) {
    try { nextDate(day); } catch { return; }
    date.value = day;
    activeDay = day;
    try { storage?.setItem(preference, day); } catch { /* The plan can still be edited. */ }
    render();
  }
  date.addEventListener('change', () => {
    if (date.value && date.validity.valid) timeline.setDay(date.value);
    else date.value = activeDay;
  });
  timeline.onDayChange(setDay);
  window.addEventListener('storage', () => render(), { signal });
  render();
  return {
    element,
    button(item, type) {
      const add = button(text.add, () => {
        try { nextDate(timeline.getDay()); } catch { status.textContent = text.invalidDate; return; }
        setDay(timeline.getDay());
        const stop = itineraryStop(item, type);
        const exists = store.read(activeDay).stops.some(s => s.id === stop.id);
        render(store.add(activeDay, stop), exists ? text.duplicate : text.added);
      });
      add.className = 'add-to-plan';
      add.setAttribute('aria-label', text.add + ' · ' + (item.title || item.names?.[language] || item.name));
      return add;
    },
  };
}
