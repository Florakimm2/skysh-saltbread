"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  rememberActiveUser,
  requestAuth,
} from "./auth-api";
import {
  ArrowIcon,
  AuthArtwork,
  Brand,
  EyeIcon,
  LockIcon,
  MailIcon,
  TrustFooter,
} from "./auth-visuals";
import styles from "./auth-pages.module.css";

export default function SignupPage({ extensionId }: { extensionId?: string }) {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();
    const name = String(formData.get("name") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const confirmation = String(formData.get("confirmation") ?? "");

    if (name.length < 2 || name.length > 20) {
      setMessage("닉네임은 2자 이상 20자 이하로 입력해 주세요.");
      return;
    }

    if (password.length < 8) {
      setMessage("비밀번호는 8자 이상 입력해 주세요.");
      return;
    }

    if (password !== confirmation) {
      setMessage("비밀번호가 서로 일치하지 않습니다.");
      return;
    }

    if (!acceptedTerms) {
      setMessage("이용약관과 개인정보 처리방침에 동의해 주세요.");
      return;
    }

    setIsSubmitting(true);

    try {
      await requestAuth("/api/auth/signup", {
        email,
        name,
        password,
      });
      const loginResult = await requestAuth("/api/auth/login", {
        email,
        password,
      });

      rememberActiveUser(loginResult.user);
      if (extensionId) {
        const params = new URLSearchParams({
          extensionId,
          next: "/onboarding",
        });
        router.replace(`/extension/connect?${params.toString()}`);
      } else {
        router.replace("/onboarding");
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "회원가입 중 알 수 없는 오류가 발생했습니다.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className={styles.authPage}>
      <div className={`${styles.authCard} ${styles.signupCard}`}>
        <header className={styles.header}>
          <Brand />
        </header>

        <div className={styles.authGrid}>
          <AuthArtwork mode="curious">
            <p className={styles.kicker}>투자에 원칙을 더하다</p>
            <h1 id="signup-title">회원가입</h1>
            <p>
              나만의 가드레일을 세우고 거래 기록을 쌓아보세요.
              <br />
              같은 후회를 반복하지 않도록 불씨가 함께 확인할게요.
            </p>
          </AuthArtwork>

          <section className={styles.formPanel} aria-labelledby="signup-title">
            <div className={styles.mobileHeading}>
              <p>불씨와 함께 시작해요</p>
              <h1>회원가입</h1>
            </div>

            <form
              className={`${styles.form} ${styles.signupForm}`}
              onSubmit={handleSubmit}
              noValidate
            >
              <label className={styles.field}>
                <span>이메일</span>
                <span className={styles.inputWrap}>
                  <MailIcon />
                  <input
                    name="email"
                    type="email"
                    autoComplete="email"
                    placeholder="이메일을 입력해 주세요"
                    required
                    autoFocus
                  />
                </span>
              </label>

              <label className={styles.field}>
                <span>닉네임</span>
                <span className={`${styles.inputWrap} ${styles.plainInput}`}>
                  <input
                    name="name"
                    type="text"
                    autoComplete="nickname"
                    placeholder="닉네임을 입력해 주세요 (2~20자)"
                    minLength={2}
                    maxLength={20}
                    required
                  />
                </span>
              </label>

              <label className={styles.field}>
                <span>비밀번호</span>
                <span className={styles.inputWrap}>
                  <LockIcon />
                  <input
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="8자 이상 입력해 주세요"
                    minLength={8}
                    required
                  />
                  <button
                    className={styles.inputAction}
                    type="button"
                    onClick={() => setShowPassword((visible) => !visible)}
                    aria-label={
                      showPassword ? "비밀번호 숨기기" : "비밀번호 보기"
                    }
                    aria-pressed={showPassword}
                  >
                    <EyeIcon closed={showPassword} />
                  </button>
                </span>
              </label>

              <label className={styles.field}>
                <span>비밀번호 확인</span>
                <span className={styles.inputWrap}>
                  <LockIcon />
                  <input
                    name="confirmation"
                    type={showConfirmation ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="비밀번호를 다시 입력해 주세요"
                    minLength={8}
                    required
                  />
                  <button
                    className={styles.inputAction}
                    type="button"
                    onClick={() =>
                      setShowConfirmation((visible) => !visible)
                    }
                    aria-label={
                      showConfirmation ? "비밀번호 숨기기" : "비밀번호 보기"
                    }
                    aria-pressed={showConfirmation}
                  >
                    <EyeIcon closed={showConfirmation} />
                  </button>
                </span>
              </label>

              <label className={styles.terms}>
                <input
                  type="checkbox"
                  checked={acceptedTerms}
                  onChange={(event) => setAcceptedTerms(event.target.checked)}
                />
                <span aria-hidden="true" />
                <span>
                  <b>이용약관</b> 및 <b>개인정보 처리방침</b>에 동의합니다.
                </span>
              </label>

              <p className={styles.formMessage} role="status" aria-live="polite">
                {message}
              </p>

              <button
                className={styles.primaryButton}
                type="submit"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <span className={styles.spinner} />
                    계정을 만들고 있어요
                  </>
                ) : (
                  <>
                    회원가입
                    <ArrowIcon />
                  </>
                )}
              </button>
            </form>

            <div className={styles.divider}>
              <span>또는</span>
            </div>
            <p className={styles.switchPrompt}>
              이미 계정이 있으신가요?
              <Link
                href={
                  extensionId
                    ? `/login?extensionId=${encodeURIComponent(extensionId)}`
                    : "/login"
                }
              >
                로그인
              </Link>
            </p>
          </section>
        </div>

        <TrustFooter />
      </div>
    </main>
  );
}
