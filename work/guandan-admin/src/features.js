import { el, button, field, errorBox, showError, clearError, badge, loading, busy } from './dom.js';
import { featureUpdatedLabel, statusLabels } from './model.js';
import { confirmAction } from './dialog.js';

const featureLabels = { messages: '消息中心', feedback: '意见反馈', membership: '会员服务' };
export function renderFeatures(host, ctx) {
  const error = errorBox();
  const cards = el('div', { class: 'feature-grid' }, loading());
  const dirtyIds = new Set();
  let loadSequence = 0;
  host.replaceChildren(el('div', { class: 'toolbar' }, el('p', { class: 'notice info' }, '会员服务尚未实现，不能开放。此后台不包含支付、充值或订单功能。'),
    button('刷新状态', async () => { if (await ctx.canLeave()) load(); })), error, cards);
  function markDirty(id, value) {
    if (value) dirtyIds.add(id); else dirtyIds.delete(id);
    ctx.setDirty(dirtyIds.size > 0);
  }
  async function load() {
    const sequence = ++loadSequence;
    clearError(error);
    cards.setAttribute('aria-busy', 'true');
    try {
      const data = await ctx.api.request('/features');
      if (!ctx.isCurrent() || sequence !== loadSequence) return;
      dirtyIds.clear(); ctx.setDirty(false);
      cards.replaceChildren(...data.items.map(makeCard));
    } catch (failure) {
      if (!ctx.isCurrent()) return;
      if (cards.querySelector('.loading')) cards.replaceChildren();
      showError(error, failure); error.append(button('重试', load));
    } finally { if (sequence === loadSequence) cards.removeAttribute('aria-busy'); }
  }
  function makeCard(record) {
    let submitting = false;
    const status = el('select', { id: `feature-${record.id}-status` }, ['open', 'closed', 'maintenance'].map((value) =>
      el('option', { value, disabled: record.id === 'membership' && value === 'open' }, statusLabels[value])));
    status.value = record.status;
    const title = el('input', { id: `feature-${record.id}-title`, maxlength: 40, required: true, value: record.title });
    const detail = el('textarea', { id: `feature-${record.id}-detail`, rows: 4, maxlength: 300 }, record.detail);
    const formError = errorBox();
    const submit = el('button', { type: 'submit', class: 'button primary' }, '保存变更');
    const card = el('section', { class: 'panel feature-card' });
    const form = el('form', { class: 'editor-form' }, formError,
      field('入口状态', status, record.id === 'membership' ? '会员服务仅允许关闭或维护，不可开放。' : '关闭或维护会限制对应玩家功能。'),
      field('玩家端标题 *', title, '1–40 字。'), field('玩家端说明', detail, '最多 300 字。'), submit);
    form.addEventListener('input', () => markDirty(record.id, true));
    form.addEventListener('submit', async (event) => {
      event.preventDefault(); clearError(formError);
      if (submitting) return;
      if (!title.value.trim()) { showError(formError, new Error('请输入玩家端标题。')); title.focus(); return; }
      const body = { version: record.version, status: status.value, title: title.value.trim(), detail: detail.value.trim() };
      submitting = true;
      if (!await confirmAction({ title: `确认修改${featureLabels[record.id] || record.id}？`,
        message: `状态：${statusLabels[record.status]} → ${statusLabels[body.status]}。玩家端标题与说明也将同时更新；变更将立即生效并记录审计。`, confirmLabel: '确认保存', danger: body.status !== 'open' })) { submitting = false; return; }
      submit.textContent = '正在保存…';
      try {
        await busy(form, async () => {
          const data = await ctx.api.request(`/features/${encodeURIComponent(record.id)}`, { method: 'PATCH', body });
          if (!ctx.isCurrent()) return;
          markDirty(record.id, false);
          const nextCard = makeCard(data.feature);
          card.replaceWith(nextCard);
          nextCard.querySelector('h2').focus();
          ctx.announce(`${featureLabels[record.id] || record.id}已更新。`);
        });
      } catch (failure) {
        showError(formError, failure);
        if (failure.status === 409) formError.append(button('载入此功能的最新版本', async () => {
          if (!await confirmAction({ title: '载入最新状态？', message: '此功能尚未保存的修改将被丢弃，其他功能输入不受影响。', confirmLabel: '载入最新版本', danger: true })) return;
          try {
            const data = await ctx.api.request('/features');
            const latest = data.items.find((item) => item.id === record.id);
            if (!latest) throw new Error('未找到此功能，请刷新页面。');
            if (ctx.isCurrent()) { markDirty(record.id, false); card.replaceWith(makeCard(latest)); }
          } catch (reloadError) { showError(formError, reloadError); }
        }));
      } finally { submit.textContent = '保存变更'; submitting = false; }
    });
    card.append(el('div', { class: 'panel-heading' }, el('h2', { tabindex: '-1' }, featureLabels[record.id] || record.id), badge(record.status)),
      el('p', { class: 'editor-meta' }, featureUpdatedLabel(record)), form);
    return card;
  }
  load();
}
