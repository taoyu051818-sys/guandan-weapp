import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi, errorMessage, ApiError } from '../src/api.js';

const response = (data, status = 200, error = null) => ({ ok: status < 400, status, json: async () => ({ ok: status < 400, data, error }) });
test('login options come from server and malformed options cannot disable TOTP', async () => {
  for (const totpRequired of [true, false]) {
    const api = createApi({ fetchImpl: async (url) => {
      assert.equal(url, '/api/v1/admin/login-options');
      return response({ totpRequired });
    } });
    assert.deepEqual(await api.loginOptions(), { totpRequired });
  }
  for (const data of [null, {}, { totpRequired: 'false' }, { totpRequired: 0 }]) {
    const api = createApi({ fetchImpl: async () => response(data) });
    await assert.rejects(api.loginOptions(), (error) => error.code === 'INVALID_LOGIN_OPTIONS');
  }
});
test('login uses cookie credentials; CSRF attaches to authenticated mutations only', async () => {
  const calls = [];
  const api = createApi({ fetchImpl: async (url, options) => {
    calls.push({ url, ...options });
    return response(url.endsWith('/session') ? { admin: { id: 'a', role: 'admin' }, csrfToken: 'csrf-1' } : { announcement: { id: 'n' } });
  } });
  assert.deepEqual(await api.login({ username: 'name', password: 'secret', totp: '123456' }), { id: 'a', role: 'admin' });
  assert.equal(calls[0].url, '/api/v1/admin/session');
  assert.equal(calls[0].credentials, 'same-origin');
  assert.equal(calls[0].headers['X-CSRF-Token'], undefined);
  assert.equal(calls[0].redirect, 'error');
  await api.request('/announcements', { method: 'POST', body: { title: '<script>' } });
  assert.equal(calls[1].headers['X-CSRF-Token'], 'csrf-1');
  assert.equal(JSON.parse(calls[1].body).title, '<script>');
  await api.request('/announcements');
  assert.equal(calls[2].headers['X-CSRF-Token'], undefined);
  assert.equal(calls[2].cache, 'no-store');
});
test('session restoration and logout erase CSRF capability', async () => {
  const api = createApi({ fetchImpl: async () => response({ admin: { id: 'b', role: 'support' }, csrfToken: 'csrf-2' }) });
  await api.session();
  await api.logout();
  await assert.rejects(api.request('/feedback/x', { method: 'PATCH', body: {} }), (error) => error.status === 401);
});
test('401 expires token and invokes callback; failed login does not expire current view', async () => {
  let unauthorized = 0;
  let signedIn = false;
  const api = createApi({ onUnauthorized: () => unauthorized++, fetchImpl: async () => signedIn
    ? response(null, 401, { code: 'EXPIRED', message: 'expired' })
    : response({ admin: { id: 'a', role: 'operator' }, csrfToken: 'token' }) });
  await api.session(); signedIn = true;
  await assert.rejects(api.login({}), (error) => error.status === 401);
  assert.equal(unauthorized, 0);
  await assert.rejects(api.request('/features'), (error) => error.status === 401);
  assert.equal(unauthorized, 1);
  await assert.rejects(api.request('/features/a', { method: 'PATCH' }), (error) => error.status === 401);
});
test('conflicts retain status/code for deliberate recovery and never auto-retry mutations', async () => {
  let calls = 0;
  const api = createApi({ fetchImpl: async (url) => {
    calls++;
    return url.endsWith('/session') ? response({ admin: {}, csrfToken: 'token' }) : response(null, 409, { code: 'VERSION_CONFLICT', message: 'conflict' });
  } });
  await api.session();
  await assert.rejects(api.request('/features/messages', { method: 'PATCH', body: { version: 1 } }), (error) => {
    assert.equal(error.code, 'VERSION_CONFLICT');
    assert.match(errorMessage(error), /不会自动覆盖/);
    return error.status === 409;
  });
  assert.equal(calls, 2);
});
test('rejects network failure, malformed envelope and non-local paths', async () => {
  const disconnected = createApi({ fetchImpl: async () => { throw new TypeError('offline'); } });
  await assert.rejects(disconnected.request('/session'), (error) => error instanceof ApiError && /核对/.test(error.message));
  const malformed = createApi({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ unexpected: true }) }) });
  await assert.rejects(malformed.request('/session'));
  await assert.rejects(malformed.request('//other.test/session'), /无效/);
  await assert.rejects(malformed.request('/../session'), /无效/);
});
