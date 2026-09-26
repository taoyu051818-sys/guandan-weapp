import { el, field, button, errorBox, showError, clearError, busy } from './dom.js';

export function loginForm(api, onSuccess, { reauthenticate = false } = {}) {
  const username = el('input', { id: 'login-username', name: 'username', autocomplete: 'username', required: true, maxlength: 100 });
  const password = el('input', { id: 'login-password', name: 'password', type: 'password', autocomplete: 'current-password', required: true });
  const totp = el('input', { id: 'login-totp', name: 'totp', inputmode: 'numeric', autocomplete: 'one-time-code', pattern: '[0-9]{6}', maxlength: 6, minlength: 6, disabled: true });
  const totpField = field('动态验证码', totp, '输入身份验证器中的 6 位验证码。支持粘贴及自动填充。');
  totpField.hidden = true;
  let optionsReady = false;
  let totpRequired = true;
  const error = errorBox();
  const toggle = button('显示密码', () => {
    const reveal = password.type === 'password';
    password.type = reveal ? 'text' : 'password';
    toggle.textContent = reveal ? '隐藏密码' : '显示密码';
    toggle.setAttribute('aria-pressed', String(reveal));
  }, 'quiet', { 'aria-pressed': 'false' });
  const submit = el('button', { class: 'button primary', type: 'submit', disabled: true }, reauthenticate ? '验证并继续' : '登录工作台');
  const loginHint = el('p', { class: 'hint', role: 'status' }, '正在加载登录方式…');
  const retry = button('重新加载登录方式', loadOptions, 'secondary', { hidden: true });
  const form = el('form', { class: 'login-form' }, error,
    reauthenticate ? el('p', { class: 'hint' }, '使用原账户继续可保留编辑内容；切换其他账户将清除未保存修改。') : null,
    field('管理账号', username), field('密码', password), toggle,
    totpField, loginHint, retry, submit,
    el('p', { class: 'hint' }, '仅限授权人员。账户权限与关键操作均由服务端校验。'));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!optionsReady || submit.disabled) return;
    clearError(error);
    const credentials = { username: username.value.trim(), password: password.value, ...(totpRequired ? { totp: totp.value } : {}) };
    const originalLabel = submit.textContent;
    submit.textContent = '正在验证…';
    try {
      await busy(form, async () => {
        const admin = await api.login(credentials);
        password.value = '';
        totp.value = '';
        onSuccess(admin);
      });
    } catch (failure) {
      showError(error, failure.status === 401 ? new Error(totpRequired
        ? '登录验证失败。请核对账号、密码与动态验证码后重试。'
        : '登录验证失败。请核对账号和密码后重试。') : failure);
    } finally {
      submit.textContent = originalLabel;
    }
  });
  async function loadOptions() {
    retry.hidden = true;
    clearError(error);
    loginHint.textContent = '正在加载登录方式…';
    try {
      ({ totpRequired } = await api.loginOptions());
      totpField.hidden = !totpRequired;
      totp.required = totpRequired;
      totp.disabled = !totpRequired;
      optionsReady = true;
      submit.disabled = false;
      loginHint.textContent = totpRequired ? '' : '本机测试：输入账号和密码即可登录，无需动态验证码。';
    } catch (failure) {
      loginHint.textContent = '暂时无法加载登录方式，请重试。';
      showError(error, failure);
      retry.hidden = false;
    }
  }
  void loadOptions();
  return form;
}
