# Fireguard

> 감정적인 매매 신호를 주문 전에 발견하고, 한 번 더 생각할 시간을 만드는 투자 안전 보조 도구

Fireguard는 Upbit 거래 화면의 사용자 행동과 실시간 시장 데이터를 함께 분석해
감정 매매 가능성을 알려주는 Chrome Extension 및 웹 대시보드입니다. 확장 프로그램은
주문 직전의 입력·클릭 패턴을 감지하고, 웹 대시보드는 누적된 경향과 AI 인사이트를
제공합니다.

Fireguard는 주문을 대신 실행하거나 투자 판단을 내리는 서비스가 아닙니다. 감지 결과는
사용자의 의사결정을 돕기 위한 참고 정보이며 수익 또는 손실 방지를 보장하지 않습니다.

## 주요 기능

- **실시간 감정 매매 감지**: 급등 추격 매수, 손실 직후 복구 매매, 반복 수정·취소,
  최대 금액 충동 매수, 평소보다 큰 주문, 단시간 연속 매수, 고위험 종목 이동을
  규칙 기반으로 분석합니다.
- **Upbit 거래 화면 연동**: 종목 체류 시간, 주문 입력 변경, 매수·매도 클릭과
  실시간 시세를 조합해 주문 맥락을 구성합니다.
- **즉각적인 시각 피드백**: 감지 결과와 주문 방향에 따라 거래 화면의 Fireguard
  패널과 불꽃 상태가 바뀝니다.
- **로그인 및 세션 관리**: Firebase Authentication과 HttpOnly Refresh Token
  쿠키를 사용해 웹 대시보드와 확장 프로그램 세션을 관리합니다.
- **투자 경향 대시보드**: Firestore에 저장된 행동 및 위험 분석 기록을 시간순으로
  보여주고, 최근 7일 기록을 바탕으로 AI 인사이트를 생성합니다.
- **안전한 API 키 보관**: Upbit 키를 PBKDF2와 AES-GCM으로 암호화해 브라우저에
  저장하며, 복호화 키는 현재 브라우저 세션에서만 유지합니다.
- **시나리오 테스트 터미널**: 실제 주문 없이 7가지 감정 매매 시나리오와 감지 결과를
  웹에서 재현할 수 있습니다.

## 시스템 구성

```mermaid
flowchart LR
    U["Upbit 거래 화면"] --> CS["Chrome Content Script"]
    CS --> BG["Background Service Worker"]
    BG --> UA["Upbit Open API<br/>시세·조회 전용 계정 정보"]
    BG --> ED["Next.js /api/ext/detect"]
    ED --> RE["감정 매매 규칙 엔진"]

    W["Fireguard 대시보드"] --> NX["Next.js App Router"]
    NX --> FA["Firebase Authentication"]
    NX --> FS["Cloud Firestore<br/>행동·위험 분석 기록"]
    NX --> AI["FastAPI 인사이트 서비스"]
```

확장 프로그램은 주문을 실행하지 않습니다. Upbit 개인 API는 체결·미체결 주문과
계좌 정보를 조회해 감지 정확도를 높이는 용도로만 사용합니다.

## 기술 스택

| 영역 | 기술 |
| --- | --- |
| Web | Next.js 16, React 19, TypeScript |
| API | Next.js Route Handlers, Zod |
| 인증·데이터 | Firebase Authentication, Cloud Firestore |
| Extension | Chrome Extension Manifest V3, Web Crypto API |
| 외부 데이터 | Upbit Open API |
| AI | 외부 FastAPI 인사이트 서비스 |
| 품질 관리 | ESLint, Node.js Test Runner |

## 시작하기

### 요구 사항

- Node.js 20.9 이상
- npm
- Firebase 프로젝트 및 서비스 계정
- Chrome 또는 Chromium 기반 브라우저
- AI 인사이트를 사용할 경우 FastAPI 서비스 엔드포인트

### 1. 저장소 설치

