"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  getSafeNextPath,
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

export default function LoginPage({
  nextPath,
  extensionId,
}: {
  nextPath?: string;
  extensionId?: string;
}) {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setIsSubmitting(true);

    const formData = new FormData(event.currentTarget);

    try {
      const result = await requestAuth("/api/auth/login", {
        email: String(formData.get("email") ?? "").trim(),
        password: String(formData.get("password") ?? ""),
      });

      rememberActiveUser(result.user);
      const safeNextPath = getSafeNextPath(nextPath);
      if (extensionId) {
        const params = new URLSearchParams({
          extensionId,
          next: safeNextPath,
        });
        router.replace(`/extension/connect?${params.toString()}`);
      } else {
        router.replace(safeNextPath);
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "로그인 중 알 수 없는 오류가 발생했습니다.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className={styles.authPage}>
      <div className={styles.authCard}>
        <header className={styles.header}>
          <Brand />
        </header>

        <div className={styles.authGrid}>
          <AuthArtwork>
            <p className={styles.kicker}>규칙적인 투자를 지켜나가기</p>
            <h1>
              <em>이메일로</em> 로그인
            </h1>
            <p>
              직접 정한 원칙을 주문 순간에 확인하고,
              <br />
              거래 기록을 불씨와 함께 돌아보세요.
            </p>
          </AuthArtwork>

          <section className={styles.formPanel} aria-labelledby="login-title">
            <div className={styles.mobileHeading}>
              <p>다시 만나서 반가워요</p>
              <h1 id="login-title">로그인</h1>
            </div>

            <form className={styles.form} onSubmit={handleSubmit} noValidate>
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
                <span>비밀번호</span>
                <span className={styles.inputWrap}>
                  <LockIcon />
                  <input
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="비밀번호를 입력해 주세요"
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
                    로그인하고 있어요
                  </>
                ) : (
                  <>
                    로그인
                    <ArrowIcon />
                  </>
                )}
              </button>
            </form>

            <div className={styles.divider}>
              <span>또는</span>
            </div>
            <p className={styles.switchPrompt}>
              계정이 없으신가요?
              <Link
                href={
                  extensionId
                    ? `/signup?extensionId=${encodeURIComponent(extensionId)}`
                    : "/signup"
                }
              >
                회원가입
              </Link>
            </p>
          </section>
        </div>

        <TrustFooter />
      </div>
    </main>
  );
}
