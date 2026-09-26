import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedRoutes, announcementBody, dateInputValue, formatTime, featureUpdatedLabel, pageQuery, pageSummary, findAnnouncement } from '../src/model.js';

test('role-aware routes exclude privileged areas for support and audit for operator', () => {
  assert.deepEqual(allowedRoutes('support').map(({ id }) => id), ['feedback']);
  assert.deepEqual(allowedRoutes('operator').map(({ id }) => id), ['announcements', 'feedback', 'features']);
  assert.equal(allowedRoutes('admin').length, 4);
  assert.equal(allowedRoutes('unknown').length, 0);
});
test('announcement body keeps optimistic version and treats content as plain text', () => {
  assert.deepEqual(announcementBody({ title: ' Title ', content: ' <script>alert(1)</script> ', startsAt: '', endsAt: '' }, 'published', 4), {
    title: 'Title', content: '<script>alert(1)</script>', startsAt: null, endsAt: null, status: 'published', version: 4,
  });
  assert.equal(announcementBody({ title: 't', content: 'c' }).version, undefined);
});
test('CREATE announcement sends only server-supported editable fields; PATCH includes status/version', () => {
  const values = { title: 'Title', content: 'Content', startsAt: '', endsAt: '' };
  const create = announcementBody(values, 'draft');
  assert.deepEqual(create, { title: 'Title', content: 'Content', startsAt: null, endsAt: null });
  assert.deepEqual(Object.keys(create).sort(), ['content', 'endsAt', 'startsAt', 'title']);
  const patch = announcementBody(values, 'published', 1);
  assert.deepEqual(Object.keys(patch).sort(), ['content', 'endsAt', 'startsAt', 'status', 'title', 'version']);
  assert.equal(patch.status, 'published');
  assert.equal(patch.version, 1);
});
test('announcement rejects missing content, oversized text and invalid schedule', () => {
  assert.throws(() => announcementBody({ title: ' ', content: 'ok' }), /标题/);
  assert.throws(() => announcementBody({ title: 't', content: 'a'.repeat(4001) }), /正文/);
  assert.throws(() => announcementBody({ title: 't', content: 'c', startsAt: 'invalid' }), /有效/);
  assert.throws(() => announcementBody({ title: 't', content: 'c', startsAt: '2026-09-10T10:00', endsAt: '2026-09-10T10:00' }), /晚于/);
});
test('local input time round-trips to local schedule and never shows epoch for null', () => {
  const date = new Date(2026, 8, 26, 14, 5);
  assert.equal(dateInputValue(date.getTime()), '2026-09-26T14:05');
  assert.equal(dateInputValue(null), '');
  assert.equal(formatTime(null), '不限');
  assert.equal(announcementBody({ title: 't', content: 'c', startsAt: dateInputValue(date.getTime()) }).startsAt, date.getTime());
  const precise = new Date(2026, 8, 26, 14, 5, 47, 233).getTime();
  assert.equal(announcementBody({ title: 't', content: 'c', startsAt: dateInputValue(precise) }).startsAt, precise);
});
test('pagination encodes status and empty results are one page', () => {
  assert.equal(pageQuery(2, 'resolved'), 'page=2&pageSize=20&status=resolved');
  assert.equal(pageSummary({ page: 1, pageSize: 20, total: 0 }), '共 0 条 · 第 1 / 1 页');
});
test('default features have a descriptive label without changing general epoch timestamps', () => {
  assert.equal(featureUpdatedLabel({ version: 1, updatedAt: 0 }), 'v1 · 系统默认 · 尚未修改');
  const updatedAt = new Date(2026, 8, 26, 15, 10).getTime();
  assert.equal(featureUpdatedLabel({ version: 2, updatedAt }), `v2 · 更新 ${formatTime(updatedAt)}`);
  assert.equal(formatTime(0), new Date(0).toLocaleString('zh-CN', { hour12: false }));
  assert.notEqual(formatTime(0), '不限');
});
test('conflict recovery finds announcements moved across pages without silent overwrite', async () => {
  const calls = [];
  const found = await findAnnouncement({ request: async (path) => {
    calls.push(path);
    return { items: calls.length === 1 ? [] : [{ id: 'target', version: 2 }], total: 51, pageSize: 50 };
  } }, 'target');
  assert.equal(found.version, 2);
  assert.equal(calls.length, 2);
  await assert.rejects(findAnnouncement({ request: async () => ({ items: [], total: 0, pageSize: 50 }) }, 'missing'), /不存在/);
});
