const API_BASE_URL = globalThis.SALTBREAD_CONFIG.apiBaseUrl;
const popupRoot = document.documentElement;
const signedOutView = document.querySelector("#signed-out-view");
const accountView = document.querySelector("#account-view");
const openLoginButton = document.querySelector("#open-login-button");
const loginMessage = document.querySelector("#login-message");
const accountGreeting = document.querySelector("#account-greeting");
const statisticsSummary = document.querySelector("#statistics-summary");
const accountMessage = document.querySelector("#account-message");
const logoutButton = document.querySelector("#logout-button");
const apiKeyToggle = document.querySelector("#api-key-toggle");
const apiKeyDetails = document.querySelector("#api-key-details");
const apiKeyForm = document.querySelector("#api-key-form");
const apiKeyStatus = document.querySelector("#api-key-status");
const apiKeyMessage = document.querySelector("#api-key-message");
const saveApiKeyButton = document.querySelector("#save-api-key-button");
const unlockApiKeyButton = document.querySelector("#unlock-api-key-button");
const deleteApiKeyButton = document.querySelector("#delete-api-key-button");

function setPopupView(view) {
  const isAccount = view === "account";
  popupRoot.dataset.view = isAccount ? "account" : "signed-out";
  signedOutView.hidden = isAccount;
  accountView.hidden = !isAccount;
}

function renderStatistics() {
  // TODO : (통계 API)
  const tradeLogCount = 0;
  // TODO : (통계 API)
  const emotionalFeedbackCount = 0;

  statisticsSummary.textContent =
    `불씨와 함께 (${tradeLogCount})개의 기록을 쌓고 ` +
    `(${emotionalFeedbackCount})개의 감정 매도를 막았어요!`;
}

function showAccount(user) {
  const userName = user.name || "Fireguard 사용자";
  accountGreeting.textContent = `${userName} 님, 오늘도 좋은 하루에요.`;
  accountMessage.textContent = "";
  setPopupView("account");
  renderStatistics();
  refreshCredentialStatus();
}

function showSignedOut() {
  loginMessage.textContent = "";
  setPopupView("signed-out");
}

function setApiKeyMessage(text, isSuccess = false) {
  apiKeyMessage.textContent = text;
  apiKeyMessage.classList.toggle("is-success", isSuccess);
}

function setApiKeyExpanded(isExpanded) {
  apiKeyToggle.setAttribute("aria-expanded", String(isExpanded));
  apiKeyDetails.hidden = !isExpanded;
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
      ? "연결 전"
      : status.unlocked
        ? "연결됨"
        : "잠김";
    apiKeyStatus.dataset.state = !status.configured
      ? "empty"
      : status.unlocked
        ? "ready"
        : "locked";
    unlockApiKeyButton.hidden = !status.configured || status.unlocked;
    deleteApiKeyButton.hidden = !status.configured;
    saveApiKeyButton.textContent = status.configured
      ? "새 키 검증 후 다시 저장"
      : "검증 후 암호화 저장";
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
    throw new Error(data.message || "요청에 실패했습니다.");
  }

  return data;
}

openLoginButton.addEventListener("click", async () => {
  openLoginButton.disabled = true;
  loginMessage.textContent = "";

  try {
    // TODO : 로그인
    await sendBackgroundMessage("OPEN_DASHBOARD");
    window.close();
  } catch (error) {
    loginMessage.textContent = error.message;
    openLoginButton.disabled = false;
  }
});

apiKeyToggle.addEventListener("click", () => {
  const isExpanded = apiKeyToggle.getAttribute("aria-expanded") === "true";
  setApiKeyExpanded(!isExpanded);
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
  saveApiKeyButton.textContent = "권한을 검증하고 있어요...";

  try {
    await sendBackgroundMessage("SAVE_UPBIT_CREDENTIALS", {
      accessKey,
      secretKey,
      passphrase,
    });
    apiKeyForm.reset();
    setApiKeyMessage(
      "API 키와 필수 권한을 확인하고 암호화해 저장했습니다.",
      true,
    );
    await refreshCredentialStatus();
  } catch (error) {
    setApiKeyMessage(error.message);
  } finally {
    saveApiKeyButton.disabled = false;
    await refreshCredentialStatus();
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
    showSignedOut();
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
  showSignedOut();
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.auth) {
    initialize();
  }
});

setApiKeyExpanded(false);
initialize();
