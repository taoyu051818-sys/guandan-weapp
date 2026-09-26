export class ApiError extends Error {
  constructor(message, status = 0, code = 'NETWORK_ERROR') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

// Tokens exist only in this closure. The HttpOnly session cookie is never read by JS.
export function createApi({ fetchImpl = globalThis.fetch.bind(globalThis), onUnauthorized = () => {} } = {}) {
  let csrfToken = '';
  async function request(path, { method = 'GET', body, anonymous = false } = {}) {
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('..')) {
      throw new ApiError('无效的管理接口路径。', 0, 'INVALID_PATH');
    }
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET' && !anonymous) {
      if (!csrfToken) {
        onUnauthorized();
        throw new ApiError('会话已失效，请重新验证后再提交。', 401, 'SESSION_REQUIRED');
      }
      headers['X-CSRF-Token'] = csrfToken;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    let response;
    let envelope;
    try {
      response = await fetchImpl(`/api/v1/admin${path}`, {
        method, headers, credentials: 'same-origin', cache: 'no-store',
        redirect: 'error', signal: controller.signal,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      envelope = await response.json();
    } catch (error) {
      throw new ApiError(error.name === 'AbortError'
        ? '请求超时。提交结果可能尚未确认，请刷新数据核对后再试。'
        : '无法连接管理服务。提交结果可能尚未确认，请检查网络并刷新数据核对。');
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok || envelope?.ok !== true) {
      if (response.status === 401 && !anonymous) {
        csrfToken = '';
        onUnauthorized();
      }
      throw new ApiError(envelope?.error?.message || '请求未完成，请重试。', response.status, envelope?.error?.code);
    }
    return envelope.data;
  }
  return {
    request,
    async loginOptions() {
      const data = await request('/login-options', { anonymous: true });
      if (typeof data?.totpRequired !== 'boolean') throw new ApiError('登录方式加载失败，请重试。', 0, 'INVALID_LOGIN_OPTIONS');
      return data;
    },
    async session() {
      const data = await request('/session');
      csrfToken = data.csrfToken;
      return data.admin;
    },
    async login(credentials) {
      const data = await request('/session', { method: 'POST', body: credentials, anonymous: true });
      csrfToken = data.csrfToken;
      return data.admin;
    },
    async logout() {
      await request('/logout', { method: 'POST' });
      csrfToken = '';
    },
  };
}

export function errorMessage(error) {
  if (error.status === 409) return '此记录已被其他管理员修改。你的输入仍保留；请核对最新版本后重新编辑，系统不会自动覆盖。';
  if (error.status === 401) return '管理会话已过期。你的输入仍保留，请点击“重新验证”后继续。';
  if (error.status === 403) return '无权执行此操作，或安全校验已失效。请重新验证账户权限后重试。';
  return error.message || '操作未完成，请重试。';
}
