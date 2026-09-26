import { el, button } from './dom.js';

export function openDialog(title, content, { onClose = () => {}, initialFocus } = {}) {
  const previous = document.activeElement;
  const heading = el('h2', { id: 'dialog-title' }, title);
  const dialog = el('dialog', { class: 'dialog', 'aria-labelledby': 'dialog-title' },
    el('div', { class: 'dialog-heading' }, heading, button('关闭', () => dialog.close(), 'quiet', { 'aria-label': `关闭${title}` })), content);
  document.body.append(dialog);
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (previous?.isConnected) previous.focus();
    onClose();
  }, { once: true });
  dialog.showModal();
  (initialFocus || dialog.querySelector('button'))?.focus();
  return dialog;
}

export function confirmAction({ title, message, confirmLabel = '确认', danger = false }) {
  return new Promise((resolve) => {
    let confirmed = false;
    let dialog;
    const cancel = button('取消', () => dialog.close());
    const content = el('div', {}, el('p', { class: 'dialog-copy' }, message),
      el('div', { class: 'actions dialog-actions' }, cancel, button(confirmLabel, () => { confirmed = true; dialog.close(); }, danger ? 'danger' : 'primary')));
    dialog = openDialog(title, content, { onClose: () => resolve(confirmed), initialFocus: cancel });
  });
}

export function confirmDiscard() {
  return confirmAction({ title: '放弃未保存的修改？', message: '当前输入尚未保存。离开后，这些修改将丢失。', confirmLabel: '放弃修改', danger: true });
}
