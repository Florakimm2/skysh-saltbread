const API_BASE_URL = globalThis.SALTBREAD_CONFIG.apiBaseUrl;
const authView = document.querySelector("#auth-view");
const accountView = document.querySelector("#account-view");
const loginTab = document.querySelector("#login-tab");
const signupTab = document.querySelector("#signup-tab");
const loginForm = document.querySelector("#login-form");
const signupForm = document.querySelector("#signup-form");
const accountName = document.querySelector("#account-name");
const accountEmail = document.querySelector("#account-email");
const accountMessage = document.querySelector("#account-message");
const logoutButton = document.querySelector("#logout-button");
const apiKeyForm = document.querySelector("#api-key-form");
const apiKeyStatus = document.querySelector("#api-key-status");
const apiKeyMessage = document.querySelector("#api-key-message");
const saveApiKeyButton = document.querySelector("#save-api-key-button");
const unlockApiKeyButton = document.querySelector("#unlock-api-key-button");
const deleteApiKeyButton = document.querySelector("#delete-api-key-button");
const popupRoot = document.documentElement;
const popupFlame = new CuteIdleFlame("#popup-flame", {
  mode: "default",
  label: "현재 감정 매매 상태를 보여주는 불꽃",
});

function normalizeFlameMode(mode) {
  return ["default", "blue", "pink"].includes(mode) ? mode : "default";
}

function applyFlameTheme(mode) {
  const normalizedMode = normalizeFlameMode(mode);
  popupRoot.dataset.flameMode = normalizedMode;
  popupFlame.setMode(normalizedMode);
}

function showForm(type) {
  const isLogin = type === "login";

  loginForm.hidden = !isLogin;
  signupForm.hidden = isLogin;
  loginTab.classList.toggle("is-active", isLogin);
  signupTab.classList.toggle("is-active", !isLogin);
  loginTab.setAttribute("aria-selected", String(isLogin));
  signupTab.setAttribute("aria-selected", String(!isLogin));
}

function showAccount(user) {
  accountName.textContent = user.name || "Fireguard 사용자";
  accountEmail.textContent = user.email;
  authView.hidden = true;
  accountView.hidden = false;
  refreshCredentialStatus();
}

function showAuth() {
  authView.hidden = false;
  accountView.hidden = true;
  accountMessage.textContent = "";
}

function setMessage(form, text, isSuccess = false) {
  const message = form.querySelector(".message");
  message.textContent = text;
  message.classList.toggle("is-success", isSuccess);
}

function setSubmitting(form, isSubmitting) {
  const button = form.querySelector("button[type='submit']");
  button.disabled = isSubmitting;
  button.textContent = isSubmitting
    ? "처리 중..."
    : form === loginForm
      ? "로그인"
      : "회원가입";
}

function setApiKeyMessage(text, isSuccess = false) {
  apiKeyMessage.textContent = text;
  apiKeyMessage.classList.toggle("is-success", isSuccess);
}

async function sendBackgroundMessage(type, payload = undefined) {
  const response = await chrome.runtime.sendMessage({ type, payload });

  if (!response?.ok) {
    throw new Error(response?.error || "요청을 처리하지 못했습니다.");
  }

  return response;
}

async function refreshCredentialStatus() {
  try {
    const { status } = await sendBackgroundMessage(
      "GET_UPBIT_CREDENTIAL_STATUS",
    );
    apiKeyStatus.textContent = !status.configured
      ? "미설정"
      : status.unlocked
        ? "사용 가능"
        : "잠김";
    apiKeyStatus.dataset.state = !status.configured
      ? "empty"
      : status.unlocked
        ? "ready"
        : "locked";
    unlockApiKeyButton.hidden = !status.configured || status.unlocked;
    deleteApiKeyButton.hidden = !status.configured;
    saveApiKeyButton.textContent = status.configured
      ? "새 키로 교체"
      : "암호화 저장";
  } catch (error) {
    setApiKeyMessage(error.message);
  }
}

async function request(path, options = {}) {
  let response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      credentials: "include",
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new Error("서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.");
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const statusMessages = {
      400: "입력한 정보를 다시 확인해 주세요.",
      401: "이메일 또는 비밀번호가 올바르지 않습니다.",
      409: "이미 사용 중인 이메일입니다.",
    };

    throw new Error(
      data.message || statusMessages[response.status] || "요청에 실패했습니다.",
    );
  }

  return data;
}

loginTab.addEventListener("click", () => showForm("login"));
signupTab.addEventListener("click", () => showForm("signup"));

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage(loginForm, "");

  if (!loginForm.reportValidity()) {
    return;
  }

  const formData = new FormData(loginForm);
  setSubmitting(loginForm, true);

  try {
    const data = await request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: formData.get("email").trim(),
        password: formData.get("password"),
      }),
    });

    await chrome.storage.local.set({
      auth: {
        accessToken: data.accessToken,
        expiresAt: Date.now() + data.expiresIn * 1000,
        user: data.user,
      },
    });
    showAccount(data.user);
    loginForm.reset();
  } catch (error) {
    setMessage(loginForm, error.message);
  } finally {
    setSubmitting(loginForm, false);
  }
});

signupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage(signupForm, "");

  if (!signupForm.reportValidity()) {
    return;
  }

  const formData = new FormData(signupForm);
  const email = formData.get("email").trim();
  setSubmitting(signupForm, true);

  try {
    const data = await request("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify({
        name: formData.get("name").trim(),
        email,
        password: formData.get("password"),
      }),
    });

    signupForm.reset();
    showForm("login");
    loginForm.elements.email.value = email;
    setMessage(
      loginForm,
      data.message || "회원가입이 완료되었습니다. 로그인해 주세요.",
      true,
    );
    loginForm.elements.password.focus();
  } catch (error) {
    setMessage(signupForm, error.message);
  } finally {
    setSubmitting(signupForm, false);
  }
});

apiKeyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setApiKeyMessage("");

  const formData = new FormData(apiKeyForm);
  const accessKey = formData.get("accessKey").trim();
  const secretKey = formData.get("secretKey").trim();
  const passphrase = formData.get("passphrase");

  if (!accessKey || !secretKey || passphrase.length < 8) {
    setApiKeyMessage("Access Key, Secret Key, 8자 이상의 비밀번호를 입력해 주세요.");
    return;
  }

  saveApiKeyButton.disabled = true;

  try {
    await sendBackgroundMessage("SAVE_UPBIT_CREDENTIALS", {
      accessKey,
      secretKey,
      passphrase,
    });
    apiKeyForm.reset();
    setApiKeyMessage("API 키를 암호화해 저장하고 잠금을 해제했습니다.", true);
    await refreshCredentialStatus();
  } catch (error) {
    setApiKeyMessage(error.message);
  } finally {
    saveApiKeyButton.disabled = false;
  }
});

unlockApiKeyButton.addEventListener("click", async () => {
  const passphrase = apiKeyForm.elements.passphrase.value;
  setApiKeyMessage("");

  if (!passphrase) {
    setApiKeyMessage("로컬 암호화 비밀번호를 입력해 주세요.");
    return;
  }

  unlockApiKeyButton.disabled = true;

  try {
    await sendBackgroundMessage("UNLOCK_UPBIT_CREDENTIALS", { passphrase });
    apiKeyForm.elements.passphrase.value = "";
    setApiKeyMessage("API 키 잠금을 해제했습니다.", true);
    await refreshCredentialStatus();
  } catch (error) {
    setApiKeyMessage(error.message);
  } finally {
    unlockApiKeyButton.disabled = false;
  }
});

deleteApiKeyButton.addEventListener("click", async () => {
  deleteApiKeyButton.disabled = true;
  setApiKeyMessage("");

  try {
    await sendBackgroundMessage("DELETE_UPBIT_CREDENTIALS");
    apiKeyForm.reset();
    setApiKeyMessage("저장된 API 키를 삭제했습니다.", true);
    await refreshCredentialStatus();
  } catch (error) {
    setApiKeyMessage(error.message);
  } finally {
    deleteApiKeyButton.disabled = false;
  }
});

logoutButton.addEventListener("click", async () => {
  logoutButton.disabled = true;
  logoutButton.textContent = "처리 중...";
  accountMessage.textContent = "";

  try {
    const { auth } = await chrome.storage.local.get("auth");

    await request("/api/auth/logout", {
      method: "POST",
      headers: auth?.accessToken
        ? { Authorization: `Bearer ${auth.accessToken}` }
        : {},
    });
  } catch {
    // 서버 세션이 이미 만료되었어도 로컬 인증 정보는 제거합니다.
  } finally {
    await chrome.runtime.sendMessage({ type: "LOCK_UPBIT_CREDENTIALS" });
    await chrome.storage.local.remove("auth");
    logoutButton.disabled = false;
    logoutButton.textContent = "로그아웃";
    showAuth();
  }
});

async function initialize() {
  const { auth, flameTheme } = await chrome.storage.local.get([
    "auth",
    "flameTheme",
  ]);
  applyFlameTheme(flameTheme?.mode);

  if (auth?.user && auth.expiresAt > Date.now()) {
    showAccount(auth.user);
    return;
  }

  if (auth?.user && auth.accessToken) {
    try {
      const data = await request("/api/auth/refresh", {
        method: "POST",
        headers: { Authorization: `Bearer ${auth.accessToken}` },
      });

      if (data.accessToken && data.expiresIn) {
        await chrome.storage.local.set({
          auth: {
            ...auth,
            accessToken: data.accessToken,
            expiresAt: Date.now() + data.expiresIn * 1000,
          },
        });
        showAccount(auth.user);
        return;
      }
    } catch {
      // refresh token까지 만료된 경우 아래에서 로컬 인증 정보를 제거합니다.
    }
  }

  await chrome.storage.local.remove("auth");
  showAuth();
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.flameTheme) {
    applyFlameTheme(changes.flameTheme.newValue?.mode);
  }
});

initialize();
