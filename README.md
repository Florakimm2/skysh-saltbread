<p align="center">
  <img src="img/img0.png" alt="bulssi logo" width="128" />
</p>

<h1 align="center">불씨</h1>

<p align="center">
  투자에 <strong>규칙</strong>을 정하다<br/>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-16-000000?style=flat-square&logo=nextdotjs&logoColor=white" alt="Next.js" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/FastAPI-009688?style=flat-square&logo=fastapi&logoColor=white" alt="FastAPI" />
  <img src="https://img.shields.io/badge/Firebase-FFCA28?style=flat-square&logo=firebase&logoColor=black" alt="Firebase" />
  <img src="https://img.shields.io/badge/Chrome_Extension-MV3-4285F4?style=flat-square&logo=googlechrome&logoColor=white" alt="Chrome Extension Manifest V3" />
</p>

<p align="center">
  <img src="https://img.shields.io/github/last-commit/Florakimm2/skysh-saltbread?style=flat-square" alt="Last Commit" />
  <img src="https://img.shields.io/github/contributors/Florakimm2/skysh-saltbread?style=flat-square" alt="Contributors" />
  <img src="https://img.shields.io/github/issues/Florakimm2/skysh-saltbread?style=flat-square" alt="Issues" />
</p>

---

<p align="center">
  <img src="img/img1.png" alt="bulssi1" width="640" />
</p>

사용자가 설정한 투자 원칙과 실제 주문이 어긋나는 순간을 감지하고, 주문 직전에 한 번 더 확인할 수 있도록 돕는 개인 투자 가드레일 서비스입니다.
Chrome Extension은 Upbit 거래 화면에서 주문 흐름과 가드레일 충족 여부를 확인하고, 웹 대시보드는 누적된 가드레일 기록과 원칙 준수 결과, AI 인사이트를 보여줍니다.

> 불씨는 주문을 대신 실행하거나 투자 수익을 보장하지 않아요. 감지 결과는 투자 판단을 돕기 위한 참고 정보입니다.

---

## 주요 기능

<p align="center">
  <img src="img/img2.jpg" alt="bulssi2" width="640" />
</p>

- Upbit 거래 화면에서 주문 입력, 클릭, 종목 이동 등 행동 흐름 감지
- 급등 추격 매수, 반복 주문, 손실 직후 재진입 등 후회했던 거래를 줄이기 위한 개인 가드레일 적용
- Chrome Extension 패널을 통한 실시간 경고 및 피드백 표시
- 웹 대시보드에서 감지 기록, 가드레일 반응, 투자 경향 확인
- FastAPI 기반 AI 서버를 통한 주문 시도 기록 요약 및 투자 원칙 개선 인사이트 생성

## 프로젝트 구조

```text
.
├── app/                    # Next.js App Router 화면과 API Route
├── frontend/               # 로그인, 온보딩, 대시보드 UI 컴포넌트
├── backend/                # 인증, 행동 분석, 가드레일, 로그, 인사이트 도메인 로직
├── chrome-extension/       # Chrome Extension Manifest V3 소스
├── ai_server/              # AI 인사이트 생성을 담당하는 FastAPI 서버
├── scripts/                # 확장 프로그램 설정 생성 스크립트
└── tests/                  # 확장 프로그램 및 감지 로직 테스트
```

## 기술 스택

| 영역 | 사용 기술 |
| --- | --- |
| Web | Next.js 16, React 19, TypeScript |
| Backend | Next.js Route Handler, Firebase Admin, Zod |
| Extension | Chrome Extension Manifest V3 |
| Data/Auth | Firebase Authentication, Cloud Firestore |
| AI Server | FastAPI, OpenAI API |
| Test | Node.js Test Runner, ESLint |

## 실행 과정

### 1. 패키지 설치

```bash
npm ci
```

### 2. AI 서버 환경 준비

`npm run dev`는 Next.js 서버와 FastAPI 서버를 함께 실행합니다.  
처음 실행하기 전 `ai_server/venv`를 만들어야 합니다.

```bash
cd ai_server
python3 -m venv venv
./venv/bin/python -m pip install --upgrade pip
./venv/bin/python -m pip install -r requirements.txt
cd ..
```

### 3. 환경 변수 설정

루트에 `.env.local`을 만들고 필요한 값을 설정합니다.

```dotenv
APP_URL=http://localhost:3000

NEXT_PUBLIC_FIREBASE_API_KEY=your_firebase_web_api_key
FIREBASE_PROJECT_ID=your_firebase_project_id
FIREBASE_CLIENT_EMAIL=your_service_account_email
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

FASTAPI_INSIGHT_URL=http://localhost:8000/api/v1/insights/analyze
FASTAPI_INSIGHT_API_KEY=your_service_api_key

OPENAI_API_KEY=your_openai_api_key
SERVICE_API_KEY=your_service_api_key
```

### 4. 개발 서버 실행

```bash
npm run dev
```

- Web: <http://localhost:3000>
- Dashboard: <http://localhost:3000/dashboard>
- AI Server Docs: <http://localhost:8000/docs>

### 5. Chrome Extension 연결

```bash
npm run configure:extension
```

이 명령은 `.env.local`의 `APP_URL`을 기준으로 `chrome-extension/config.js`와 `chrome-extension/manifest.json`을 생성합니다.

Chrome에서 `chrome://extensions`를 열고 개발자 모드를 켠 뒤, `chrome-extension` 폴더를 압축해제된 확장 프로그램으로 로드합니다.

## 주요 명령어

| 명령어 | 설명 |
| --- | --- |
| `npm run dev` | Next.js와 FastAPI 개발 서버 동시 실행 |
| `npm run dev:frontend` | Next.js 개발 서버만 실행 |
| `npm run dev:ai_server` | FastAPI 서버만 실행 |
| `npm run configure:extension` | 확장 프로그램 설정 파일 생성 |
| `npm run lint` | ESLint 검사 |
| `npm run test:extension` | 확장 프로그램 및 감지 로직 테스트 |
| `npm run build` | Next.js 프로덕션 빌드 |

## 참여 인원

| 박정근 | 김민경 | 이가연 |
| --- | --- | --- |
| [<img src="https://avatars.githubusercontent.com/r3j0" width="160px;">](https://github.com/r3j0) | [<img src="https://avatars.githubusercontent.com/Florakimm2" width="160px;">](https://github.com/Florakimm2) | [<img src="https://avatars.githubusercontent.com/gayeon0263" width="160px;">](https://github.com/gayeon0263) |
| (팀장) 프론트엔드, UI/UX | 백엔드, DB, 배포 | AI & 데이터 분석 |