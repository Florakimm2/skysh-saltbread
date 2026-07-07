"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./dashboard.module.css";

export default function LogoutButton() {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [message, setMessage] = useState("");

  async function handleLogout() {
    setIsPending(true);
    setMessage("");

    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
      });

      if (!response.ok) {
        throw new Error("로그아웃 요청을 처리하지 못했어요.");
      }

      router.replace("/login");
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "로그아웃 중 오류가 발생했어요.",
      );
      setIsPending(false);
    }
  }

  return (
    <div className={styles.logoutWrap}>
      <button
        className={styles.logoutButton}
        type="button"
        onClick={handleLogout}
        disabled={isPending}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M10 5H6.5A2.5 2.5 0 0 0 4 7.5v9A2.5 2.5 0 0 0 6.5 19H10m4-3 4-4-4-4m4 4H9" />
        </svg>
        <span>{isPending ? "로그아웃 중…" : "로그아웃"}</span>
      </button>
      <p className={styles.logoutMessage} role="status" aria-live="polite">
        {message}
      </p>
    </div>
  );
}
