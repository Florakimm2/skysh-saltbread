"use client";

import { useEffect, useRef } from "react";
import styles from "./dashboard.module.css";

interface FlameAnimation {
  destroy: () => void;
}

interface FlameConstructor {
  new (
    target: HTMLElement,
    options?: { label?: string; mode?: "default" | "blue" | "pink" },
  ): FlameAnimation;
}

declare global {
  interface Window {
    CuteIdleFlame?: FlameConstructor;
  }
}

export default function FlameIcon() {
  const hostRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let animation: FlameAnimation | undefined;
    let disposed = false;

    const mountFlame = async () => {
      // @ts-expect-error 기존 애니메이션은 전역 생성자를 등록하는 브라우저 스크립트입니다.
      await import("../../chrome-extension/cute-idle-flame.js");

      if (!disposed && hostRef.current && window.CuteIdleFlame) {
        animation = new window.CuteIdleFlame(hostRef.current, {
          mode: "default",
          label: "Fireguard 불꽃",
        });
      }
    };

    void mountFlame();

    return () => {
      disposed = true;
      animation?.destroy();
    };
  }, []);

  return <span ref={hostRef} className={styles.flameIcon} aria-hidden="true" />;
}
