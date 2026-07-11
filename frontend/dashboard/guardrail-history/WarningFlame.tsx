"use client";

import { useEffect, useState } from "react";
import FlameMascot, { type FlameMode } from "@/frontend/auth/flame-mascot";
import type { VisualMode } from "@/backend/modules/guardrail/types";
import styles from "../dashboard.module.css";

const FLAME_MODE_BY_VISUAL_MODE: Record<VisualMode, FlameMode> = {
  CURIOUS: "curious",
  SURPRISED: "surprised",
  FAST_BURN: "fastBurn",
  SCARED: "scared",
  SAD: "sad",
};

function StaticFlameIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12.2 21c-4 0-6.7-2.7-6.7-6.3 0-2.9 1.7-4.7 3.4-6.6 1.3-1.4 2.5-2.8 2.8-4.8 2.8 1.7 4.2 3.6 4.1 5.8 1.1-.5 1.9-1.3 2.5-2.3.6 1.4.9 2.8.9 4.1 0 5.8-3.5 10.1-7 10.1Z" />
      <path d="M12 18.6c-1.8 0-3.1-1.2-3.1-2.9 0-1.2.7-2 1.5-2.9.7-.8 1.5-1.7 1.7-3 .9.8 1.5 1.7 1.6 2.8.5-.2 1-.6 1.4-1.1.3.7.5 1.4.5 2.1 0 2.9-1.8 5-3.6 5Z" />
    </svg>
  );
}

export default function WarningFlame({
  visualMode,
  label,
  size = "default",
}: {
  visualMode?: VisualMode;
  label: string;
  size?: "timeline" | "default";
}) {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  if (reducedMotion) {
    return (
      <span
        className={`${styles.warningFlameStatic} ${
          size === "timeline" ? styles.warningFlameTimeline : ""
        }`}
        role="img"
        aria-label={label}
      >
        <StaticFlameIcon />
      </span>
    );
  }

  return (
    <FlameMascot
      className={`${styles.warningFlame} ${
        size === "timeline" ? styles.warningFlameTimeline : ""
      }`}
      label={label}
      mode={visualMode ? FLAME_MODE_BY_VISUAL_MODE[visualMode] : "curious"}
      size="100%"
      speed={visualMode === "FAST_BURN" ? "fast" : "slow"}
    />
  );
}
