"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import FlameMascot from "./flame-mascot";
import { ArrowIcon, Brand, ShieldIcon } from "./auth-visuals";
import styles from "./auth-pages.module.css";

type HandoffResponse = {
  ok?: boolean;
  error?: string;
};

type ChromeRuntime = {
  lastError?: { message?: string };
  sendMessage: (
    extensionId: string,
    message: {
      type: "AUTH_HANDOFF";
      payload: { appOrigin: string };
    },
    callback: (response?: HandoffResponse) => void,
  ) => void;
};

function getChromeRuntime() {
  return (
    globalThis as typeof globalThis & {
      chrome?: { runtime?: ChromeRuntime };
    }
  ).chrome?.runtime;
}

export default function ExtensionConnectPage({
  extensionId,
  nextPath,
}: {
  extensionId: string;
  nextPath: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<"connecting" | "success" | "error">(
    "connecting",
  );
  const [message, setMessage] = useState(
    "로그인 정보를 확장 프로그램에 안전하게 전달하고 있어요.",
  );
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const runtime = getChromeRuntime();
    if (!runtime?.sendMessage) {
      queueMicrotask(() => {
        setStatus("error");
        setMessage(
          "불씨 확장 프로그램을 찾지 못했어요. 확장 프로그램이 설치되고 활성화되어 있는지 확인해 주세요.",
        );
      });
      return;
    }

    runtime.sendMessage(
      extensionId,
      {
        type: "AUTH_HANDOFF",
        payload: { appOrigin: window.location.origin },
      },
      (response) => {
        const runtimeError = getChromeRuntime()?.lastError?.message;
        if (runtimeError || !response?.ok) {
          setStatus("error");
          setMessage(
            response?.error ||
              runtimeError ||
              "확장 프로그램 연결에 실패했어요. 잠시 후 다시 시도해 주세요.",
          );
          return;
        }

        setStatus("success");
        setMessage("확장 프로그램 연결이 완료됐어요. 다음 화면으로 이동할게요.");
        window.setTimeout(() => router.replace(nextPath), 700);
      },
    );
  }, [attempt, extensionId, nextPath, router]);

  function retryConnection() {
    setStatus("connecting");
    setMessage("로그인 정보를 확장 프로그램에 안전하게 전달하고 있어요.");
    setAttempt((current) => current + 1);
  }

  return (
    <main className={styles.authPage}>
      <div className={`${styles.authCard} ${styles.connectCard}`}>
        <header className={styles.header}>
          <Brand />
        </header>

        <section className={styles.connectPanel} aria-labelledby="connect-title">
          <FlameMascot
            className={styles.connectFlame}
            mode={status === "error" ? "surprised" : "curious"}
            speed={status === "connecting" ? "fast" : "slow"}
            size="clamp(150px, 22vw, 260px)"
          />
          <p className={styles.kicker}>
            {status === "success"
              ? "연결이 완료됐어요"
              : "Chrome 확장 프로그램 연결"}
          </p>
          <h1 id="connect-title">
            {status === "error" ? "연결을 다시 시도해 주세요" : "불씨 계정 연결"}
          </h1>
          <p className={styles.connectMessage} role="status" aria-live="polite">
            {message}
          </p>

          <div className={styles.connectStatus} data-status={status}>
            {status === "connecting" ? (
              <span className={styles.connectSpinner} aria-hidden="true" />
            ) : (
              <ShieldIcon />
            )}
            <span>
              {status === "connecting"
                ? "연결 중"
                : status === "success"
                  ? "안전하게 연결됨"
                  : "연결 확인 필요"}
            </span>
          </div>

          {status === "error" && (
            <button
              className={styles.primaryButton}
              type="button"
              onClick={retryConnection}
            >
              다시 연결하기
              <ArrowIcon />
            </button>
          )}
        </section>
      </div>
    </main>
  );
}
