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
  accountName.textContent = user.name || "Saltbread 사용자";
  accountEmail.textContent = user.email;
  authView.hidden = true;
  accountView.hidden = false;
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
    await chrome.storage.local.remove("auth");
    logoutButton.disabled = false;
    logoutButton.textContent = "로그아웃";
    showAuth();
  }
});

async function initialize() {
  const { auth } = await chrome.storage.local.get("auth");

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

initialize();
