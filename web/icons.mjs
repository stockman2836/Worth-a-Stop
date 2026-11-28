export const iconNames = ['arrow-down', 'arrow-left', 'arrow-right', 'arrow-up', 'binoculars', 'calendar-days', 'castle', 'check',
  'church', 'drama', 'flag', 'landmark', 'map-pin', 'moon', 'palette', 'pause', 'plus', 'route', 'search',
  'shopping-basket', 'sparkles', 'sun', 'trash-2', 'trees', 'undo-2', 'x'];

export function icon(name) {
  if (!iconNames.includes(name)) throw Error('Unknown icon');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', `icon icon-${name}`);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `/icons.svg#${name}`);
  svg.append(use);
  return svg;
}

export function iconLabel(element, name, label) {
  element.classList.add('icon-label');
  element.replaceChildren(icon(name), document.createTextNode(label));
  return element;
}
