import type { TradeFeedbackDTO } from "@/backend/modules/logs/types";
import styles from "../dashboard.module.css";

type FeedbackTone = "planned" | "emotional" | "dismissed";

export function getFeedbackPresentation(feedback: TradeFeedbackDTO): {
  tone: FeedbackTone;
  label: string;
  description: string;
} {
  if (
    feedback.feedbackStatus === "ANSWERED" &&
    feedback.selfAssessment === "PLANNED"
  ) {
      return {
      tone: "planned",
      label: "원칙을 지킨 거래였어요",
      description: "사용자가 이번 거래를 정한 원칙에 맞는 거래로 기록했어요.",
    };
  }

  if (
    feedback.feedbackStatus === "ANSWERED" &&
    feedback.selfAssessment === "EMOTIONAL"
  ) {
      return {
      tone: "emotional",
      label: "후회했던 거래였어요",
      description: "사용자가 이번 거래를 다시 돌아보고 싶은 거래로 기록했어요.",
    };
  }

  return {
    tone: "dismissed",
    label: "피드백을 건너뛰었어요",
    description: "사용자가 거래 후 피드백 응답을 건너뛰었어요.",
  };
}

export default function FeedbackStatusIcon({ tone }: { tone: FeedbackTone }) {
  return (
    <span
      className={`${styles.feedbackStatusIcon} ${styles[`feedbackStatusIcon${tone}`]}`}
      aria-hidden="true"
    >
      {tone === "planned" ? (
        <svg viewBox="0 0 24 24">
          <path d="M5 12.5 9.5 17 19 7" />
        </svg>
      ) : tone === "emotional" ? (
        <svg viewBox="0 0 24 24">
          <path d="M7 7 17 17" />
          <path d="M17 7 7 17" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24">
          <path d="M6 12h12" />
        </svg>
      )}
    </span>
  );
}
