import { pauseSettingsStore, validPauseSettings } from './planned-pause.mjs';

const copy = {
  ru: { title: 'Пауза в автоплане', enable: 'Выделить время на обед или отдых', kind: 'Для чего', meal: 'Обед', rest: 'Отдых',
    from: 'Начать не раньше', to: 'Закончить не позже', duration: 'Длительность, мин',
    hint: 'Одна пауза для нового предложения. Конкретное заведение не выбрано; поиск заведения и дополнительные переходы пока не рассчитаны.',
    invalid: 'Укажи окно времени и длительность от 5 до 180 минут.', unsaved: 'Настройки доступны в этой вкладке; сохранить их не удалось.' },
  en: { title: 'Break in the auto plan', enable: 'Allow time for a meal or rest', kind: 'Purpose', meal: 'Meal', rest: 'Rest',
    from: 'Start no earlier than', to: 'Finish no later than', duration: 'Duration, min',
    hint: 'One break for a new suggestion. No venue is selected; finding one and any extra walking are not calculated yet.',
    invalid: 'Choose a time window and a duration from 5 to 180 minutes.', unsaved: 'Settings are available in this tab but could not be saved.' },
};

export function pauseControls(city, language, storage, signal, getDay, onChange) {
  const text = copy[language], store = pauseSettingsStore(city.id, storage);
  const element = document.createElement('fieldset'); element.className = 'return-trip-controls pause-controls';
  const legend = document.createElement('legend'); legend.textContent = text.title;
  const enabled = document.createElement('input'); enabled.type = 'checkbox'; enabled.className = 'enable-pause';
  const toggle = document.createElement('label'); toggle.className = 'return-toggle'; toggle.append(enabled, text.enable);
  const fields = document.createElement('div'); fields.className = 'return-trip-fields';
  const kind = document.createElement('select'); kind.className = 'pause-kind';
  for (const value of ['meal', 'rest']) { const option = document.createElement('option'); option.value = value; option.textContent = text[value]; kind.append(option); }
  const from = document.createElement('input'), to = document.createElement('input'), duration = document.createElement('input');
  from.type = to.type = 'time'; from.step = to.step = '60'; from.className = 'pause-from'; to.className = 'pause-to';
  duration.type = 'number'; duration.min = '5'; duration.max = '180'; duration.step = '1'; duration.className = 'pause-duration';
  for (const [input, caption] of [[kind, text.kind], [from, text.from], [to, text.to], [duration, text.duration]]) {
    const label = document.createElement('label'); label.className = 'day-picker'; label.append(caption, input); fields.append(label);
  }
  const note = document.createElement('p'); note.className = 'interest-hint pause-hint'; note.setAttribute('role', 'status');
  element.append(legend, toggle, fields, note);
  let activeDay, invalid = false;
  const inputs = () => ({ enabled: enabled.checked, kind: kind.value, from: from.value, to: to.value, duration: duration.value ? Number(duration.value) : NaN });
  function showNote() {
    note.textContent = [enabled.checked && (invalid ? text.invalid : text.hint), enabled.checked && !store.read(activeDay).saved && text.unsaved].filter(Boolean).join(' ');
    fields.hidden = !enabled.checked;
  }
  function refresh() {
    activeDay = getDay(); invalid = false;
    const settings = store.read(activeDay).settings;
    enabled.checked = settings.enabled; kind.value = settings.kind; from.value = settings.from; to.value = settings.to; duration.value = settings.duration;
    showNote();
  }
  function value() {
    if (getDay() !== activeDay) refresh();
    const settings = invalid ? inputs() : store.read(activeDay).settings;
    return settings.enabled ? { kind: settings.kind, from: settings.from, to: settings.to, duration: settings.duration } : null;
  }
  function save() {
    const settings = inputs(); invalid = !validPauseSettings(settings);
    if (!settings.enabled) { store.set(activeDay, { ...store.read(activeDay).settings, enabled: false }); invalid = false; }
    else if (!invalid) store.set(activeDay, settings);
    showNote(); onChange();
  }
  for (const input of [enabled, kind, from, to, duration]) input.addEventListener('change', save);
  window.addEventListener('storage', event => {
    if (event.key !== null && event.key !== `worth-a-stop.auto-plan.pause.v1.${city.id}.${getDay()}`) return;
    refresh(); onChange();
  }, { signal });
  refresh();
  return { element, value, refreshDay() { if (getDay() !== activeDay) refresh(); }, focus() { from.focus(); } };
}
