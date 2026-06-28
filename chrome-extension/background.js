importScripts("config.js");

const API_BASE_URL = globalThis.SALTBREAD_CONFIG.apiBaseUrl;
const DASHBOARD_URL = globalThis.SALTBREAD_CONFIG.dashboardUrl;

async function requestPing() {
  try {
    // 확장 프로그램의 host permission으로 백엔드에 직접 요청합니다.
    const response = await fetch(`${API_BASE_URL}/api/ping`, {
      headers: { Accept: "text/plain" },
    });

    if (!response.ok) {
      return {
        ok: false,
        error: `요청 실패 (${response.status})`,
      };
    }

    return {
      ok: true,
      text: await response.text(),
    };
  } catch {
    return {
      ok: false,
      error: "서버에 연결할 수 없습니다.",
    };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "REQUEST_API_PING") {
    requestPing().then(sendResponse);

    // 비동기 응답이 도착할 때까지 메시지 채널을 유지합니다.
    return true;
  }

  if (message?.type === "OPEN_DASHBOARD") {
    chrome.tabs
      .create({ url: DASHBOARD_URL })
      .then(() => sendResponse({ ok: true }))
      .catch(() =>
        sendResponse({ ok: false, error: "대시보드를 열 수 없습니다." }),
      );

    return true;
  }

  return false;
});
