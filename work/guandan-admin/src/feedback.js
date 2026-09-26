import { el, button, field, errorBox, showError, clearError, badge, emptyState, loading, pager, busy } from './dom.js';
import { categoryLabels, formatTime, pageQuery } from './model.js';
import { confirmAction } from './dialog.js';

export function renderFeedback(host, ctx) {
  let page = 1;
  let selectedId = null;
  let loadSequence = 0;
  const statusFilter = el('select', { id: 'feedback-filter' }, el('option', { value: '' }, '全部状态'), el('option', { value: 'open' }, '待处理'), el('option', { value: 'resolved' }, '已处理'));
  const error = errorBox();
  const list = el('section', { class: 'panel record-panel', 'aria-label': '反馈列表' });
  const detail = el('section', { class: 'panel editor-panel', 'aria-label': '反馈详情' }, emptyState('选择一条玩家反馈', '回复将发送至该玩家的消息中心。'));
  host.replaceChildren(el('div', { class: 'toolbar' }, field('处理状态', statusFilter), button('刷新列表', load)), error, el('div', { class: 'split-layout' }, list, detail));
  let appliedFilter = '';
  statusFilter.addEventListener('change', async () => {
    if (!await ctx.canLeave()) { statusFilter.value = appliedFilter; return; }
    appliedFilter = statusFilter.value;
    page = 1;
    clearSelection();
    load();
  });
  function clearSelection() {
    selectedId = null;
    ctx.setDirty(false);
    detail.replaceChildren(emptyState('选择一条玩家反馈', '查看内容、历史回复与处理状态。'));
  }
  async function load() {
    const sequence = ++loadSequence;
    clearError(error);
    if (!list.children.length) list.append(loading());
    list.setAttribute('aria-busy', 'true');
    try {
      const data = await ctx.api.request(`/feedback?${pageQuery(page, appliedFilter)}`);
      if (!ctx.isCurrent() || sequence !== loadSequence) return;
      list.replaceChildren(el('div', { class: 'panel-heading' }, el('h2', {}, '反馈队列')),
        data.items.length ? el('div', { class: 'record-list' }, data.items.map((item) => {
          const record = button('', async () => { if (await ctx.canLeave()) edit(item); }, 'record', { 'data-id': item.id, 'aria-pressed': String(item.id === selectedId) });
          record.append(el('div', { class: 'record-title' }, el('strong', {}, categoryLabels[item.category] || item.category), badge(item.status, item.status === 'open' ? '待处理' : '已处理')),
            el('p', { class: 'record-summary' }, item.content.slice(0, 120)), el('p', { class: 'record-meta' }, `${formatTime(item.createdAt)} · ${item.replies.length} 条回复`));
          return record;
        })) : emptyState('暂无匹配反馈', '玩家提交的反馈会显示在这里，可切换状态筛选查看。'),
        pager(data, async (next) => { if (await ctx.canLeave()) { page = next; clearSelection(); load(); } }));
    } catch (failure) {
      if (!ctx.isCurrent() || sequence !== loadSequence) return;
      if (list.querySelector('.loading')) list.replaceChildren();
      showError(error, failure);
      error.append(button('重试', load));
    } finally { if (sequence === loadSequence) list.removeAttribute('aria-busy'); }
  }
  function edit(record) {
    let submitting = false;
    selectedId = record.id;
    ctx.setDirty(false);
    list.querySelectorAll('[data-id]').forEach((node) => node.setAttribute('aria-pressed', String(node.dataset.id === selectedId)));
    const reply = el('textarea', { id: 'feedback-reply', rows: 5, maxlength: 2000, required: true });
    const formError = errorBox();
    const send = el('button', { type: 'submit', class: 'button primary' }, '发送回复');
    const resolve = button(record.status === 'open' ? '标记已处理' : '重新打开', async () => {
      if (submitting) return;
      submitting = true;
      const confirmed = await confirmAction({ title: record.status === 'open' ? '标记此反馈已处理？' : '重新打开此反馈？', message: '此操作仅更改处理状态，不会发送额外回复。输入中的回复将被保留。', confirmLabel: '确认变更' });
      submitting = false;
      if (!confirmed) return;
      await mutate('status');
    });
    const form = el('form', { class: 'editor-form' }, formError, field('回复内容 *', reply, '1–2000 字。发送后玩家可在消息中心查看；请勿包含内部账号或敏感信息。'), el('div', { class: 'actions' }, send, resolve));
    form.addEventListener('input', () => ctx.setDirty(!!reply.value));
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!reply.value.trim()) { showError(formError, new Error('请输入回复内容。')); reply.focus(); return; }
      await mutate('reply');
    });
    detail.replaceChildren(el('div', { class: 'panel-heading' }, el('h2', { tabindex: '-1' }, '反馈详情'), badge(record.status, record.status === 'open' ? '待处理' : '已处理')),
      el('div', { class: 'feedback-content' }, el('dl', { class: 'metadata' },
        el('div', {}, el('dt', {}, '玩家'), el('dd', {}, record.userId)), el('div', {}, el('dt', {}, '类型'), el('dd', {}, categoryLabels[record.category])),
        el('div', {}, el('dt', {}, '提交时间'), el('dd', {}, formatTime(record.createdAt))), el('div', {}, el('dt', {}, '记录 / 版本'), el('dd', {}, `${record.id} / v${record.version}`))),
        el('p', { class: 'plain-content player-content' }, record.content), el('h3', {}, `历史回复（${record.replies.length}）`),
        record.replies.length ? el('ol', { class: 'reply-list' }, record.replies.map((item) => el('li', {}, el('p', { class: 'hint' }, formatTime(item.createdAt)), el('p', { class: 'plain-content' }, item.content)))) : el('p', { class: 'hint' }, '尚未回复。')), form);
    detail.querySelector('h2').focus();
    async function mutate(kind) {
      if (submitting) return;
      submitting = true;
      clearError(formError);
      const draft = reply.value;
      const path = `/feedback/${encodeURIComponent(record.id)}`;
      send.textContent = kind === 'reply' ? '正在发送…' : '发送回复';
      try {
        await busy(form, async () => {
          const data = await ctx.api.request(kind === 'reply' ? `${path}/replies` : path, {
            method: kind === 'reply' ? 'POST' : 'PATCH',
            body: kind === 'reply' ? { version: record.version, content: draft.trim() } : { version: record.version, status: record.status === 'open' ? 'resolved' : 'open' },
          });
          if (!ctx.isCurrent()) return;
          edit(data.feedback);
          if (kind === 'status') { detail.querySelector('textarea').value = draft; ctx.setDirty(!!draft); }
          ctx.announce(kind === 'reply' ? '回复已发送。' : '反馈处理状态已更新。');
          await load();
        });
      } catch (failure) {
        showError(formError, failure);
        if (failure.status === 409) formError.append(button('载入最新版本并保留回复草稿', async () => {
          const currentDraft = reply.value;
          try {
            for (let next = 1; ; next += 1) {
              const data = await ctx.api.request(`/feedback?page=${next}&pageSize=50`);
              const latest = data.items.find((item) => item.id === record.id);
              if (latest) { if (ctx.isCurrent()) { edit(latest); detail.querySelector('textarea').value = currentDraft; ctx.setDirty(!!currentDraft); await load(); } break; }
              if (next * data.pageSize >= data.total) throw new Error('反馈记录已不存在。');
            }
          } catch (reloadError) { showError(formError, reloadError); }
        }));
      } finally { send.textContent = '发送回复'; submitting = false; }
    }
  }
  load();
}
