import { returnTripStore } from './return-trip.mjs';
import { localInstant } from './opening-hours.mjs';
import { iconLabel } from './icons.mjs';

const copy = {
  ru: { title: 'Возвращение', enable: 'Учесть дорогу обратно', mode: 'Куда вернуться', origin: 'К точке старта', point: 'В другую точку',
    pick: 'Выбрать возвращение на карте', pickOrigin: 'Выбрать старт на карте', buffer: 'Запас до отправления, мин', missing: 'Выбери точку старта или другую точку возвращения.',
    end: 'Укажи время отправления / предельное время.', invalid: 'Укажи запас от 0 до 120 минут; времени до отправления должно хватать.',
    unknown: 'Для проверки возвращения нужен рассчитанный обратный путь.', late: 'Возвращение позже нужного времени.',
    unsaved: 'Настройки доступны в этой вкладке; сохранить их не удалось.', deadline: 'Прибыть не позже', arrival: 'Возвращение', deadlineLabel: 'Отправление / предельное время' },
  en: { title: 'Return journey', enable: 'Include the walk back', mode: 'Return to', origin: 'Starting point', point: 'Another point',
    pick: 'Choose return point on map', pickOrigin: 'Choose start on map', buffer: 'Buffer before departure, min', missing: 'Choose a starting point or another return point.',
    end: 'Choose the departure time / deadline.', invalid: 'Choose a buffer from 0 to 120 minutes and allow enough time before departure.',
    unknown: 'A calculated walk back is needed to check the return time.', late: 'The return arrives after the required time.',
    unsaved: 'Settings are available in this tab but could not be saved.', deadline: 'Arrive no later than', arrival: 'Return arrival', deadlineLabel: 'Departure time / deadline' },
};

export function returnTripPanel(city, language, storage, signal, { getDay, getOrigin, getStart, getEnd, timeline, onChange, onPickOrigin }) {
  const text = copy[language], store = returnTripStore(city.id, storage);
  const element = document.createElement('fieldset'); element.className = 'return-trip-controls';
  const legend = document.createElement('legend'); legend.textContent = text.title;
  const enabled = document.createElement('input'); enabled.type = 'checkbox'; enabled.className = 'enable-return';
  const enableLabel = document.createElement('label'); enableLabel.className = 'return-toggle'; enableLabel.append(enabled, text.enable);
  const fields = document.createElement('div'); fields.className = 'return-trip-fields';
  const mode = document.createElement('select'); mode.className = 'return-mode';
  for (const value of ['origin', 'point']) { const option = document.createElement('option'); option.value = value; option.textContent = text[value]; mode.append(option); }
  const modeLabel = document.createElement('label'); modeLabel.className = 'day-picker'; modeLabel.append(text.mode, mode);
  const buffer = document.createElement('input'); buffer.type = 'number'; buffer.min = '0'; buffer.max = '120'; buffer.step = '1'; buffer.className = 'return-buffer';
  const bufferLabel = document.createElement('label'); bufferLabel.className = 'day-picker'; bufferLabel.append(text.buffer, buffer);
  const pick = document.createElement('button'); pick.type = 'button'; pick.className = 'pick-return'; iconLabel(pick, 'flag', text.pick);
  const status = document.createElement('p'); status.className = 'return-trip-status'; status.setAttribute('role', 'status');
  fields.append(modeLabel, bufferLabel, pick); element.append(legend, enableLabel, fields, status);
  const clock = new Intl.DateTimeFormat(language, { timeZone: city.timezone || 'UTC', hour: '2-digit', minute: '2-digit' });
  const coordinate = new Intl.NumberFormat(language, { maximumFractionDigits: 5 });
  let invalidBuffer = false;
  function trip() {
    const settings = store.read(getDay()).settings;
    return (invalidBuffer ? enabled.checked : settings.enabled) ? { point: (invalidBuffer ? mode.value : settings.mode) === 'origin' ? getOrigin() : settings.point,
      bufferMinutes: invalidBuffer ? NaN : settings.bufferMinutes } : null;
  }
  function deadline() {
    const value = trip(), end = localInstant(getDay(), getEnd(), city.timezone || 'UTC');
    return value && Number.isFinite(end) ? end - value.bufferMinutes * 60000 : undefined;
  }
  function update(arrival) {
    const value = trip(), saved = store.read(getDay()).saved, by = deadline();
    const start = localInstant(getDay(), getStart(), city.timezone || 'UTC');
    status.dataset.state = !value ? 'disabled' : !value.point ? 'missing-point' : !getEnd() ? 'missing-end' :
      !Number.isFinite(by) || Number.isFinite(start) && by <= start ? 'invalid' : !Number.isFinite(arrival) ? 'unknown' : arrival > by ? 'late' : 'fits';
    status.textContent = !value ? '' : [
      value.point && `${coordinate.format(value.point.latitude)} · ${coordinate.format(value.point.longitude)}`,
      status.dataset.state === 'missing-point' && text.missing,
      status.dataset.state === 'missing-end' && text.end,
      status.dataset.state === 'invalid' && text.invalid,
      Number.isFinite(by) && text.deadline + ' · ' + clock.format(by),
      Number.isFinite(arrival) ? text.arrival + ' · ' + clock.format(arrival) : status.dataset.state === 'unknown' && text.unknown,
      status.dataset.state === 'late' && text.late, !saved && text.unsaved,
    ].filter(Boolean).join(' · ');
  }
  function refresh() {
    const settings = store.read(getDay()).settings;
    invalidBuffer = false; enabled.checked = settings.enabled; mode.value = settings.mode; buffer.value = settings.bufferMinutes;
    fields.hidden = !settings.enabled;
    iconLabel(pick, settings.mode === 'origin' ? 'map-pin' : 'flag', settings.mode === 'origin' ? text.pickOrigin : text.pick);
    timeline.setDestination?.(trip()?.point ?? null, text.title);
    update();
  }
  function save() {
    invalidBuffer = !buffer.value || !buffer.validity.valid;
    if (invalidBuffer && enabled.checked) { onChange(false); update(); return; }
    store.set(getDay(), { ...store.read(getDay()).settings, enabled: enabled.checked, mode: mode.value,
      bufferMinutes: invalidBuffer ? 15 : Number(buffer.value) });
    onChange(true);
  }
  enabled.addEventListener('change', save); mode.addEventListener('change', save); buffer.addEventListener('change', save);
  pick.addEventListener('click', () => {
    if (mode.value === 'origin') { onPickOrigin(); return; }
    timeline.pickStart(point => {
      if (signal.aborted) return;
      store.set(getDay(), { ...store.read(getDay()).settings, enabled: true, mode: 'point', point }); onChange(true);
    }, () => onChange(false), 'return');
  });
  refresh();
  return { element, trip, deadline, refresh, update, deadlineLabel: text.deadlineLabel };
}
