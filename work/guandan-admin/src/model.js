export const roleLabels = { admin: '管理员', operator: '运营', support: '客服' };
export const statusLabels = { draft: '草稿', published: '已发布', archived: '已归档', open: '开放', closed: '关闭', maintenance: '维护中', resolved: '已处理' };
export const categoryLabels = { bug: '问题反馈', suggestion: '建议', other: '其他' };
export const routes = [
  { id: 'announcements', title: '公告管理', description: '编写、预览并管理玩家可见公告。', roles: ['admin', 'operator'] },
  { id: 'feedback', title: '玩家反馈', description: '跟进玩家问题，发送回复并记录处理状态。', roles: ['admin', 'operator', 'support'] },
  { id: 'features', title: '功能开关', description: '管理入口状态与玩家端说明，变更即时生效。', roles: ['admin', 'operator'] },
  { id: 'audit', title: '操作审计', description: '查看只读的操作记录与变更前后内容。', roles: ['admin'] },
];
export const allowedRoutes = (role) => routes.filter((route) => route.roles.includes(role));
export function formatTime(value) {
  if (value === null || value === undefined) return '不限';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '无效时间' : date.toLocaleString('zh-CN', { hour12: false });
}
export function featureUpdatedLabel(record) {
  return record.updatedAt === 0 ? `v${record.version} · 系统默认 · 尚未修改` : `v${record.version} · 更新 ${formatTime(record.updatedAt)}`;
}
export function dateInputValue(value) {
  if (value === null || value === undefined) return '';
  const date = new Date(value);
  const precision = date.getSeconds() || date.getMilliseconds() ? `:${String(date.getSeconds()).padStart(2, '0')}.${String(date.getMilliseconds()).padStart(3, '0')}` : '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}${precision}`;
}
export function announcementBody(values, status = 'draft', version) {
  const startsAt = values.startsAt ? new Date(values.startsAt).getTime() : null;
  const endsAt = values.endsAt ? new Date(values.endsAt).getTime() : null;
  if ([startsAt, endsAt].some((value) => value !== null && !Number.isFinite(value))) throw new Error('请输入有效的公告时间。');
  if (startsAt !== null && endsAt !== null && endsAt <= startsAt) throw new Error('结束时间必须晚于开始时间。');
  const title = values.title.trim();
  const content = values.content.trim();
  if (!title || title.length > 80) throw new Error('公告标题需为 1–80 字。');
  if (!content || content.length > 4000) throw new Error('公告正文需为 1–4000 字。');
  // CREATE is always a draft on the server; status/version are PATCH-only fields.
  return { title, content, startsAt, endsAt, ...(version !== undefined ? { status, version } : {}) };
}
export function pageQuery(page, status = '') {
  const query = new URLSearchParams({ page: String(page), pageSize: '20' });
  if (status) query.set('status', status);
  return query.toString();
}
export function pageSummary(data) {
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  return `共 ${data.total} 条 · 第 ${data.page} / ${pages} 页`;
}
export async function findAnnouncement(api, id) {
  for (let page = 1; ; page += 1) {
    const data = await api.request(`/announcements?page=${page}&pageSize=50`);
    const found = data.items.find((item) => item.id === id);
    if (found) return found;
    if (page * data.pageSize >= data.total) throw new Error('该公告已不存在，请刷新列表。');
  }
}
