import { load } from 'cheerio';

export function validCalendarDay(day) {
  return typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day;
}

export function calendarBase(document) {
  const href = load(document.html)('base[href]').first().attr('href');
  const base = href && URL.canParse(href, document.url) ? new URL(href, document.url) : document.url;
  return base.origin === document.url.origin && !base.username && !base.password ? base : document.url;
}

// Use only field names, values and GET actions actually published by the calendar.
function numericDateValue(value, day, language) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return day;
  if (!language) return null;
  const sample = /^(\d{1,2})([./-])(\d{1,2})\2(\d{4})$/.exec(value);
  if (!sample) return null;
  const order = new Intl.DateTimeFormat(language, { day: '2-digit', month: '2-digit', year: 'numeric' })
    .formatToParts(new Date(Date.UTC(2000, 10, 27))).filter(part => ['day', 'month', 'year'].includes(part.type)).map(part => part.type);
  if (order[2] !== 'year') return null;
  const original = Object.fromEntries(order.map((type,index) => [type, [sample[1], sample[3], sample[4]][index]]));
  if (!validCalendarDay(`${original.year}-${original.month.padStart(2, '0')}-${original.day.padStart(2, '0')}`)) return null;
  const parts = { year: day.slice(0, 4), month: day.slice(5, 7), day: day.slice(8, 10) };
  return order.map(type => parts[type]).join(sample[2]);
}

function dateForms($, base, day) {
  const links = [];
  for (const el of $('form').toArray()) {
    const form = $(el);
    if ((form.attr('method') || 'get').toLowerCase() !== 'get') continue;
    const action = form.attr('action') || base.href;
    if (!URL.canParse(action, base)) continue;
    const target = new URL(action, base);
    if (target.origin !== base.origin || target.username || target.password) continue;
    const params = new URLSearchParams();
    const selected = new Set();
    let unsupported = false;
    for (const control of form.find('input[name], select[name]').toArray()) {
      const field = $(control), name = field.attr('name');
      if (field.is(':disabled') || field.closest('fieldset[disabled]').length) continue;
      const type = (field.attr('type') || 'text').toLowerCase();
      if (['submit', 'button', 'reset', 'file', 'password'].includes(type)) continue;
      if (['checkbox', 'radio'].includes(type) && !field.is('[checked]')) continue;
      let value = field.val() ?? '';
      if (type === 'date' || type === 'month') {
        value = type === 'month' ? day.slice(0, 7) : day;
        if ((field.attr('min') && value < field.attr('min')) || (field.attr('max') && value > field.attr('max'))) unsupported = true;
        selected.add(type);
      } else if (field.is('input.date, input.datepicker, input[data-date-format]') && typeof value === 'string') {
        let replacement;
        try { replacement = numericDateValue(value, day, $('html').attr('lang')); } catch { replacement = null; }
        if (!replacement) { unsupported = true; continue; }
        value = replacement;
        selected.add('date');
      } else if (field.is('select')) {
        const options = field.find('option:not([disabled])').toArray().map(option => $(option).attr('value') ?? $(option).text());
        if (/^(?:year|jahr|rok|ev|év|année|anno|год)$/iu.test(name)) { value = day.slice(0, 4); selected.add('year'); }
        else if (/^(?:month|monat|mesiac|měsíc|mesic|honap|hónap|mois|mese|месяц)$/iu.test(name)) {
          value = options.includes(day.slice(5, 7)) ? day.slice(5, 7) : String(Number(day.slice(5, 7)));
          selected.add('monthSelect');
        } else { params.append(name, String(value)); continue; }
        if (!options.includes(value)) unsupported = true;
      }
      if (Array.isArray(value)) value.forEach(item => params.append(name, item));
      else params.append(name, String(value));
    }
    if (unsupported || !(selected.has('date') || selected.has('month') || selected.has('year') && selected.has('monthSelect'))) continue;
    target.search = params.toString();
    target.hash = '';
    links.push(target.href);
  }
  return links;
}

function periods(url) {
  const datePath = /(?:^|\/)(\d{4}-\d{2}(?:-\d{2})?)(?:\.html?|\/)?$/.exec(url.pathname)?.[1];
  return [datePath, ...url.searchParams.values()].filter(value => /^\d{4}-(?:0[1-9]|1[0-2])(?:-\d{2})?$/.test(value));
}

export function calendarDateLinks(document, day, { nearestMonth = false } = {}) {
  if (!validCalendarDay(day)) return [];
  const $ = load(document.html), base = calendarBase(document);
  const links = dateForms($, base, day);
  const months = [];
  const steps = [];
  const ordinal = value => Number(value.slice(0, 4)) * 12 + Number(value.slice(5, 7));
  const distance = value => Math.abs(ordinal(value) - ordinal(day));
  const currentMonth = periods(document.url)[0];
  for (const el of $('a[href]').toArray()) {
    if ($(el).find('h1,h2,h3,h4').length) continue;
    const href = $(el).attr('href');
    if (!href || !URL.canParse(href, base)) continue;
    const target = new URL(href, base);
    if (target.origin !== base.origin || target.username || target.password) continue;
    // Recognize explicit ISO dates and months in published navigation, never synthesize paths.
    const dates = periods(target);
    target.hash = '';
    if (dates.includes(day)) links.push(target.href);
    else if (dates.includes(day.slice(0, 7))) months.push(target.href);
    const month = dates.find(value => value.length === 7);
    if (month && target.href !== document.url.href && (!currentMonth || distance(month) < distance(currentMonth))) {
      steps.push({ href: target.href, distance: distance(month) });
    }
  }
  if (nearestMonth) return steps.sort((a,b) => a.distance - b.distance).slice(0, 1).map(step => step.href);
  return [...new Set([...links, ...months])].slice(0, 4);
}
