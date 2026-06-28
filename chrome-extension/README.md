# Saltbread Chrome Extension

Manifest V3 기반의 로그인/회원가입 팝업입니다.

## Chrome에서 실행

1. API 주소가 다르면 `config.js`의 `apiBaseUrl`과 `manifest.json`의
   `host_permissions`를 수정합니다.
2. Chrome에서 `chrome://extensions`를 열고 **개발자 모드**를 켭니다.
3. **압축해제된 확장 프로그램을 로드합니다**를 누릅니다.
4. `chrome-extension` 폴더를 선택합니다.

## Upbit 거래 화면

로그인 상태에서 `https://upbit.com/exchange` 또는
`https://www.upbit.com/exchange` 거래 화면을 열면 오른쪽 위에 고정 패널이
표시됩니다. **API Ping** 버튼은 `GET /api/ping`을 요청하고 응답 문자열을
버튼 아래에 출력합니다.

패널은 오른쪽 위 버튼으로 접고 펼칠 수 있습니다. 로그인 상태에서 현재 탭의
주문 금액 입력 변경 횟수와 화면이 보인 체류 시간을 메모리에서만 집계해
실시간으로 표시하며, 이 행동 데이터는 외부로 전송하거나 저장하지 않습니다.

**내 과거 기록 보기** 버튼은 `config.js`의 `dashboardUrl`에 설정한 대시보드를
새 탭으로 엽니다. 로컬 대시보드 기본 주소는 `http://localhost:3001`입니다.

쿠키 기반 refresh token을 주고받을 수 있도록 인증 요청에
`credentials: "include"`를 사용합니다.
