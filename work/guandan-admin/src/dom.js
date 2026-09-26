import { errorMessage } from './api.js';
import { statusLabels, pageSummary } from './model.js';

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (value !== null && value !== undefined && value !== false) node.setAttribute(key, value === true ? '' : String(value));
  }
  node.append(...children.flat().filter((child) => child !== undefined && child !== null));
  return node;
}
export function button(label, onClick, variant = 'secondary', attrs = {}) {
  return el('button', { type: 'button', class: `button ${variant}`, onclick: onClick, ...attrs }, label);
}
export function field(label, control, hint = '') {
  const id = control.id;
  const hintId = `${id}-hint`;
  if (hint) control.setAttribute('aria-describedby', hintId);
  return el('div', { class: 'field' }, el('label', { for: id }, label), control, hint ? el('p', { id: hintId, class: 'hint' }, hint) : null);
}
export function errorBox() {
  return el('div', { class: 'notice error', role: 'alert', tabindex: '-1', hidden: true });
}
export function showError(box, error) {
  box.hidden = false;
  box.replaceChildren(el('p', {}, errorMessage(error)));
  box.focus();
}
export function clearError(box) {
  box.hidden = true;
  box.replaceChildren();
}
export function badge(status, label = statusLabels[status] || status) {
  return el('span', { class: `badge ${status}` }, label);
}
export function emptyState(title, detail) {
  return el('div', { class: 'empty-state' }, el('h3', {}, title), el('p', {}, detail));
}
export function loading() {
  return el('p', { class: 'loading', role: 'status' }, '正在加载数据…');
}
export function pager(data, onPage) {
  return el('div', { class: 'pagination' }, el('span', { class: 'hint' }, pageSummary(data)),
    el('div', { class: 'actions' },
      button('上一页', () => onPage(data.page - 1), 'secondary', { disabled: data.page <= 1 }),
      button('下一页', () => onPage(data.page + 1), 'secondary', { disabled: data.page * data.pageSize >= data.total })));
}
export async function busy(form, action) {
  const controls = [...form.querySelectorAll('button, input, textarea, select')];
  const previous = controls.map((control) => control.disabled);
  form.setAttribute('aria-busy', 'true');
  controls.forEach((control) => { control.disabled = true; });
  try { return await action(); }
  finally {
    controls.forEach((control, i) => { control.disabled = previous[i]; });
    form.removeAttribute('aria-busy');
  }
}
