"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./auth.module.css";

type AuthMode = "login" | "signup";

type ApiResponse = {
  message?: string;
};

async function requestAuth(path: string, body: Record<string, string>) {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "same-origin",
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as ApiResponse;

  if (!response.ok) {
    throw new Error(data.message || "요청을 처리하지 못했습니다.");
  }

  return data;
}

function FlameLogo() {
  return (
    <svg
      viewBox="0 0 64 64"
      role="img"
      aria-label="Fireguard 불꽃"
      className={styles.flameLogo}
    >
      <path
        d="M33.2 4.5c2.6 10.8-8 14.7-8 24.7 0 3.8 2.2 6.1 5.2 7.3-1.2-5.2 1.6-8.7 5.4-12.5 1.2 6.7 8.5 10.1 8.5 20.1 0 9-6.2 15.4-15 15.4-9.9 0-17.7-7.1-17.7-17.6 0-15.6 14.8-22 21.6-37.4Z"
        fill="currentColor"
      />
      <path
        d="M32.3 57.5c-5.5 0-9.2-3.5-9.2-8.5 0-4.4 3.1-7.3 6.9-10.9-.1 4.4 2.4 6.3 4.8 8.2 2.1 1.7 3.1 3.2 3.1 5.5 0 3.3-2.2 5.7-5.6 5.7Z"
        fill="#ffb09f"
      />
    </svg>
  );
}

function ShieldCheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3 5.5 5.7v5.4c0 4.3 2.7 8.2 6.5 9.9 3.8-1.7 6.5-5.6 6.5-9.9V5.7L12 3Z" />
      <path d="m8.8 11.9 2.1 2.1 4.5-4.6" />
    </svg>
  );
}

function InsightIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 19V9m7 10V5m7 14v-7" />
      <path d="m3.5 8 6-4 5 5 6-5" />
    </svg>
  );
}

export default function AuthPanel() {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [isSuccess, setIsSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function selectMode(nextMode: AuthMode) {
    setMode(nextMode);
    setMessage("");
    setIsSuccess(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setIsSuccess(false);
    setIsSubmitting(true);

    const form = event.currentTarget;
    const formData = new FormData(form);
    const submittedEmail = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");

    try {
      if (mode === "signup") {
        const data = await requestAuth("/api/auth/signup", {
          name: String(formData.get("name") ?? "").trim(),
          email: submittedEmail,
          password,
        });

        setEmail(submittedEmail);
        setMode("login");
        setMessage(data.message || "회원가입이 완료되었습니다. 로그인해 주세요.");
        setIsSuccess(true);
        return;
      }

      await requestAuth("/api/auth/login", {
        email: submittedEmail,
        password,
      });

      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "요청 중 알 수 없는 오류가 발생했습니다.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className={styles.authPage}>
      <section className={styles.intro} aria-labelledby="auth-intro-title">
        <div className={styles.brand}>
          <span className={styles.brandMark}>
            <FlameLogo />
          </span>
          <span className={styles.brandName}>
            <strong>Fireguard</strong>
            <span>SMART TRADING COMPANION</span>
          </span>
        </div>

        <div className={styles.introCopy}>
          <p className={styles.eyebrow}>TRADE WITH CLARITY</p>
          <h1 id="auth-intro-title">
            감정은 잠시 내려놓고,
            <br />
            판단은 더 선명하게.
          </h1>
          <p>
            나의 투자 행동을 돌아보고, 데이터와 AI 인사이트로
            <br className={styles.desktopBreak} /> 더 단단한 투자 습관을
            만들어 보세요.
          </p>
        </div>

        <div className={styles.benefits}>
          <div>
            <span>
              <InsightIcon />
            </span>
            <p>
              <strong>투자 패턴 한눈에</strong>
              <small>흩어진 거래 행동을 이해하기 쉽게 정리해요.</small>
            </p>
          </div>
          <div>
            <span>
              <ShieldCheckIcon />
            </span>
            <p>
              <strong>안전한 계정 보호</strong>
              <small>인증 정보는 안전한 HttpOnly 쿠키로 관리해요.</small>
            </p>
          </div>
        </div>

        <p className={styles.introFooter}>© 2026 Fireguard</p>
      </section>

      <section className={styles.formArea} aria-label="계정 인증">
        <div className={styles.formWrap}>
          <div className={styles.mobileBrand}>
            <span className={styles.mobileMark}>
              <FlameLogo />
            </span>
            <strong>Fireguard</strong>
          </div>

          <div className={styles.formHeading}>
            <p>{mode === "login" ? "WELCOME BACK" : "GET STARTED"}</p>
            <h2>
              {mode === "login"
                ? "다시 만나서 반가워요"
                : "Fireguard를 시작해요"}
            </h2>
            <span>
              {mode === "login"
                ? "대시보드를 확인하려면 로그인해 주세요."
                : "간단한 정보만 입력하면 바로 시작할 수 있어요."}
            </span>
          </div>

          <div className={styles.tabs} role="tablist" aria-label="인증 방식">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "login"}
              className={mode === "login" ? styles.activeTab : undefined}
              onClick={() => selectMode("login")}
            >
              로그인
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "signup"}
              className={mode === "signup" ? styles.activeTab : undefined}
              onClick={() => selectMode("signup")}
            >
              회원가입
            </button>
          </div>

          <form
            key={mode}
            className={styles.authForm}
            onSubmit={handleSubmit}
          >
            {mode === "signup" && (
              <label>
                <span>이름</span>
                <input
                  name="name"
                  type="text"
                  autoComplete="name"
                  placeholder="이름을 입력해 주세요"
                  required
                  autoFocus
                />
              </label>
            )}

            <label>
              <span>이메일</span>
              <input
                name="email"
                type="email"
                autoComplete="email"
                placeholder="user@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                autoFocus={mode === "login"}
              />
            </label>

            <label>
              <span>비밀번호</span>
              <input
                name="password"
                type="password"
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                placeholder={
                  mode === "login"
                    ? "비밀번호를 입력해 주세요"
                    : "8자 이상 입력해 주세요"
                }
                minLength={mode === "signup" ? 8 : undefined}
                required
              />
            </label>

            <p
              className={`${styles.message} ${
                isSuccess ? styles.successMessage : ""
              }`}
              aria-live="polite"
            >
              {message}
            </p>

            <button
              className={styles.submitButton}
              type="submit"
              disabled={isSubmitting}
            >
              {isSubmitting && <span className={styles.spinner} />}
              {isSubmitting
                ? "처리하고 있어요"
                : mode === "login"
                  ? "로그인"
                  : "계정 만들기"}
            </button>
          </form>

          <p className={styles.switchPrompt}>
            {mode === "login"
              ? "아직 Fireguard 계정이 없나요?"
              : "이미 계정이 있나요?"}
            <button
              type="button"
              onClick={() =>
                selectMode(mode === "login" ? "signup" : "login")
              }
            >
              {mode === "login" ? "회원가입" : "로그인"}
            </button>
          </p>

          <p className={styles.securityNote}>
            <ShieldCheckIcon />
            안전하게 보호되는 로그인
          </p>
        </div>
      </section>
    </main>
  );
}
