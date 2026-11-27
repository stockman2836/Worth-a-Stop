import { resetCityPlans } from './city-plan-state.mjs';
import { iconLabel } from './icons.mjs';

const copy = {
  ru: { button: 'Сбросить планы города', title: name => `Сбросить планы: ${name}?`,
    description: 'Будут удалены маршруты за все даты, время начала и окончания прогулок, точки старта и выбранный темп автоплана для этого города. Действие нельзя отменить.',
    keep: 'Планы других городов, язык, тема и кеш найденных мест сохранятся.',
    cancel: 'Оставить планы', confirm: 'Удалить планы города',
    error: 'Не удалось удалить сохранённые планы. Проверьте доступ к хранилищу браузера и повторите попытку.',
    partial: 'Сброс не завершён: часть сохранённых данных могла измениться. Повторите попытку.',
    done: 'Планы города и настройки прогулок сброшены.', session: 'Планы и настройки города сброшены в текущей вкладке. Хранилище браузера недоступно.' },
  en: { button: 'Reset city plans', title: name => `Reset plans for ${name}?`,
    description: 'This deletes itineraries for all dates, walking start and finish times, starting points and the automatic planning pace for this city. This cannot be undone.',
    keep: 'Other cities, language, theme and cached place results are preserved.',
    cancel: 'Keep plans', confirm: 'Delete city plans',
    error: 'Could not delete saved plans. Check browser storage access and try again.',
    partial: 'Reset did not finish. Some saved data may have changed. Try again.',
    done: 'City plans and walking settings reset.', session: 'City plans and settings reset in this tab. Browser storage is unavailable.' },
};

export function cityReset(city, language, storage, signal, onReset) {
  const text = copy[language];
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'reset-city'; iconLabel(button, 'undo-2', text.button);
  button.setAttribute('aria-haspopup', 'dialog');
  const dialog = document.createElement('dialog'); dialog.className = 'city-reset-dialog';
  const title = document.createElement('h2'); title.id = `reset-city-${city.id}-title`; title.textContent = text.title(city.name);
  const description = document.createElement('p'); description.id = `reset-city-${city.id}-description`; description.textContent = text.description;
  const keep = document.createElement('p'); keep.textContent = text.keep;
  dialog.setAttribute('aria-labelledby', title.id); dialog.setAttribute('aria-describedby', description.id);
  const error = document.createElement('p'); error.className = 'reset-city-error'; error.setAttribute('role', 'alert');
  const actions = document.createElement('div'); actions.className = 'city-reset-actions';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = text.cancel; cancel.autofocus = true;
  const confirm = document.createElement('button'); confirm.type = 'button'; confirm.className = 'confirm-city-reset'; iconLabel(confirm, 'trash-2', text.confirm);
  actions.append(cancel, confirm); dialog.append(title, description, keep, error, actions);
  button.addEventListener('click', () => { error.textContent = ''; dialog.showModal(); });
  cancel.addEventListener('click', () => dialog.close());
  signal.addEventListener('abort', () => dialog.close(), { once: true });
  confirm.addEventListener('click', () => {
    let result;
    try { result = resetCityPlans(city.id, storage); }
    catch (failure) { error.textContent = failure.partial ? text.partial : text.error; return; }
    dialog.close();
    onReset(result.saved ? text.done : text.session);
  });
  return { button, dialog };
}
