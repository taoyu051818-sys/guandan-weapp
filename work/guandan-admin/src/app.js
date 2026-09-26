import { createApi, errorMessage } from './api.js';
import { el, button } from './dom.js';
import { allowedRoutes, roleLabels } from './model.js';
import { confirmAction, confirmDiscard, openDialog } from './dialog.js';
import { loginForm } from './login.js';
import { renderAnnouncements } from './announcements.js';
import { renderFeedback } from './feedback.js';
import { renderFeatures } from './features.js';
import { renderAudit } from './audit.js';

const app = document.querySelector('#app');
const status = document.querySelector('#status');
document.querySelector('.skip-link').addEventListener('click', (event) => {
  event.preventDefault();
  document.querySelector('#main')?.focus();
});
const views = { announcements: renderAnnouncements, feedback: renderFeedback, features: renderFeatures, audit: renderAudit };
let admin;
let currentRoute = '';
let dirty = false;
let generation = 0;
let expiredNotice;
let noticeTimer;
let navigating = false;
const api = createApi({ onUnauthorized: () => {
  if (expiredNotice) expiredNotice.hidden = false;
} });
function announce(message) {
  clearTimeout(noticeTimer);
  status.textContent = message;
  noticeTimer = setTimeout(() => { status.textContent = ''; }, 8000);
}
function showLogin(message = '') {
  admin = null;
  currentRoute = '';
  dirty = false;
  generation += 1;
  expiredNotice = null;
  const main = el('main', { id: 'main', class: 'login-page', tabindex: '-1' },
    el('section', { class: 'login-card' }, el('p', { class: 'eyebrow' }, '掼蛋 · 运营管理'),
      el('h1', {}, '登录工作台'), el('p', { class: 'intro' }, '公告、玩家反馈与功能状态，统一管理。'),
      message ? el('p', { class: 'notice error', role: 'alert' }, message) : null,
      loginForm(api, mountShell)));
  app.replaceChildren(main);
  main.querySelector('input')?.focus();
}
function reauthenticate() {
  let dialog;
  const oldAdmin = admin;
  dialog = openDialog('重新验证管理会话', loginForm(api, (newAdmin) => {
    dialog.close();
    if (newAdmin.id !== oldAdmin.id || newAdmin.role !== oldAdmin.role) {
      announce('已切换管理账户，工作台已重新加载。');
      mountShell(newAdmin);
    } else {
      expiredNotice.hidden = true;
      announce('验证成功，可以继续提交。');
    }
  }, { reauthenticate: true }));
  dialog.querySelector('input')?.focus();
}
function mountShell(identity) {
  admin = identity;
  currentRoute = '';
  dirty = false;
  const permitted = allowedRoutes(admin.role);
  if (!permitted.length) return showLogin('此账户没有可用的后台权限，请联系管理员。');
  const nav = el('nav', { 'aria-label': '管理导航', class: 'nav' }, permitted.map((route) =>
    el('a', { href: `#${route.id}`, 'data-route': route.id }, route.title)));
  const main = el('main', { id: 'main', class: 'main', tabindex: '-1' });
  expiredNotice = el('div', { class: 'notice warning session-notice', hidden: true },
    el('p', {}, '会话已失效。未保存的输入仍保留，请重新验证后继续。'), button('重新验证', reauthenticate));
  const logout = button('退出登录', async () => {
    if (dirty && !await confirmDiscard()) return;
    if (!await confirmAction({ title: '退出管理工作台？', message: '此操作将使当前管理会话失效。', confirmLabel: '退出登录' })) return;
    logout.disabled = true;
    try { await api.logout(); showLogin(); announce('已安全退出。'); }
    catch (failure) {
      if (failure.status === 401) { showLogin(); announce('会话已结束。'); }
      else announce(errorMessage(failure));
    } finally { logout.disabled = false; }
  }, 'sidebar-button');
  app.replaceChildren(el('div', { class: 'workspace' },
    el('aside', { class: 'sidebar' }, el('a', { class: 'brand', href: `#${permitted[0].id}` },
      el('strong', {}, '掼蛋'), el('span', {}, '运营工作台')),
    el('p', { class: 'nav-label' }, '工作空间'), nav,
    el('div', { class: 'account' }, el('span', { class: 'account-label' }, roleLabels[admin.role] || admin.role),
      el('span', { class: 'account-id' }, admin.id), button('重新验证', reauthenticate, 'sidebar-button'), logout)),
    el('div', { class: 'main-column' }, el('header', { class: 'topbar' },
      el('span', {}, '运营管理'), el('span', { class: 'hint' }, '独立管理会话 · 受权限保护')), expiredNotice, main)));
  navigate(true);
}
async function navigate(initial = false) {
  if (!admin || navigating) return;
  const permitted = allowedRoutes(admin.role);
  const requested = location.hash.slice(1);
  const route = permitted.find((item) => item.id === requested) || permitted[0];
  if (!initial && route.id === currentRoute) return;
  if (dirty) {
    navigating = true;
    const leave = await confirmDiscard();
    navigating = false;
    if (!leave) {
      history.replaceState(null, '', `#${currentRoute}`);
      return;
    }
  }
  dirty = false;
  currentRoute = route.id;
  if (requested !== route.id) history.replaceState(null, '', `#${route.id}`);
  const version = ++generation;
  document.querySelectorAll('[data-route]').forEach((link) => {
    if (link.dataset.route === route.id) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  const main = document.querySelector('#main');
  const host = el('div', { class: 'page-body' });
  main.replaceChildren(el('div', { class: 'page-heading' }, el('p', { class: 'eyebrow' }, '工作空间'), el('h1', {}, route.title), el('p', {}, route.description)), host);
  main.focus({ preventScroll: true });
  const context = {
    api, announce, isCurrent: () => generation === version,
    setDirty(value) { if (generation === version) dirty = value; },
    async canLeave() { return !dirty || await confirmDiscard(); },
  };
  views[route.id](host, context);
}
window.addEventListener('hashchange', () => navigate());
window.addEventListener('beforeunload', (event) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
try {
  mountShell(await api.session());
} catch (error) {
  showLogin(error.status === 401 ? '' : errorMessage(error));
}
