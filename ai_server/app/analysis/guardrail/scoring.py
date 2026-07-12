from __future__ import annotations


NEW_MIN_SUPPORT = 5
NEW_MIN_REGRETTED_RATE = 0.65
NEW_MIN_LIFT = 1.25
MOD_MIN_SUPPORT = 5
MOD_MIN_PRECISION_GAIN = 0.10
MOD_MIN_PLANNED_FP_REDUCTION = 0.15
MOD_MAX_RECALL_DROP = 0.10


def clamp_confidence(value: float) -> float:
    return max(0.0, min(1.0, round(value, 4)))


def risk_level(regretted_rate: float, support: int) -> str:
    if regretted_rate >= 0.8 and support >= 8:
        return "HIGH"
    if regretted_rate >= 0.65 and support >= 5:
        return "MEDIUM"
    return "LOW"


def visual_mode(expression: dict) -> str:
    fields = set()

    def walk(node: dict) -> None:
        if node.get("nodeType") == "CONDITION":
            fields.add(node.get("leftField"))
            return
        for child in node.get("children", []) or []:
            if isinstance(child, dict):
                walk(child)

    walk(expression)
    if {"orderIntentCount1m", "sameSideIntentCount1m", "draftDurationMs"} & fields:
        return "FAST_BURN"
    if {"shortTermReturn5m", "signedChangeRate", "volumeSpikeRatio5m"} & fields:
        return "SURPRISED"
    if {"priceVsAvgBuyRateAtSnapshot"} & fields:
        return "SAD"
    return "CURIOUS"
