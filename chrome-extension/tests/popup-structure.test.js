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

test("통계 기본값과 TODO 주석을 두 개씩 유지한다", () => {
  assert.equal((popupScript.match(/TODO : \(통계 API\)/g) || []).length, 2);
  assert.equal((popupScript.match(/const \w+Count = 0;/g) || []).length, 2);
  assert.match(popupScript, /개의 기록을 쌓고/);
  assert.match(popupScript, /개의 감정 매도를 막았어요!/);
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
});

test("온보딩 미완료 계정에는 온보딩 CTA를 제공한다", () => {
  assert.match(popupHtml, /id="open-onboarding-button"/);
  assert.match(popupScript, /개인정보 동의와 온보딩을 완료해 주세요/);
  assert.match(popupScript, /OPEN_ONBOARDING/);
});