```bash
git clone https://github.com/Florakimm2/skysh-saltbread.git
cd skysh-saltbread
npm ci
```

### 2. 환경 변수 설정

저장소 루트에 `.env.local`을 만들고 다음 값을 설정합니다.

```dotenv
# 웹 앱 origin: 경로 없이 프로토콜, 호스트, 포트만 입력합니다.
APP_URL=http://localhost:3000

# Firebase Web API
NEXT_PUBLIC_FIREBASE_API_KEY=your_firebase_web_api_key

# Firebase Admin SDK 서비스 계정
FIREBASE_PROJECT_ID=your_firebase_project_id
FIREBASE_CLIENT_EMAIL=your_service_account_email
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

# 최근 투자 경향을 요약하는 FastAPI POST 엔드포인트
FASTAPI_INSIGHT_URL=https://your-insight-api.example.com/analyze
```

| 변수 | 필수 여부 | 용도 |
| --- | --- | --- |
| `APP_URL` | 확장 프로그램 사용 시 필수 | 확장 프로그램이 호출할 웹 앱 및 API origin |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | 필수 | Firebase 이메일·비밀번호 인증 |
| `FIREBASE_PROJECT_ID` | 필수 | Firebase Admin 프로젝트 식별 |
| `FIREBASE_CLIENT_EMAIL` | 필수 | Firebase 서비스 계정 인증 |
| `FIREBASE_PRIVATE_KEY` | 필수 | Firebase Admin 비공개 키 |
| `FASTAPI_INSIGHT_URL` | AI 기능 사용 시 필수 | AI 인사이트 요청 대상 |

민감한 환경 변수는 커밋하지 마세요. 이 저장소는 `.env*`를 무시하고
`.env.example`만 추적합니다.

Firebase Authentication에서 이메일/비밀번호 로그인을 활성화하고 Cloud Firestore를
준비해야 합니다. 애플리케이션은 `users`, `behaviorEvents`, `riskAnalyses` 컬렉션을
사용합니다.

### 3. 개발 서버 실행

```bash
npm run dev
```

