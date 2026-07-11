/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const extensionDirectory = path.join(__dirname, "..");
const popupHtml = fs.readFileSync(
  path.join(extensionDirectory, "popup.html"),
  "utf8",
);
const popupScript = fs.readFileSync(
  path.join(extensionDirectory, "popup.js"),
  "utf8",
);
const contentScript = fs.readFileSync(
  path.join(extensionDirectory, "content.js"),
  "utf8",
);

test("팝업은 profile 확인 전 로딩 화면으로 시작한다", () => {
  assert.match(popupHtml, /<html lang="ko" data-view="loading">/);
  assert.match(popupHtml, /id="loading-view"/);
  assert.match(popupHtml, /로그인 상태를 확인하고 있어요/);
  assert.match(popupHtml, /id="signed-out-view" class="signed-out-view" hidden/);
  assert.match(popupScript, /function showLoading\(\)/);
  assert.match(
    popupScript,
    /showLoading\(\);[\s\S]*sendBackgroundMessage\("GET_AUTH_STATE"\)/,
  );
});

test("비로그인 팝업은 불씨 브랜드와 분리된 로그인·회원가입 버튼을 제공한다", () => {
  const signedOutView = popupHtml.match(
    /<section id="signed-out-view"[\s\S]*?<\/section>/,
  )?.[0];

  assert.ok(signedOutView);
  assert.match(signedOutView, /icon-128\.png/);
  assert.match(signedOutView, /<h1>불씨<\/h1>/);
  assert.match(signedOutView, /id="open-login-button"[\s\S]*?>\s*로그인/);
  assert.match(signedOutView, /id="open-signup-button"[\s\S]*?>\s*회원가입/);
  assert.doesNotMatch(popupHtml, /consent-view|login-form|signup-form/);
  assert.doesNotMatch(popupScript, /TODO\s*:\s*로그인/);
});

test("통계 카드는 stats API 메시지와 상태 문구를 사용한다", () => {
  assert.doesNotMatch(popupScript, /TODO : \(통계 API\)/);
  assert.doesNotMatch(popupScript, /const \w+Count = 0;/);
  assert.match(popupScript, /GET_USER_STATS/);
  assert.match(popupScript, /불씨 기록을 불러오는 중/);
  assert.match(popupScript, /불씨 기록을 불러오지 못했어요/);
  assert.match(popupScript, /로그인하면 불씨 기록을 확인할 수 있어요/);
});

test("Upbit 연동 카드는 접근 가능한 접힘 상태로 시작한다", () => {
  assert.match(
    popupHtml,
    /id="api-key-toggle"[\s\S]*?aria-expanded="false"[\s\S]*?aria-controls="api-key-details"/,
  );
  assert.match(
    popupHtml,
    /id="api-key-details" class="integration-card__details" hidden/,
  );
  assert.match(
    popupHtml,
    /id="api-guide-link"[\s\S]*?target="_blank"[\s\S]*?rel="noopener noreferrer"[\s\S]*?연결 가이드 보기/,
  );
  assert.match(popupScript, /const UPBIT_API_GUIDE_URL =/);
  assert.match(popupScript, /apiGuideLink\.addEventListener\("click"/);
  assert.match(popupScript, /apiGuideLink\.addEventListener\("keydown"/);
});

test("사이드바 표시 조건은 거래 화면과 온보딩 완료를 요구한다", () => {
  assert.match(
    contentScript,
    /return isDemoPage\(\) \|\| isUpbitExchangePage\(\);/,
  );
  assert.match(contentScript, /personalDataConsentAgreed/);
  assert.match(contentScript, /onboardingCompleted/);
  assert.match(contentScript, /canShowPanel\(auth\)/);
  assert.doesNotMatch(contentScript, /saltbread-metric-card/);
  assert.match(contentScript, /설정된 가드레일/);
  assert.match(contentScript, /규칙 점검하기/);
  assert.doesNotMatch(contentScript, /내 과거 기록 보기/);
  assert.match(contentScript, /\/dashboard\/my-page/);
});

test("온보딩 미완료 계정에는 온보딩 CTA를 제공한다", () => {
  assert.match(popupHtml, /id="open-onboarding-button"/);
  assert.match(popupScript, /개인정보 동의와 온보딩을 완료해 주세요/);
  assert.match(popupScript, /OPEN_ONBOARDING/);
});
