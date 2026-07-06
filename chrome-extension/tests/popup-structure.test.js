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

test("비로그인 팝업은 아이콘, 서비스명, 로그인 버튼만 제공한다", () => {
  const signedOutView = popupHtml.match(
    /<section id="signed-out-view"[\s\S]*?<\/section>/,
  )?.[0];

  assert.ok(signedOutView);
  assert.match(signedOutView, /icon-128\.png/);
  assert.match(signedOutView, /<h1>Fireguard<\/h1>/);
  assert.match(signedOutView, /로그인 \/ 회원가입/);
  assert.doesNotMatch(popupHtml, /consent-view|login-form|signup-form/);
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

test("사이드바 표시 조건에 행동 데이터 동의를 요구하지 않는다", () => {
  assert.doesNotMatch(contentScript, /behaviorDataConsent|CONSENT_STORAGE_KEY/);
  assert.match(
    contentScript,
    /if \(!isDashboardPage\(\) && isLoggedIn\(auth\)\)/,
  );
});