- 테스트 터미널: [http://localhost:3000](http://localhost:3000)
- 대시보드: [http://localhost:3000/dashboard](http://localhost:3000/dashboard)

## Chrome Extension 설치

확장 프로그램 설정은 웹 앱 설정과 자동으로 동기화되지 않습니다. `.env.local`의
`APP_URL`을 확인한 다음 수동으로 생성 명령을 실행합니다.

```bash
npm run configure:extension
```

이 명령은 `chrome-extension/manifest.template.json`을 바탕으로 다음 파일을
생성합니다.

- `chrome-extension/config.js`
- `chrome-extension/manifest.json`

두 생성 파일은 직접 수정하지 마세요. URL을 바꾼 경우 명령을 다시 실행해야 합니다.

Chrome에 설치하는 방법은 다음과 같습니다.

1. 주소창에서 `chrome://extensions`를 엽니다.
2. **개발자 모드**를 활성화합니다.
3. **압축해제된 확장 프로그램을 로드합니다**를 선택합니다.
4. 저장소의 `chrome-extension` 디렉터리를 지정합니다.
5. 설정을 다시 생성한 경우 확장 프로그램 카드에서 **새로고침**을 누릅니다.

Upbit API 키 연동과 브라우저 저장 방식은
[확장 프로그램 문서](chrome-extension/README.md)를 참고하세요.

## 주요 화면 및 API

### 화면

| 경로 | 설명 |
| --- | --- |
| `/` | Upbit 스타일의 시세 화면과 감정 매매 시나리오 테스트 터미널 |
| `/dashboard` | 최근 AI 인사이트와 감지 경향 요약 |
| `/dashboard/trends` | 전체 감지 경향 기록 |
| `/dashboard/ai-insights` | 최근 7일 기록 기반 AI 분석 |

### API

| 경로 | 메서드 | 설명 |
| --- | --- | --- |
| `/api/auth/signup` | `POST` | Firebase 회원가입 및 사용자 프로필 생성 |
| `/api/auth/login` | `POST` | 로그인 및 Access/Refresh Token 발급 |
| `/api/auth/refresh` | `POST` | HttpOnly 쿠키로 Access Token 갱신 |
| `/api/auth/logout` | `POST` | 세션 폐기 및 쿠키 제거 |
| `/api/ext/detect` | `POST` | 인증된 확장 프로그램의 감정 매매 판정 |
| `/api/behavior/events` | `GET`, `POST` | 행동 이벤트 조회 및 저장 |
| `/api/behavior/analyze` | `POST` | 최근 행동과 시장 데이터 기반 위험 분석 |
| `/api/market/snapshot` | `GET` | 종목별 시장 스냅샷 조회 |
| `/api/upbit` | `GET` | 테스트 터미널용 Upbit 시세·캔들·호가 조회 |
| `/api/insights` | `POST` | 외부 FastAPI를 통한 인사이트 생성 |

확장 프로그램이 `/api/ext/detect`로 감지 요청을 보낼 때는 같은 주문
스냅샷을 `ORDER_SUBMIT_ATTEMPT` 이벤트로 `/api/behavior/events`에도 저장합니다.

## 프로젝트 구조

```text
.
├── app/                    # Next.js 화면과 Route Handlers
├── backend/
│   ├── common/             # 쿠키, HTTP, 오류 및 응답 공통 코드
│   ├── infrastructure/     # Firebase 연결
│   └── modules/            # 인증, 행동 분석, 감지, 시장, 인사이트 도메인
├── chrome-extension/       # Manifest V3 확장 프로그램
├── frontend/               # 인증 및 대시보드 UI 컴포넌트
├── scripts/                # 확장 프로그램 설정 생성 스크립트
└── tests/                  # 감지 엔진과 확장 프로그램 단위 테스트
```

## 명령어

| 명령어 | 설명 |
| --- | --- |
| `npm run dev` | 개발 서버 실행 |
| `npm run build` | 프로덕션 빌드 생성 |
| `npm run start` | 프로덕션 서버 실행 |
| `npm run lint` | ESLint 검사 |
| `npm run test:extension` | 감지 규칙과 확장 프로그램 테스트 |
| `npm run configure:extension` | 현재 `APP_URL`로 확장 프로그램 설정 생성 |

`dev`와 `build`는 확장 프로그램 설정을 자동 생성하지 않습니다.

## 검증

변경 사항을 제출하기 전에 다음 명령을 실행합니다.

```bash
npm run lint
npm run test:extension
npm run build
```

## 배포 시 확인 사항

1. 배포 환경에 Firebase와 FastAPI 환경 변수를 등록합니다.
2. `APP_URL`을 실제 HTTPS 배포 origin으로 설정합니다.
3. 배포용 확장 프로그램을 만들기 전에 `npm run configure:extension`을 실행합니다.
4. 생성된 `manifest.json`의 host permission이 배포 origin을 가리키는지 확인합니다.
5. Upbit API Key에는 **주문 조회와 자산 조회에 필요한 최소 권한만** 부여합니다.
   주문 실행 및 출금 권한은 부여하지 마세요.

## 현재 보안 범위

- Upbit 자격 증명의 암호화 비밀번호는 저장하지 않으며, 브라우저를 다시 시작하면
  다시 잠금을 해제해야 합니다.
- 로컬 암호화는 브라우저 프로필이나 기기 자체가 침해된 상황까지 보호하지 못합니다.
- `/api/ext/detect`는 Firebase Access Token을 검증합니다.
- 행동 수집 API의 `X-User-Id` 및 `demo-user` fallback과 전체 허용 CORS는 MVP 개발용
  구현입니다. 외부 공개 배포 전에는 인증 토큰 기반 사용자 식별과 명시적인 origin
  허용 목록으로 교체해야 합니다.
