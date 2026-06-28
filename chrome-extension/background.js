importScripts("config.js");

const DASHBOARD_URL = globalThis.SALTBREAD_CONFIG.dashboardUrl;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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
