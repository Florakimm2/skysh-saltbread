# 플젝명 미정

> 아래 가이드를 따라 로컬 개발 환경을 세팅해 주세요.

---

## 🛠️ 개발 시작하기 (팀원 공통 필수)

터미널을 열고 아래 명령어를 순서대로 실행해 주세요.

```bash
# 1. 원격 레포지토리 코드 가져오기
git clone [https://github.com/자신의_유저네임/skysh-saltbread.git](https://github.com/자신의_유저네임/skysh-saltbread.git)

# 2. 프로젝트 폴더로 이동
cd skysh-saltbread

# 3. 필요한 라이브러리(의존성) 패키지 설치
npm install

# 4. 로컬 개발 서버 실행
npm run dev
```
실행 후 브라우저에서 http://localhost:3000으로 접속하면 화면이 뜹니다.

---

## 🤙 해커톤 협업 규칙 (Git)

코드가 꼬이는 것을 방지하기 위해 `main` 브랜치에 직접 push하는 것은 금지합니다. 기능 개발 시 아래 순서를 꼭 지켜주세요!

### 1. 새로운 기능 개발할 때 (브랜치 생성)
내 컴퓨터에서 새로운 기능을 만들기 전에, 기준 브랜치(`main`)로부터 새로운 가지(Branch)를 땁니다.
```bash
# 최신 main 코드 상태로 이동
git checkout main
git pull origin main

# 새로운 기능 브랜치 생성 및 이동 (예1: feature/login, feature/dashboard) (예2: mk/기능, gy/기능, jg/기능)
git checkout -b feature/기능이름
```

---

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
