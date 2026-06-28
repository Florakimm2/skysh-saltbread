# Fireguard Chrome Extension

Manifest V3 기반의 로그인/회원가입 및 감정 매매 감지 확장 프로그램입니다.

로그인 전에 투자 성향 분석에 사용하는 행동 데이터 수집 동의를 받습니다.
동의 내용은 브라우저의 로컬 저장소에 보관되며, 동의하지 않으면 팝업이
닫힙니다.

## Chrome에서 실행

1. 저장소 루트의 `.env.local`에 앱 origin을 설정합니다.
   `APP_URL=https://skysh-saltbread.vercel.app`
2. `npm run configure:extension`을 실행합니다.
3. Chrome에서 `chrome://extensions`를 열고 **개발자 모드**를 켭니다.
4. **압축해제된 확장 프로그램을 로드합니다**를 누릅니다.
5. `chrome-extension` 폴더를 선택합니다.

`config.js`와 `manifest.json`은 `APP_URL`에서 생성되므로 직접 수정하지 않습니다.
설정을 바꾼 뒤에는 동기화 명령을 실행하고 Chrome에서 확장 프로그램을 다시
로드합니다.

## Upbit 거래 화면

로그인 상태에서 `https://upbit.com/exchange` 또는
`https://www.upbit.com/exchange` 거래 화면을 열면 오른쪽 위에 고정 패널이
표시됩니다.

패널은 오른쪽 위 버튼으로 접고 펼칠 수 있습니다. 로그인 상태에서 현재 탭의
최대 금액 선택, 최근 1분 매수 클릭, 최근 3분 입력 수정, 최근 평균 매수 금액,
종목별 체류 시간을 집계해 실시간으로 표시합니다.

확장 프로그램의 background service worker는 Chrome Alarm을 사용하여 매 1분마다
현재 종목의 Upbit 공개 시장 데이터를 갱신하고 `/api/ext/detect`를 호출합니다.
감정 매매가 감지되면 백엔드가 반환한 문구를 패널 상단 상태 영역에 표시합니다.
감지된 주문이 매수면 분홍 불꽃, 매도면 파란 불꽃으로 바뀌며 감지되지 않으면
빨간 불꽃으로 돌아옵니다. 같은 색상 테마가 팝업과 거래 화면 패널에 동기화됩니다.
브라우저 Origin이 포함된 Upbit 공개 API의 10초당 1회 제한을 지키기 위해 공개
요청을 10.1초 이상 간격으로 직렬화하며, 종목 경고 목록은 10분간 캐시합니다.

## Upbit API 키

로그인 후 팝업의 **Upbit 연동** 영역에서 Access Key, Secret Key, 로컬 암호화
비밀번호를 입력합니다.

- 키는 PBKDF2로 만든 키를 이용해 AES-GCM으로 암호화한 뒤
  `chrome.storage.local`에 저장합니다.
- 로컬 암호화 비밀번호는 저장하지 않습니다.
- 복호화 키는 현재 브라우저 세션의 `chrome.storage.session`에만 보관합니다.
- 로그아웃하거나 브라우저를 다시 시작하면 다시 잠금을 해제해야 합니다.
- 주문 버튼이 감지되었을 때 Upbit의 기본 최신 종료 주문과 현재 종목의
  미체결 주문을 조회합니다. 주문·자산 조회가 실패하면 안전한 결과로 숨기지
  않고 오류를 표시합니다.
- Upbit API Key에는 **주문 조회와 자산 조회에 필요한 최소 권한만** 부여하고,
  주문 실행 및 출금 권한은 부여하지 마세요.
- Upbit Open API 관리 화면에 현재 네트워크의 공인 IP를 등록해야 합니다.

브라우저 프로필이나 실행 중인 기기가 침해된 경우 로컬 암호화만으로 키를 완전히
보호할 수 없습니다. 공용 PC에서는 API 키를 저장하지 마세요.

**내 과거 기록 보기** 버튼은 `APP_URL` 아래의 `/dashboard`를 새 탭으로
엽니다. `/dashboard`와 그 하위 페이지에서는 확장 프로그램 패널을 표시하지
않습니다.

쿠키 기반 refresh token을 주고받을 수 있도록 인증 요청에
`credentials: "include"`를 사용합니다.

## 테스트

저장소 루트에서 다음 명령을 실행합니다.

```bash
npm run test:extension
npm run lint
```

DOM 이벤트를 확인하는 개발용 하네스는 저장소 루트에서 정적 서버를 실행한 뒤
`/tests/extension-harness.html?market=KRW-BTC`로 열 수 있습니다.
