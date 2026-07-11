"use client";

import type { GuardrailTimelineItem } from "@/backend/modules/logs/types";
import FeedbackTimelineRow from "./FeedbackTimelineRow";
import WarningTimelineRow from "./WarningTimelineRow";

type WarningItem = Extract<GuardrailTimelineItem, { type: "WARNING" }>;

export default function GuardrailTimelineRow({
  item,
  onOpenWarning,
}: {
  item: GuardrailTimelineItem;
  onOpenWarning: (item: WarningItem, button: HTMLButtonElement) => void;
}) {
  if (item.type === "WARNING") {
    return <WarningTimelineRow item={item} onOpen={onOpenWarning} />;
  }

  return <FeedbackTimelineRow item={item} />;
}
