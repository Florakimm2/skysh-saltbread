"use client";

import { useEffect, useRef } from "react";

export type FlameMode =
  | "default"
  | "sad"
  | "fastBurn"
  | "surprised"
  | "scared"
  | "curious";

type FlameInstance = {
  destroy: () => void;
  setMode: (mode: FlameMode) => void;
  setSpeed: (speed: "slow" | "normal" | "fast") => void;
};

type FlameMascotProps = {
  className?: string;
  label?: string;
  mode?: FlameMode;
  size?: number | string;
  speed?: "slow" | "normal" | "fast";
};

export default function FlameMascot({
  className,
  label = "웃고 있는 불씨 마스코트",
  mode = "default",
  size = 240,
  speed = "normal",
}: FlameMascotProps) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const instanceRef = useRef<FlameInstance | null>(null);

  useEffect(() => {
    let active = true;

    void import("./flame-animation.js").then(({ createFlameAnimation }) => {
      if (!active || !hostRef.current) return;
      instanceRef.current = createFlameAnimation(hostRef.current, {
        label,
        mode,
        speed,
      }) as FlameInstance;
    });

    return () => {
      active = false;
      instanceRef.current?.destroy();
      instanceRef.current = null;
    };
  }, [label, mode, speed]);

  return (
    <span
      ref={hostRef}
      className={className}
      style={{ width: size, height: size }}
    />
  );
}
