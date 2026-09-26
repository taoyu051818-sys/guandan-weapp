import { el, button, errorBox, showError, clearError, emptyState, loading, pager } from './dom.js';
import { formatTime, pageQuery } from './model.js';

export function renderAudit(host, ctx) {
  let page = 1;
  let sequence = 0;
  const error = errorBox();
  const list = el('section', { class: 'panel audit-panel', 'aria-label': '审计记录' }, loading());
  host.replaceChildren(el('div', { class: 'toolbar' }, el('p', { class: 'hint' }, '记录只读，不支持编辑或删除。仅管理员可访问。'), button('刷新记录', load)), error, list);
  async function load() {
    const request = ++sequence;
    clearError(error);
    list.setAttribute('aria-busy', 'true');
    try {
      const data = await ctx.api.request(`/audit?${pageQuery(page)}`);
      if (!ctx.isCurrent() || request !== sequence) return;
      list.replaceChildren(el('div', { class: 'panel-heading' }, el('h2', {}, '操作记录')),
        data.items.length ? el('div', { class: 'audit-list' }, data.items.map((item) => el('article', { class: 'audit-record' },
          el('div', { class: 'audit-title' }, el('strong', {}, item.action), el('time', { class: 'hint' }, formatTime(item.createdAt))),
          el('dl', { class: 'metadata' }, el('div', {}, el('dt', {}, '操作者'), el('dd', {}, item.actorId)),
            el('div', {}, el('dt', {}, '目标记录'), el('dd', {}, item.targetId)), el('div', {}, el('dt', {}, '审计编号'), el('dd', {}, item.id))),
          el('details', {}, el('summary', {}, '查看变更前后内容'), el('div', { class: 'audit-diff' },
            el('section', {}, el('h3', {}, '变更前'), el('pre', {}, JSON.stringify(item.before, null, 2) ?? '无')),
            el('section', {}, el('h3', {}, '变更后'), el('pre', {}, JSON.stringify(item.after, null, 2) ?? '无')))))))
          : emptyState('暂无操作记录', '公告、回复与功能状态的管理操作会记录在这里。'),
        pager(data, (next) => { page = next; load(); }));
    } catch (failure) {
      if (!ctx.isCurrent() || request !== sequence) return;
      if (list.querySelector('.loading')) list.replaceChildren();
      showError(error, failure); error.append(button('重试', load));
    } finally { if (request === sequence) list.removeAttribute('aria-busy'); }
  }
  load();
}
