import { enhanceSelect } from './custom-select.js';

(function () {
  let authModal = document.getElementById('authModal');
  let authTitle = document.getElementById('authTitle');
  let authForm = document.getElementById('authForm');
  let toggleAuth = document.getElementById('toggleAuth');
  let authSubmit = document.getElementById('authSubmit');
  let mode = 'login';
  const DEFAULT_AVATAR = '/assets/Snale_Avatar.webp';

  function closeOtherDropdowns(exceptWrapperSelector) {
    if (exceptWrapperSelector !== '.user-menu-wrapper') {
      const openMenu = document.querySelector('.user-dropdown-menu.visible');
      if (openMenu) {
        openMenu.classList.remove('visible');
        openMenu.setAttribute('aria-hidden', 'true');
        const toggle = openMenu.previousElementSibling;
        if (toggle && toggle.matches('.user-dropdown-toggle')) {
          toggle.setAttribute('aria-expanded', 'false');
        }
      }
    }

    if (exceptWrapperSelector !== '.notif-menu-wrapper') {
      const openNotifMenu = document.querySelector('.notif-dropdown-menu.visible');
      if (openNotifMenu) {
        openNotifMenu.classList.remove('visible');
        openNotifMenu.setAttribute('aria-hidden', 'true');
        const wrapper = openNotifMenu.closest('.notif-menu-wrapper');
        const toggle = wrapper && wrapper.querySelector('.notif-bell-toggle');
        if (toggle) toggle.setAttribute('aria-expanded', 'false');
      }
    }

    if (exceptWrapperSelector !== '.nav-search') {
      const openSearch = document.querySelector('.nav-search.open');
      if (openSearch) closeNavSearch(openSearch);
    }
  }

  let authError = null;

  if (!authModal) {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
      <div id="authModal" class="auth-modal">
        <div class="auth-box">
          <h2 id="authTitle">Login</h2>
          <form id="authForm">
            <input id="username" type="text" placeholder="Username" required />
            <input id="password" type="password" placeholder="Password" required />
            <div id="authError" class="auth-error" hidden></div>
            <button id="authSubmit" type="submit">Login</button>
            <div class="auth-divider" id="authDivider">or</div>
            <p class="auth-toggle auth-passkey-row" id="authPasskeyRow">
              <button type="button" id="passkeyLoginBtn" class="btn btn-ghost btn-sm">Sign in with a passkey</button>
            </p>
            <div class="auth-footer-links">
              <a href="#" id="toggleAuth">Create an account</a>
              <span id="authForgotWrap" class="auth-forgot-group">
                <span class="auth-footer-sep" aria-hidden="true">·</span>
                <a href="#" id="forgotPasswordLink">Forgot password?</a>
              </span>
            </div>
          </form>
        </div>
      </div>
    `;
    document.body.appendChild(wrapper.firstElementChild);

    authModal = document.getElementById('authModal');
    authTitle = document.getElementById('authTitle');
    authForm = document.getElementById('authForm');
    toggleAuth = document.getElementById('toggleAuth');
    authSubmit = document.getElementById('authSubmit');
    authError = document.getElementById('authError');
  } else {
    authError = document.getElementById('authError');
  }

  const forgotPasswordLink = document.getElementById('forgotPasswordLink');
  const authForgotWrap = document.getElementById('authForgotWrap');
  const authPasskeyRow = document.getElementById('authPasskeyRow');
  const authDivider = document.getElementById('authDivider');

  function showAuthError(msg) {
    if (!authError) return;
    authError.textContent = msg;
    authError.hidden = false;
  }

  function clearAuthError() {
    if (!authError) return;
    authError.textContent = '';
    authError.hidden = true;
  }

  function validatePassword(password) {
    if (password.length < 8) return 'Password must be at least 8 characters.';
    if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
      return 'Password must contain at least one letter and one number.';
    }
    return null;
  }

  function passkeySupported() {
    return !!(window.SimpleWebAuthnBrowser && window.PublicKeyCredential);
  }

  function setAuthMode(newMode) {
    mode = newMode;
    authTitle.textContent = mode === 'login' ? 'Login' : 'Register';
    authSubmit.textContent = mode === 'login' ? 'Login' : 'Register';
    toggleAuth.textContent = mode === 'login' ? 'Create an account' : 'Already have an account? Login';
    if (authForgotWrap) authForgotWrap.hidden = mode !== 'login';
    const showPasskey = mode === 'login' && passkeySupported();
    if (authPasskeyRow) authPasskeyRow.hidden = !showPasskey;
    if (authDivider) authDivider.hidden = !showPasskey;
    clearAuthError();
  }

  if (authForgotWrap) authForgotWrap.hidden = mode !== 'login';

  if (toggleAuth) toggleAuth.addEventListener('click', e => {
    e.preventDefault();
    setAuthMode(mode === 'login' ? 'register' : 'login');
  });

  if (forgotPasswordLink) forgotPasswordLink.addEventListener('click', e => {
    e.preventDefault();
    authModal.classList.remove('active');
    openRecoveryModal();
  });

  if (authModal) authModal.addEventListener('click', e => {
    if (e.target === authModal) authModal.classList.remove('active');
  });

  if (authForm) authForm.addEventListener('submit', async e => {
    e.preventDefault();
    clearAuthError();
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value.trim();

    if (mode === 'register') {
      const passwordError = validatePassword(password);
      if (passwordError) {
        showAuthError(passwordError);
        return;
      }
    }

    const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
    const body = { username, password };
    if (mode === 'register') {
      const setup = authForm._recoverySetup;
      if (setup) {
        if (setup.securityQuestion && setup.securityAnswer) {
          body.securityQuestion = setup.securityQuestion;
          body.securityAnswer = setup.securityAnswer;
        }
        if (setup.wantsRecoveryCode) body.wantsRecoveryCode = true;
      }
    }

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const json = await res.json();
      if (json.ok || json.success) {
        if (mode === 'register') {
          authModal.classList.remove('active');
          handlePostRegister(json);
        } else {
          authModal.classList.remove('active');
          window.location.reload();
        }
      } else {
        showAuthError(json.error || json.message || 'Auth failed');
      }
    } catch {
      showAuthError('Network error. Please try again.');
    }
  });

  const passkeyLoginBtn = document.getElementById('passkeyLoginBtn');
  if (!passkeySupported()) {
    if (authPasskeyRow) authPasskeyRow.hidden = true;
    if (authDivider) authDivider.hidden = true;
  }

  if (passkeyLoginBtn) passkeyLoginBtn.addEventListener('click', async () => {
    clearAuthError();
    try {
      const optRes = await fetch('/api/auth/passkey/login-options', {
        method: 'POST',
        credentials: 'include'
      });
      const optJson = await optRes.json();
      if (!optJson.ok) {
        showAuthError(optJson.error || 'Could not start passkey sign-in.');
        return;
      }

      const assertion = await window.SimpleWebAuthnBrowser.startAuthentication({ optionsJSON: optJson.options });

      const verifyRes = await fetch('/api/auth/passkey/login-verify', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: assertion })
      });
      const verifyJson = await verifyRes.json();
      if (verifyJson.ok) {
        authModal.classList.remove('active');
        window.location.reload();
      } else {
        showAuthError(verifyJson.error || 'Passkey sign-in failed.');
      }
    } catch (err) {
      if (err.name !== 'NotAllowedError') {
        console.error('Passkey login failed:', err);
        showAuthError('Passkey sign-in failed.');
      }
    }
  });


  let recoveryModal = document.getElementById('recoveryModal');

  function buildRecoveryModal() {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
      <div id="recoveryModal" class="auth-modal">
        <div class="auth-box">
          <h2>Recover your account</h2>
          <div id="recoveryStepUsername">
            <form id="recoveryUsernameForm">
              <input id="recoveryUsername" type="text" placeholder="Username" required />
              <div id="recoveryUsernameError" class="auth-error" hidden></div>
              <button type="submit">Continue</button>
            </form>
          </div>
          <div id="recoveryStepDetails" hidden>
            <div id="recoveryMethodPicker" class="recovery-method-picker" hidden>
              <button type="button" class="recovery-method-tab" id="recoveryMethodTabQuestion">Security question</button>
              <button type="button" class="recovery-method-tab" id="recoveryMethodTabCode">Recovery code</button>
            </div>
            <form id="recoveryDetailsForm">
              <div id="recoveryQuestionField" hidden>
                <label class="auth-field-label" id="recoveryQuestionLabel"></label>
                <input id="recoverySecurityAnswer" type="text" placeholder="Your answer" autocomplete="off" />
              </div>
              <div id="recoveryCodeField" hidden>
                <label class="auth-field-label">Recovery code</label>
                <input id="recoveryCodeInput" type="text" placeholder="XXXX-XXXX-XXXX-XXXX" autocomplete="off" />
              </div>
              <input id="recoveryNewPassword" type="password" placeholder="New password" />
              <div id="recoveryDetailsError" class="auth-error" hidden></div>
              <button type="submit">Reset Password</button>
            </form>
          </div>
          <div id="recoveryNoMethod" hidden>
            <p class="auth-note">This account has no recovery method set up. Contact support.</p>
          </div>
          <p class="auth-toggle">
            <a href="#" id="closeRecoveryModal">Back to login</a>
          </p>
        </div>
      </div>
    `;
    document.body.appendChild(wrapper.firstElementChild);
    return document.getElementById('recoveryModal');
  }

  function resetRecoveryModal() {
    const usernameStep = document.getElementById('recoveryStepUsername');
    const detailsStep = document.getElementById('recoveryStepDetails');
    const noMethod = document.getElementById('recoveryNoMethod');
    const usernameForm = document.getElementById('recoveryUsernameForm');
    const detailsForm = document.getElementById('recoveryDetailsForm');
    if (usernameForm) usernameForm.reset();
    if (detailsForm) detailsForm.reset();
    usernameStep.hidden = false;
    detailsStep.hidden = true;
    noMethod.hidden = true;
    const err1 = document.getElementById('recoveryUsernameError');
    const err2 = document.getElementById('recoveryDetailsError');
    if (err1) { err1.hidden = true; err1.textContent = ''; }
    if (err2) { err2.hidden = true; err2.textContent = ''; }
  }

  function openRecoveryModal() {
    if (!recoveryModal) {
      recoveryModal = buildRecoveryModal();
      wireRecoveryModal();
    }
    resetRecoveryModal();
    recoveryModal.classList.add('active');
  }

  function selectRecoveryMethod(method) {
    const qField = document.getElementById('recoveryQuestionField');
    const codeField = document.getElementById('recoveryCodeField');
    const qTab = document.getElementById('recoveryMethodTabQuestion');
    const codeTab = document.getElementById('recoveryMethodTabCode');

    qField.hidden = method !== 'question';
    codeField.hidden = method !== 'code';
    qTab.classList.toggle('active', method === 'question');
    codeTab.classList.toggle('active', method === 'code');

    if (method === 'question') {
      document.getElementById('recoveryCodeInput').value = '';
    } else {
      document.getElementById('recoverySecurityAnswer').value = '';
    }
  }

  function wireRecoveryModal() {
    const usernameForm = document.getElementById('recoveryUsernameForm');
    const detailsForm = document.getElementById('recoveryDetailsForm');
    const closeLink = document.getElementById('closeRecoveryModal');
    const qTab = document.getElementById('recoveryMethodTabQuestion');
    const codeTab = document.getElementById('recoveryMethodTabCode');

    qTab.addEventListener('click', () => selectRecoveryMethod('question'));
    codeTab.addEventListener('click', () => selectRecoveryMethod('code'));

    recoveryModal.addEventListener('click', e => {
      if (e.target === recoveryModal) recoveryModal.classList.remove('active');
    });

    if (closeLink) closeLink.addEventListener('click', e => {
      e.preventDefault();
      recoveryModal.classList.remove('active');
      authModal.classList.add('active');
    });

    usernameForm.addEventListener('submit', async e => {
      e.preventDefault();
      const errEl = document.getElementById('recoveryUsernameError');
      errEl.hidden = true;
      const username = document.getElementById('recoveryUsername').value.trim();
      if (!username) return;

      try {
        const res = await fetch('/api/auth/recovery-options', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username })
        });
        const json = await res.json();
        if (!json.ok) {
          errEl.textContent = json.error || 'Could not look up that account.';
          errEl.hidden = false;
          return;
        }

        if (!json.hasSecurityQuestion && !json.hasRecoveryCode) {
          document.getElementById('recoveryStepUsername').hidden = true;
          document.getElementById('recoveryNoMethod').hidden = false;
          return;
        }

        detailsForm._username = username;
        detailsForm._hasSecurityQuestion = json.hasSecurityQuestion;
        detailsForm._hasRecoveryCode = json.hasRecoveryCode;

        document.getElementById('recoveryQuestionLabel').textContent = json.question || 'Security question';

        const picker = document.getElementById('recoveryMethodPicker');
        if (json.hasSecurityQuestion && json.hasRecoveryCode) {
          picker.hidden = false;
          selectRecoveryMethod('question');
        } else {
          picker.hidden = true;
          document.getElementById('recoveryQuestionField').hidden = !json.hasSecurityQuestion;
          document.getElementById('recoveryCodeField').hidden = !json.hasRecoveryCode;
        }

        document.getElementById('recoveryStepUsername').hidden = true;
        document.getElementById('recoveryStepDetails').hidden = false;
      } catch {
        errEl.textContent = 'Network error. Please try again.';
        errEl.hidden = false;
      }
    });

    detailsForm.addEventListener('submit', async e => {
      e.preventDefault();
      const errEl = document.getElementById('recoveryDetailsError');
      errEl.hidden = true;

      const newPassword = document.getElementById('recoveryNewPassword').value;
      const passwordError = validatePassword(newPassword);
      if (passwordError) {
        errEl.textContent = passwordError;
        errEl.hidden = false;
        return;
      }

      const securityAnswer = document.getElementById('recoverySecurityAnswer').value.trim();
      const recoveryCode = document.getElementById('recoveryCodeInput').value.trim();

      if (!securityAnswer && !recoveryCode) {
        errEl.textContent = 'Enter your security answer or recovery code.';
        errEl.hidden = false;
        return;
      }

      try {
        const res = await fetch('/api/auth/recover-password', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: detailsForm._username,
            securityAnswer: securityAnswer || undefined,
            recoveryCode: recoveryCode || undefined,
            newPassword
          })
        });
        const json = await res.json();
        if (json.ok) {
          recoveryModal.classList.remove('active');
          setAuthMode('login');
          clearAuthError();
          showAuthError('Password reset. You can log in now.');
          authModal.classList.add('active');
        } else {
          errEl.textContent = json.error || 'Recovery failed.';
          errEl.hidden = false;
        }
      } catch {
        errEl.textContent = 'Network error. Please try again.';
        errEl.hidden = false;
      }
    });
  }


  function buildSetupModal() {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
      <div id="recoverySetupModal" class="auth-modal">
        <div class="auth-box">
          <h2>Account Recovery</h2>
          <p class="auth-note">Helps you get back in if you forget your password.</p>
          <form id="recoverySetupForm">
            <div id="setupExistingQuestion" class="setup-existing-question" hidden>
              <label class="auth-field-label">Security question</label>
              <p class="setup-existing-question-text" id="setupExistingQuestionText"></p>
              <button type="button" class="btn btn-primary" id="removeSecurityQuestion">Remove</button>
            </div>
            <div id="setupQuestionFields">
              <label class="auth-field-label">Security question</label>
              <input id="setupQuestion" type="text" placeholder="e.g. First pet's name?" />
              <input id="setupAnswer" type="text" placeholder="Answer" autocomplete="off" />
            </div>
            <div class="auth-or-divider"><span>or</span></div>
            <div id="setupExistingCode" class="setup-existing-question" hidden>
              <label class="auth-field-label">Backup recovery code</label>
              <p class="setup-existing-question-text">A recovery code is already set up.</p>
              <div class="setup-existing-code-actions">
                <button type="button" class="btn btn-primary" id="regenerateRecoveryCode">Regenerate</button>
                <button type="button" class="btn btn-primary" id="removeRecoveryCode">Remove</button>
              </div>
            </div>
            <label id="setupWantsCodeLabel" class="auth-checkbox-label auth-checkbox-box">
              <input id="setupWantsCode" type="checkbox" />
              Generate a backup recovery code
            </label>
            <div id="setupPasswordField">
              <label class="auth-field-label">Current password</label>
              <input id="setupCurrentPassword" type="password" placeholder="Current password" autocomplete="current-password" />
            </div>
            <div id="setupError" class="auth-error" hidden></div>
            <button type="submit">Save</button>
          </form>
          <p class="auth-toggle">
            <a href="#" id="skipSetup">Skip for now</a>
          </p>
        </div>
      </div>
    `;
    document.body.appendChild(wrapper.firstElementChild);
    return document.getElementById('recoverySetupModal');
  }

  function buildCodeDisplayModal() {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
      <div id="recoveryCodeModal" class="auth-modal">
        <div class="auth-box">
          <h2>Save Your Code</h2>
          <p class="auth-note auth-note-warning">This is shown once. Keep it somewhere safe.</p>
          <div class="recovery-code-display" id="recoveryCodeDisplay"></div>
          <button type="button" class="btn btn-primary" id="copyRecoveryCode">Copy to clipboard</button>
          <label class="auth-checkbox-label">
            <input id="ackRecoveryCode" type="checkbox" />
            I've saved this code somewhere safe
          </label>
          <button type="button" class="btn btn-primary" id="ackRecoveryCodeBtn" disabled>Done</button>
        </div>
      </div>
    `;
    document.body.appendChild(wrapper.firstElementChild);
    return document.getElementById('recoveryCodeModal');
  }

  function showRecoveryCode(code, onDone) {
    let modal = document.getElementById('recoveryCodeModal');
    if (!modal) modal = buildCodeDisplayModal();

    const display = document.getElementById('recoveryCodeDisplay');
    display.textContent = code;

    const ackBox = document.getElementById('ackRecoveryCode');
    const ackBtn = document.getElementById('ackRecoveryCodeBtn');
    ackBox.checked = false;
    ackBtn.disabled = true;

    ackBox.onchange = () => {
      ackBtn.disabled = !ackBox.checked;
    };

    document.getElementById('copyRecoveryCode').onclick = async () => {
      try {
        await navigator.clipboard.writeText(code);
        showToastLike('Copied to clipboard');
      } catch {
      }
    };

    ackBtn.onclick = () => {
      modal.classList.remove('active');
      if (onDone) onDone();
    };

    modal.classList.add('active');
  }

  function showToastLike(msg) {
    const area = document.getElementById('toastArea');
    if (!area) return;
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    area.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 250);
    }, 1500);
  }

  async function openSetupModal(options) {
    const fromDashboard = !!(options && options.fromDashboard);
    let modal = document.getElementById('recoverySetupModal');
    if (!modal) {
      modal = buildSetupModal();
      wireSetupModal(modal);
    }
    modal._fromDashboard = fromDashboard;
    modal._hasExistingQuestion = false;
    modal._hasExistingCode = false;

    const passwordField = document.getElementById('setupPasswordField');
    const skip = document.getElementById('skipSetup');
    const existingBlock = document.getElementById('setupExistingQuestion');
    const existingCodeBlock = document.getElementById('setupExistingCode');
    const wantsCodeLabel = document.getElementById('setupWantsCodeLabel');
    const questionFields = document.getElementById('setupQuestionFields');
    if (fromDashboard) {
      passwordField.hidden = false;
      skip.textContent = 'Close';
    } else {
      passwordField.hidden = true;
      skip.textContent = 'Skip for now';
    }
    document.getElementById('setupCurrentPassword').value = '';
    document.getElementById('setupQuestion').value = '';
    document.getElementById('setupAnswer').value = '';
    document.getElementById('setupWantsCode').checked = false;
    document.getElementById('setupError').hidden = true;
    existingBlock.hidden = true;
    existingCodeBlock.hidden = true;
    wantsCodeLabel.hidden = false;
    setQuestionFieldsLocked(false);

    modal.classList.add('active');

    if (fromDashboard) {
      try {
        const statusRes = await fetch('/api/auth/status', { credentials: 'include' });
        const statusJson = await statusRes.json();
        if (!statusJson.ok || !statusJson.user) return;
        const res = await fetch('/api/auth/recovery-options', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: statusJson.user.username })
        });
        const json = await res.json();
        if (json.ok && json.hasSecurityQuestion) {
          modal._hasExistingQuestion = true;
          document.getElementById('setupExistingQuestionText').textContent = json.question || '';
          existingBlock.hidden = false;
          setQuestionFieldsLocked(true);
        }
        if (json.ok && json.hasRecoveryCode) {
          modal._hasExistingCode = true;
          existingCodeBlock.hidden = false;
          wantsCodeLabel.hidden = true;
        }
      } catch {
      }
    }
  }

  function setQuestionFieldsLocked(locked) {
    const questionFields = document.getElementById('setupQuestionFields');
    const questionInput = document.getElementById('setupQuestion');
    const answerInput = document.getElementById('setupAnswer');
    questionFields.classList.toggle('setup-fields-locked', locked);
    questionInput.disabled = locked;
    answerInput.disabled = locked;
    if (locked) {
      questionInput.placeholder = 'Remove your current question first';
      answerInput.placeholder = '';
    } else {
      questionInput.placeholder = "e.g. First pet's name?";
      answerInput.placeholder = 'Answer';
    }
  }

  function wireSetupModal(modal) {
    const form = document.getElementById('recoverySetupForm');
    const skip = document.getElementById('skipSetup');

    modal.addEventListener('click', e => {
      if (e.target === modal) modal.classList.remove('active');
    });

    skip.addEventListener('click', e => {
      e.preventDefault();
      modal.classList.remove('active');
    });

    const removeBtn = document.getElementById('removeSecurityQuestion');
    removeBtn.addEventListener('click', async () => {
      const errEl = document.getElementById('setupError');
      errEl.hidden = true;
      const typedPassword = document.getElementById('setupCurrentPassword').value;
      if (!typedPassword) {
        errEl.textContent = 'Enter your current password to remove it.';
        errEl.hidden = false;
        return;
      }
      try {
        const res = await fetch('/api/auth/remove-security-question', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currentPassword: typedPassword })
        });
        const json = await res.json();
        if (json.ok) {
          modal._hasExistingQuestion = false;
          document.getElementById('setupExistingQuestion').hidden = true;
          setQuestionFieldsLocked(false);
        } else {
          errEl.textContent = json.error || 'Could not remove security question.';
          errEl.hidden = false;
        }
      } catch {
        errEl.textContent = 'Network error. Please try again.';
        errEl.hidden = false;
      }
    });

    const removeCodeBtn = document.getElementById('removeRecoveryCode');
    removeCodeBtn.addEventListener('click', async () => {
      const errEl = document.getElementById('setupError');
      errEl.hidden = true;
      const typedPassword = document.getElementById('setupCurrentPassword').value;
      if (!typedPassword) {
        errEl.textContent = 'Enter your current password to remove it.';
        errEl.hidden = false;
        return;
      }
      try {
        const res = await fetch('/api/auth/remove-recovery-code', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currentPassword: typedPassword })
        });
        const json = await res.json();
        if (json.ok) {
          modal._hasExistingCode = false;
          document.getElementById('setupExistingCode').hidden = true;
          document.getElementById('setupWantsCodeLabel').hidden = false;
        } else {
          errEl.textContent = json.error || 'Could not remove recovery code.';
          errEl.hidden = false;
        }
      } catch {
        errEl.textContent = 'Network error. Please try again.';
        errEl.hidden = false;
      }
    });

    const regenerateCodeBtn = document.getElementById('regenerateRecoveryCode');
    regenerateCodeBtn.addEventListener('click', async () => {
      const errEl = document.getElementById('setupError');
      errEl.hidden = true;
      const typedPassword = document.getElementById('setupCurrentPassword').value;
      if (!typedPassword) {
        errEl.textContent = 'Enter your current password to regenerate it.';
        errEl.hidden = false;
        return;
      }
      try {
        const res = await fetch('/api/auth/regenerate-recovery-code', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currentPassword: typedPassword })
        });
        const json = await res.json();
        if (json.ok) {
          modal.classList.remove('active');
          showRecoveryCode(json.recoveryCode, () => window.location.reload());
        } else {
          errEl.textContent = json.error || 'Could not regenerate recovery code.';
          errEl.hidden = false;
        }
      } catch {
        errEl.textContent = 'Network error. Please try again.';
        errEl.hidden = false;
      }
    });

    form.addEventListener('submit', async e => {
      e.preventDefault();
      const errEl = document.getElementById('setupError');
      errEl.hidden = true;

      const question = document.getElementById('setupQuestion').value.trim();
      const answer = document.getElementById('setupAnswer').value.trim();
      const wantsCode = document.getElementById('setupWantsCode').checked;
      const typedPassword = document.getElementById('setupCurrentPassword').value;

      if ((question && !answer) || (!question && answer)) {
        errEl.textContent = 'Provide both a security question and an answer, or leave both blank.';
        errEl.hidden = false;
        return;
      }

      if (!question && !answer && !wantsCode) {
        modal.classList.remove('active');
        return;
      }

      if ((question && answer || wantsCode) && modal._fromDashboard && !typedPassword) {
        errEl.textContent = 'Enter your current password to continue.';
        errEl.hidden = false;
        return;
      }

      try {
        let ok = true;
        let recoveryCode = null;

        if (question && answer) {
          const res = await fetch('/api/auth/set-security-question', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              securityQuestion: question,
              securityAnswer: answer,
              currentPassword: modal._fromDashboard ? typedPassword : (modal._justRegisteredPassword || '')
            })
          });
          const json = await res.json();
          if (!json.ok) {
            ok = false;
            errEl.textContent = json.error || 'Could not save security question.';
            errEl.hidden = false;
          }
        }

        if (ok && wantsCode) {
          const res = await fetch('/api/auth/regenerate-recovery-code', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              currentPassword: modal._fromDashboard ? typedPassword : (modal._justRegisteredPassword || '')
            })
          });
          const json = await res.json();
          if (json.ok) {
            recoveryCode = json.recoveryCode;
          } else {
            ok = false;
            errEl.textContent = json.error || 'Could not generate recovery code.';
            errEl.hidden = false;
          }
        }

        if (!ok) return;

        modal.classList.remove('active');
        if (recoveryCode) {
          showRecoveryCode(recoveryCode, () => window.location.reload());
        } else {
          window.location.reload();
        }
      } catch {
        errEl.textContent = 'Network error. Please try again.';
        errEl.hidden = false;
      }
    });
  }

  async function handlePostRegister(registerJson) {
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value.trim();

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const json = await res.json();
      if (!json.ok) {
        window.location.reload();
        return;
      }
    } catch {
      window.location.reload();
      return;
    }

    if (registerJson.recoveryCode) {
      showRecoveryCode(registerJson.recoveryCode, () => window.location.reload());
      return;
    }

    let modal = document.getElementById('recoverySetupModal');
    if (!modal) {
      modal = buildSetupModal();
      wireSetupModal(modal);
    }
    modal._justRegisteredPassword = password;
    modal.classList.add('active');
  }

  document.addEventListener('click', e => {
    const loginBtn = e.target.closest('#authBtn,[data-open-auth]');
    if (loginBtn) {
      clearAuthError();
      authModal.classList.add('active');
      return;
    }

    const dropdownItem = e.target.closest('.user-dropdown-item');
    if (dropdownItem) {
      const action = dropdownItem.dataset.action;
      const href = dropdownItem.dataset.href;
      if (action === 'logout') {
        fetch('/api/auth/logout', { method: 'POST' }).then(() => window.location.reload());
      } else if (href) {
        window.location.href = href;
      }
      return;
    }

    const openMenu = document.querySelector('.user-dropdown-menu.visible');
    if (openMenu && !e.target.closest('.user-menu-wrapper')) {
      openMenu.classList.remove('visible');
      openMenu.setAttribute('aria-hidden', 'true');
      const toggle = openMenu.previousElementSibling;
      if (toggle && toggle.matches('.user-dropdown-toggle')) {
        toggle.setAttribute('aria-expanded', 'false');
      }
    }

    const openNotifMenu = document.querySelector('.notif-dropdown-menu.visible');
    if (openNotifMenu && !e.target.closest('.notif-menu-wrapper')) {
      openNotifMenu.classList.remove('visible');
      openNotifMenu.setAttribute('aria-hidden', 'true');
      const wrapper = openNotifMenu.closest('.notif-menu-wrapper');
      const toggle = wrapper && wrapper.querySelector('.notif-bell-toggle');
      if (toggle) toggle.setAttribute('aria-expanded', 'false');
    }

    const openSearch = document.querySelector('.nav-search.open');
    if (openSearch && !e.target.closest('.nav-search')) {
      closeNavSearch(openSearch);
    }
  });

  function navigateToSearchResult(result) {
    if (!result) return;
    if (result.type === 'addon') {
      window.location.href = `/addon.html?id=${encodeURIComponent(result.id)}`;
    } else if (result.type === 'user') {
      window.location.href = `/profile/${encodeURIComponent(result.username)}`;
    }
  }

  function resultLabel(result) {
    if (result.type === 'addon') return result.name || 'Untitled addon';
    return `@${result.username}`;
  }

  function closeNavSearch(searchEl) {
    searchEl.classList.remove('open');
    const results = searchEl.querySelector('.nav-search-results');
    if (results) {
      results.innerHTML = '';
      results.setAttribute('aria-hidden', 'true');
    }
  }

  function renderSearchResults(searchEl, data) {
    const results = searchEl.querySelector('.nav-search-results');
    const input = searchEl.querySelector('.nav-search-input');
    const items = [
      ...(data.addons || []).map(addon => ({ type: 'addon', ...addon })),
      ...(data.users || []).map(user => ({ type: 'user', ...user }))
    ];

    searchEl._results = items;
    results.innerHTML = '';

    if (!input.value.trim()) {
      closeNavSearch(searchEl);
      return;
    }

    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'nav-search-empty';
      empty.textContent = 'No matches found';
      results.appendChild(empty);
      searchEl.classList.add('open');
      results.setAttribute('aria-hidden', 'false');
      return;
    }

    items.forEach(item => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'nav-search-result';

      const media = document.createElement('img');
      media.className = 'nav-search-result-media';
      media.src = item.type === 'addon'
        ? (item.iconUrl || '/assets/default_icon.png')
        : (item.avatarUrl || DEFAULT_AVATAR);
      media.alt = '';
      media.onerror = () => {
        media.src = item.type === 'addon' ? '/assets/default_icon.png' : DEFAULT_AVATAR;
      };

      const body = document.createElement('span');
      body.className = 'nav-search-result-body';

      const title = document.createElement('span');
      title.className = 'nav-search-result-title';
      title.textContent = resultLabel(item);

      const meta = document.createElement('span');
      meta.className = 'nav-search-result-meta';
      meta.textContent = item.type === 'addon'
        ? `Addon by ${item.author || 'Unknown'}`
        : 'User profile';

      body.append(title, meta);

      const badge = document.createElement('span');
      badge.className = 'nav-search-result-badge';
      badge.textContent = item.type === 'addon' ? 'Addon' : 'User';

      button.append(media, body, badge);
      button.addEventListener('click', () => navigateToSearchResult(item));
      results.appendChild(button);
    });

    searchEl.classList.add('open');
    results.setAttribute('aria-hidden', 'false');
  }

  function ensureNavSearch() {
    if (document.body.classList.contains('no-nav-search')) return;
    const header = document.querySelector('.site-header, .uh-header');
    const actions = document.querySelector('.header-actions');
    if (!header || !actions || header.querySelector('.nav-search')) return;

    const searchEl = document.createElement('form');
    searchEl.className = 'nav-search';
    searchEl.setAttribute('role', 'search');
    searchEl.innerHTML = `
      <select class="nav-search-type" aria-label="Search type">
        <option value="all">All</option>
        <option value="addons">Addons</option>
        <option value="users">Users</option>
      </select>
      <input class="nav-search-input" type="search" placeholder="Search addons or users" autocomplete="off" aria-label="Search addons or users">
      <div class="nav-search-results" aria-hidden="true"></div>
    `;

    header.insertBefore(searchEl, actions);

    const input = searchEl.querySelector('.nav-search-input');
    const type = searchEl.querySelector('.nav-search-type');
    enhanceSelect(type);
    let timer;
    let requestId = 0;

    async function search() {
      const q = input.value.trim();
      const currentRequest = ++requestId;
      if (!q) {
        closeNavSearch(searchEl);
        return;
      }

      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&type=${encodeURIComponent(type.value)}`);
        const data = await res.json().catch(() => ({ ok: false }));
        if (currentRequest !== requestId) return;
        renderSearchResults(searchEl, data.ok ? data : { addons: [], users: [] });
      } catch {
        if (currentRequest === requestId) renderSearchResults(searchEl, { addons: [], users: [] });
      }
    }

    function scheduleSearch() {
      clearTimeout(timer);
      timer = setTimeout(search, 180);
    }

    input.addEventListener('input', scheduleSearch);
    input.addEventListener('focus', () => {
      closeOtherDropdowns('.nav-search');
      if (searchEl._results?.length) {
        searchEl.classList.add('open');
        searchEl.querySelector('.nav-search-results').setAttribute('aria-hidden', 'false');
      }
    });
    type.addEventListener('change', search);

    searchEl.addEventListener('submit', e => {
      e.preventDefault();
      const first = searchEl._results?.[0];
      if (first) navigateToSearchResult(first);
      else search();
    });

    searchEl.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        input.blur();
        closeNavSearch(searchEl);
      }
    });
  }

  function createUserDropdown(user) {
    const username = user.username;
    const wrapper = document.createElement('div');
    wrapper.className = 'user-menu-wrapper';

    const userLabel = document.createElement('button');
    userLabel.type = 'button';
    userLabel.className = 'btn btn-ghost auth-btn user-label user-dropdown-toggle';
    userLabel.title = 'Account';
    userLabel.setAttribute('aria-haspopup', 'menu');
    userLabel.setAttribute('aria-expanded', 'false');

    const userIcon = document.createElement('img');
    userIcon.className = 'user-icon';
    const avatarUrl = user.avatarUrl || DEFAULT_AVATAR;
    userIcon.src = avatarUrl;
    userIcon.onerror = () => {
      userIcon.src = DEFAULT_AVATAR;
    };
    userIcon.alt = 'User avatar';

    const userName = document.createElement('span');
    userName.className = 'user-name';
    userName.textContent = 'Account';

    const arrow = document.createElement('span');
    arrow.className = 'user-dropdown-arrow';
    arrow.textContent = '▾';

    userLabel.append(userIcon, userName, arrow);

    const menu = document.createElement('div');
    menu.className = 'user-dropdown-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-hidden', 'true');

    const items = [
      { action: 'profile', label: 'Profile', href: `/profile/${encodeURIComponent(username)}` },
      { action: 'dashboard', label: 'Dashboard', href: '/dashboard' },
      { action: 'changelog', label: 'Changelog', href: '/changelog' },
      { action: 'logout', label: 'Logout' }
    ];

    items.forEach(item => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'user-dropdown-item';
      button.setAttribute('role', 'menuitem');
      button.dataset.action = item.action;
      if (item.href) button.dataset.href = item.href;
      button.textContent = item.label;
      menu.appendChild(button);
    });

    userLabel.addEventListener('click', e => {
      e.stopPropagation();
      const isOpen = userLabel.getAttribute('aria-expanded') === 'true';
      closeOtherDropdowns('.user-menu-wrapper');
      userLabel.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
      menu.classList.toggle('visible', !isOpen);
      menu.setAttribute('aria-hidden', isOpen ? 'true' : 'false');
    });

    wrapper.append(userLabel, menu);
    return wrapper;
  }

  const NOTIF_POLL_MS = 45 * 1000;
  let notifPollTimer = null;

  function timeAgo(isoString) {
    const normalized = typeof isoString === 'string' && isoString.includes('T') ? isoString : String(isoString || '').replace(' ', 'T') + 'Z';
    const then = new Date(normalized).getTime();
    if (Number.isNaN(then)) return '';
    const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months}mo ago`;
    const years = Math.floor(months / 12);
    return `${years}y ago`;
  }

  function renderNotifBadge(wrapper, unreadCount) {
    const toggle = wrapper.querySelector('.notif-bell-toggle');
    if (!toggle) return;
    let badge = toggle.querySelector('.notif-bell-badge');
    if (unreadCount > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'notif-bell-badge';
        toggle.appendChild(badge);
      }
      badge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
    } else if (badge) {
      badge.remove();
    }
  }

  function renderNotifList(menu, notifications) {
    const list = menu.querySelector('.notif-list');
    if (!list) return;
    list.innerHTML = '';

    const clearAllBtn = menu.querySelector('.notif-clear-all');
    if (clearAllBtn) clearAllBtn.classList.toggle('hidden', notifications.length === 0);

    if (!notifications.length) {
      const empty = document.createElement('div');
      empty.className = 'notif-empty';
      empty.textContent = "You're all caught up.";
      list.appendChild(empty);
      return;
    }

    notifications.forEach(n => {
      const item = document.createElement('div');
      item.className = 'notif-item' + (n.read ? '' : ' unread');
      item.dataset.id = n.id;
      if (n.link) item.dataset.link = n.link;

      const main = document.createElement('button');
      main.type = 'button';
      main.className = 'notif-item-main';

      const message = document.createElement('span');
      message.className = 'notif-item-message';
      message.textContent = n.message;

      const time = document.createElement('span');
      time.className = 'notif-item-time';
      time.textContent = timeAgo(n.created_at);

      main.append(message, time);

      const dismiss = document.createElement('button');
      dismiss.type = 'button';
      dismiss.className = 'notif-item-dismiss';
      dismiss.title = 'Dismiss';
      dismiss.setAttribute('aria-label', 'Dismiss notification');
      dismiss.textContent = '✕';

      item.append(main, dismiss);

      if (n.type === 'creator_invite' && n.data && !n.data.resolved) {
        const actions = document.createElement('div');
        actions.className = 'notif-invite-actions';
        item.dataset.inviteId = n.data.inviteId;

        const acceptBtn = document.createElement('button');
        acceptBtn.type = 'button';
        acceptBtn.className = 'notif-invite-accept';
        acceptBtn.textContent = 'Accept';

        const declineBtn = document.createElement('button');
        declineBtn.type = 'button';
        declineBtn.className = 'notif-invite-decline';
        declineBtn.textContent = 'Decline';

        actions.append(acceptBtn, declineBtn);
        item.appendChild(actions);
      } else if (n.type === 'creator_invite' && n.data?.resolved) {
        const status = document.createElement('span');
        status.className = 'notif-invite-status';
        status.textContent = n.data.status === 'accepted' ? 'Accepted' : 'Declined';
        item.appendChild(status);
      }

      list.appendChild(item);
    });
  }

  async function fetchNotifications(wrapper) {
    let json;
    try {
      const res = await fetch('/api/notifications', { credentials: 'include' });
      if (!res.ok) return;
      json = await res.json();
    } catch {
      return;
    }
    if (!json.ok) return;

    renderNotifBadge(wrapper, json.unreadCount || 0);
    const menu = wrapper.querySelector('.notif-dropdown-menu');
    if (menu) {
      menu._notifications = json.notifications || [];
      renderNotifList(menu, menu._notifications);
    }
  }

  function createNotifBell() {
    const wrapper = document.createElement('div');
    wrapper.className = 'notif-menu-wrapper';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'notif-bell-toggle';
    toggle.title = 'Notifications';
    toggle.setAttribute('aria-haspopup', 'menu');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.innerHTML = `
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"></path>
        <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
      </svg>
    `;

    const menu = document.createElement('div');
    menu.className = 'notif-dropdown-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-hidden', 'true');
    menu.innerHTML = `
      <div class="notif-dropdown-header">
        <span>Notifications</span>
        <button type="button" class="notif-clear-all hidden">Clear all</button>
      </div>
      <div class="notif-list"></div>
    `;

    toggle.addEventListener('click', async e => {
      e.stopPropagation();
      const isOpen = toggle.getAttribute('aria-expanded') === 'true';
      closeOtherDropdowns('.notif-menu-wrapper');
      toggle.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
      menu.classList.toggle('visible', !isOpen);
      menu.setAttribute('aria-hidden', isOpen ? 'true' : 'false');

      if (!isOpen) {
        renderNotifBadge(wrapper, 0);
        menu.querySelectorAll('.notif-item.unread').forEach(el => el.classList.remove('unread'));
        try {
          await fetch('/api/notifications/read-all', { method: 'POST', credentials: 'include' });
        } catch {
        }
      }
    });

    menu.addEventListener('click', async e => {
      const dismiss = e.target.closest('.notif-item-dismiss');
      if (dismiss) {
        const item = dismiss.closest('.notif-item');
        const id = item?.dataset.id;
        if (!id) return;
        item.remove();
        menu._notifications = (menu._notifications || []).filter(n => String(n.id) !== String(id));
        if (!menu._notifications.length) renderNotifList(menu, menu._notifications);
        try {
          await fetch(`/api/notifications/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'include' });
        } catch {
        }
        return;
      }

      const clearAll = e.target.closest('.notif-clear-all');
      if (clearAll) {
        menu._notifications = [];
        renderNotifList(menu, []);
        try {
          await fetch('/api/notifications', { method: 'DELETE', credentials: 'include' });
        } catch {
        }
        return;
      }

      const inviteBtn = e.target.closest('.notif-invite-accept, .notif-invite-decline');
      if (inviteBtn) {
        e.stopPropagation();
        const item = inviteBtn.closest('.notif-item');
        const inviteId = item?.dataset.inviteId;
        if (!inviteId) return;
        const accept = inviteBtn.classList.contains('notif-invite-accept');
        const actions = item.querySelector('.notif-invite-actions');
        if (actions) actions.querySelectorAll('button').forEach(b => b.disabled = true);
        try {
          const res = await fetch(`/api/creator-invites/${encodeURIComponent(inviteId)}/respond`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accept })
          });
          const json = await res.json();
          if (!json.ok) {
            toast.error(json.error || 'Failed to respond to invite.');
            if (actions) actions.querySelectorAll('button').forEach(b => b.disabled = false);
            return;
          }
          if (actions) {
            const status = document.createElement('span');
            status.className = 'notif-invite-status';
            status.textContent = accept ? 'Accepted' : 'Declined';
            actions.replaceWith(status);
          }
        } catch {
          toast.error('Failed to respond to invite.');
          if (actions) actions.querySelectorAll('button').forEach(b => b.disabled = false);
        }
        return;
      }

      const main = e.target.closest('.notif-item-main');
      if (!main) return;
      const item = main.closest('.notif-item');
      const link = item?.dataset.link;
      if (link) window.location.href = link;
    });

    wrapper.append(toggle, menu);
    fetchNotifications(wrapper);
    return wrapper;
  }

  function startNotifPolling(wrapper) {
    stopNotifPolling();
    notifPollTimer = setInterval(() => {
      if (document.hidden) return;
      fetchNotifications(wrapper);
    }, NOTIF_POLL_MS);
  }

  function stopNotifPolling() {
    if (notifPollTimer) {
      clearInterval(notifPollTimer);
      notifPollTimer = null;
    }
  }

  async function checkAuthStatus() {
    ensureNavSearch();

    let json;
    try {
      const res = await fetch('/api/auth/status', {
        credentials: 'include'
      });
      json = await res.json();
    } catch {
      return;
    }

    const headerActions = document.querySelector('.header-actions');
    if (!headerActions) return;
    headerActions.innerHTML = '';
    stopNotifPolling();

    const user = json.user;
    const loggedIn = json.ok && user;

    if (loggedIn) {
      headerActions.append(createUserDropdown(user));
      const notifBell = createNotifBell();
      headerActions.append(notifBell);
      startNotifPolling(notifBell);
    } else {
      const loginBtn = document.createElement('button');
      loginBtn.className = 'btn btn-ghost auth-btn';
      loginBtn.id = 'authBtn';
      loginBtn.textContent = 'Login';
      loginBtn.setAttribute('data-open-auth', '1');
      headerActions.append(loginBtn);
    }
  }

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', checkAuthStatus);
  } else {
    checkAuthStatus();
  }

  window.loadNavUser = checkAuthStatus;
  window.openAccountRecoverySetup = () => openSetupModal({ fromDashboard: true });
})();
