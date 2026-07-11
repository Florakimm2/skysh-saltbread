import type { VisualMode } from "@/backend/modules/guardrail/types";

export const WARNING_COLOR_BY_VISUAL_MODE: Record<VisualMode, string> = {
  CURIOUS: "Green",
  SURPRISED: "Amber",
  FAST_BURN: "Pink",
  SCARED: "Purple",
  SAD: "Blue",
};

export function getWarningToneClassName(
  visualMode: VisualMode | undefined,
  styles: Record<string, string>,
) {
  const suffix = visualMode ? WARNING_COLOR_BY_VISUAL_MODE[visualMode] : null;
  return styles[`warningTone${suffix ?? "Default"}`] || styles.warningToneDefault;
}
