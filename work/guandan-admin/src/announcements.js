import { el, button, field, errorBox, showError, clearError, badge, emptyState, loading, pager, busy } from './dom.js';
import { announcementBody, dateInputValue, formatTime, pageQuery, findAnnouncement } from './model.js';
import { confirmAction, openDialog } from './dialog.js';

export function renderAnnouncements(host, ctx) {
  let page = 1;
  let selectedId = null;
  let loadSequence = 0;
  const list = el('section', { class: 'panel record-panel', 'aria-label': '公告列表' });
  const editor = el('section', { class: 'panel editor-panel', 'aria-label': '公告编辑' });
  const listError = errorBox();
  const newButton = button('新建公告', async () => { if (await ctx.canLeave()) edit(null); }, 'primary');
  host.replaceChildren(el('div', { class: 'toolbar' }, el('p', { class: 'hint' }, '公告为纯文本；仅已发布且在有效期内的内容对玩家可见。'), newButton),
    listError, el('div', { class: 'split-layout' }, list, editor));
  editor.replaceChildren(emptyState('选择一条公告', '在左侧选择记录进行编辑，或新建一条公告草稿。'));

  async function load() {
    const sequence = ++loadSequence;
    clearError(listError);
    if (!list.children.length) list.append(loading());
    list.setAttribute('aria-busy', 'true');
    try {
      const data = await ctx.api.request(`/announcements?${pageQuery(page)}`);
      if (!ctx.isCurrent() || sequence !== loadSequence) return;
      list.replaceChildren(el('div', { class: 'panel-heading' }, el('h2', {}, '公告列表'), button('刷新', load, 'quiet')),
        data.items.length ? el('div', { class: 'record-list' }, data.items.map((item) =>
          button('', async () => { if (await ctx.canLeave()) edit(item); }, 'record', { 'data-id': item.id, 'aria-pressed': String(selectedId === item.id) }))) : emptyState('暂无公告', '新建草稿后，可先预览再发布。'), pager(data, async (next) => {
            if (await ctx.canLeave()) { page = next; selectedId = null; ctx.setDirty(false); editor.replaceChildren(emptyState('选择一条公告', '选择记录以查看完整内容。')); load(); }
          }));
      list.querySelectorAll('[data-id]').forEach((node, index) => {
        const item = data.items[index];
        node.append(el('div', { class: 'record-title' }, el('strong', {}, item.title), badge(item.status)),
          el('p', { class: 'record-summary' }, item.content.slice(0, 100)),
          el('p', { class: 'record-meta' }, `v${item.version} · 更新 ${formatTime(item.updatedAt)}`));
      });
    } catch (error) {
      if (!ctx.isCurrent() || sequence !== loadSequence) return;
      if (list.querySelector('.loading')) list.replaceChildren();
      showError(listError, error);
      listError.append(button('重新加载列表', load));
    } finally { if (sequence === loadSequence) list.removeAttribute('aria-busy'); }
  }

  function edit(record) {
    let submitting = false;
    selectedId = record?.id || null;
    ctx.setDirty(false);
    list.querySelectorAll('[data-id]').forEach((node) => node.setAttribute('aria-pressed', String(node.dataset.id === selectedId)));
    const title = el('input', { id: 'announcement-title', value: record?.title || '', maxlength: 80, required: true });
    const content = el('textarea', { id: 'announcement-content', rows: 12, maxlength: 4000, required: true }, record?.content || '');
    const startsAt = el('input', { id: 'announcement-start', type: 'datetime-local', step: '0.001', value: dateInputValue(record?.startsAt) });
    const endsAt = el('input', { id: 'announcement-end', type: 'datetime-local', step: '0.001', value: dateInputValue(record?.endsAt) });
    const error = errorBox();
    const values = () => ({ title: title.value, content: content.value, startsAt: startsAt.value, endsAt: endsAt.value });
    const preview = button('预览', () => {
      clearError(error);
      try {
        const body = announcementBody(values(), record?.status || 'draft', record?.version);
        openDialog('玩家端内容预览', el('article', { class: 'preview' }, el('p', { class: 'eyebrow' }, '公告 · 纯文本'),
          el('h3', {}, body.title), el('p', { class: 'plain-content' }, body.content),
          el('p', { class: 'hint' }, `有效期：${formatTime(body.startsAt)} — ${formatTime(body.endsAt)}`),
          el('p', { class: 'notice info' }, '预览不代表已发布。关闭此窗口不会丢失编辑内容。')));
      } catch (failure) { showError(error, failure); }
    });
    const save = el('button', { type: 'submit', class: 'button primary' }, record ? '保存修改' : '保存草稿');
    const actions = el('div', { class: 'actions' }, save, preview);
    const form = el('form', { class: 'editor-form' }, error,
      field('公告标题 *', title, '1–80 字。'), field('公告正文 *', content, '1–4000 字，按纯文本展示。'),
      el('div', { class: 'form-grid' }, field('开始时间', startsAt), field('结束时间', endsAt)),
      el('p', { class: 'hint' }, `按浏览器本地时区（${Intl.DateTimeFormat().resolvedOptions().timeZone}）录入。留空表示不限制。`), actions);
    form.addEventListener('input', () => ctx.setDirty(true));
    form.addEventListener('submit', (event) => { event.preventDefault(); submit(record?.status || 'draft'); });
    if (record) {
      if (record.status !== 'published') actions.append(button('发布公告', () => submit('published'), 'secondary'));
      if (record.status === 'published') actions.append(button('下线为草稿', () => submit('draft'), 'secondary'));
      if (record.status !== 'archived') actions.append(button('归档', () => submit('archived'), 'danger-quiet'));
      if (record.status === 'archived') actions.append(button('恢复为草稿', () => submit('draft'), 'secondary'));
    }
    editor.replaceChildren(el('div', { class: 'panel-heading' }, el('h2', { tabindex: '-1' }, record ? '编辑公告' : '新建公告'), badge(record?.status || 'draft')),
      record ? el('p', { class: 'editor-meta' }, `记录 ${record.id} · 当前版本 v${record.version}`) : el('p', { class: 'editor-meta' }, '保存后再发布，草稿不会展示给玩家。'), form);
    title.focus();

    async function submit(status) {
      if (submitting) return;
      if (!form.reportValidity()) return;
      clearError(error);
      let body;
      try { body = announcementBody(values(), status, record?.version); }
      catch (failure) { showError(error, failure); return; }
      submitting = true;
      const statusChanges = record && status !== record.status;
      if ((statusChanges || record?.status === 'published') && !await confirmAction({
        title: status === 'published' ? '确认发布当前内容？' : status === 'archived' ? '归档这条公告？' : '将公告转为草稿？',
        message: status === 'published' ? `“${body.title}”保存后，在有效期内对玩家可见。请确认内容和时间。` : '保存后此公告将不再对玩家展示。所有变更会保留审计记录。',
        confirmLabel: status === 'published' ? '确认发布' : status === 'archived' ? '确认归档' : '确认下线', danger: status !== 'published',
      })) { submitting = false; return; }
      const label = save.textContent;
      save.textContent = '正在保存…';
      try {
        await busy(form, async () => {
          const data = await ctx.api.request(record ? `/announcements/${encodeURIComponent(record.id)}` : '/announcements', { method: record ? 'PATCH' : 'POST', body });
          if (!ctx.isCurrent()) return;
          ctx.setDirty(false);
          ctx.announce(status === 'published' ? '公告已发布。' : status === 'archived' ? '公告已归档。' : '公告已保存。');
          edit(data.announcement);
          await load();
        });
      } catch (failure) {
        showError(error, failure);
        if (failure.status === 409) error.append(button('载入最新版本', async () => {
          if (!await ctx.canLeave()) return;
          try { const latest = await findAnnouncement(ctx.api, record.id); if (ctx.isCurrent()) { edit(latest); await load(); } }
          catch (reloadError) { showError(error, reloadError); }
        }));
      } finally { save.textContent = label; submitting = false; }
    }
  }
  load();
}
