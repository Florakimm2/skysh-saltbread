const popupRoot = document.documentElement;
const loadingView = document.querySelector("#loading-view");
const signedOutView = document.querySelector("#signed-out-view");
const accountView = document.querySelector("#account-view");
const openLoginButton = document.querySelector("#open-login-button");
const openSignupButton = document.querySelector("#open-signup-button");
const loginMessage = document.querySelector("#login-message");
const accountGreeting = document.querySelector("#account-greeting");
const openOnboardingButton = document.querySelector("#open-onboarding-button");
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
const STATS_LOADING_TEXT = "불씨 기록을 불러오는 중...";
const STATS_FALLBACK_TEXT = "불씨 기록을 불러오지 못했어요.";
const STATS_AUTH_REQUIRED_TEXT = "로그인하면 불씨 기록을 확인할 수 있어요.";
let authLoadRequestId = 0;
let statsLoadRequestId = 0;

function setPopupView(view) {
  const normalizedView =
    view === "account" || view === "signed-out" ? view : "loading";
  popupRoot.dataset.view = normalizedView;
  loadingView.hidden = normalizedView !== "loading";
  signedOutView.hidden = normalizedView !== "signed-out";
  accountView.hidden = normalizedView !== "account";
}

function setStatisticsSummary(message) {
  statisticsSummary.textContent = message;
}

async function requestUserStats() {
  return chrome.runtime.sendMessage({ type: "GET_USER_STATS" });
}

async function renderStatistics() {
  const requestId = statsLoadRequestId + 1;
  statsLoadRequestId = requestId;
  setStatisticsSummary(STATS_LOADING_TEXT);

  try {
    const response = await requestUserStats();

    if (requestId !== statsLoadRequestId) {
      return;
    }

    if (response?.ok && typeof response.data === "string" && response.data) {
      setStatisticsSummary(response.data);
      return;
    }

    setStatisticsSummary(
      response?.authRequired ? STATS_AUTH_REQUIRED_TEXT : STATS_FALLBACK_TEXT,
    );
  } catch {
    if (requestId === statsLoadRequestId) {
      setStatisticsSummary(STATS_FALLBACK_TEXT);
    }
  }
}

function showAccount(user) {
  const userName = user.name || "불씨 사용자";
  const onboardingReady =
    Boolean(user.personalDataConsentAgreed) &&
    Boolean(user.onboardingCompleted);
  accountGreeting.textContent = onboardingReady
    ? `${userName} 님, 오늘도 좋은 하루에요.`
    : `${userName} 님, 개인정보 동의와 온보딩을 완료해 주세요.`;
  openOnboardingButton.hidden = onboardingReady;
  accountMessage.textContent = "";
  setPopupView("account");
  void renderStatistics();
  refreshCredentialStatus();
}

function showLoading() {
  setPopupView("loading");
}

function showSignedOut() {
  statsLoadRequestId += 1;
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

async function openAuth(mode, button) {
  button.disabled = true;
  loginMessage.textContent = "";

  try {
    await sendBackgroundMessage("OPEN_AUTH", { mode });
    window.close();
  } catch (error) {
    loginMessage.textContent = error.message;
    button.disabled = false;
  }
}

openLoginButton.addEventListener("click", () =>
  openAuth("login", openLoginButton),
);
openSignupButton.addEventListener("click", () =>
  openAuth("signup", openSignupButton),
);
openOnboardingButton.addEventListener("click", async () => {
  openOnboardingButton.disabled = true;
  accountMessage.textContent = "";

  try {
    await sendBackgroundMessage("OPEN_ONBOARDING");
    window.close();
  } catch (error) {
    accountMessage.textContent = error.message;
    openOnboardingButton.disabled = false;
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
    const response = await sendBackgroundMessage("LOGOUT_EVERYWHERE");
    if (response.serverError) {
      accountMessage.textContent =
        "서버 세션은 이미 만료됐지만 이 브라우저의 정보는 모두 정리했어요.";
    }
    showSignedOut();
  } catch (error) {
    accountMessage.textContent = error.message;
  } finally {
    logoutButton.disabled = false;
  }
});

async function initialize() {
  const requestId = authLoadRequestId + 1;
  authLoadRequestId = requestId;
  showLoading();

  try {
    const { auth } = await sendBackgroundMessage("GET_AUTH_STATE");
    if (requestId !== authLoadRequestId) {
      return;
    }

    if (auth?.user) {
      showAccount(auth.user);
      return;
    }
  } catch {
    // 만료된 세션은 background에서 정리하고 비로그인 화면을 표시합니다.
    if (requestId !== authLoadRequestId) {
      return;
    }
  }

  showSignedOut();
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.auth) {
    initialize();
  }
});

setApiKeyExpanded(false);
initialize();
