from __future__ import annotations

from typing import Any

from app.analysis.guardrail.preprocessing import safe_float
from app.analysis.guardrail.schemas import RuleSimulationResult


def _compare(left: Any, right: Any, operator: str) -> bool:
    if operator == "EQ":
        return str(left) == str(right) if isinstance(left, str) or isinstance(right, str) else left == right
    if operator == "NEQ":
        return not _compare(left, right, "EQ")
    if operator == "IN":
        return isinstance(right, list) and str(left) in {str(item) for item in right}
    if operator == "NOT_IN":
        return isinstance(right, list) and str(left) not in {str(item) for item in right}
    left_number = safe_float(left)
    right_number = safe_float(right)
    if left_number is None or right_number is None:
        return False
    if operator == "GT":
        return left_number > right_number
    if operator == "GTE":
        return left_number >= right_number
    if operator == "LT":
        return left_number < right_number
    if operator == "LTE":
        return left_number <= right_number
    return False


def expression_matches(expression: dict[str, Any], record: dict[str, Any]) -> bool:
    if expression.get("nodeType") == "GROUP":
        children = expression.get("children", []) or []
        results = [expression_matches(child, record) for child in children if isinstance(child, dict)]
        if not results:
            return False
        return any(results) if expression.get("operator") == "OR" else all(results)

    if expression.get("nodeType") != "CONDITION":
        return False

    left = record.get(expression.get("leftField"))
    operator = expression.get("operator")
    if operator == "IS_NULL":
        return left is None
    if operator == "IS_NOT_NULL":
        return left is not None
    if left is None:
        return False
    right_operand = expression.get("rightOperand") or {}
    if right_operand.get("operandType") == "FIELD":
        right = record.get(right_operand.get("field"))
    else:
        right = right_operand.get("value")
    return _compare(left, right, operator)


def simulate_rule(
    expression: dict[str, Any],
    labeled_records: list[dict[str, Any]],
) -> RuleSimulationResult:
    total = len(labeled_records)
    regretted = [record for record in labeled_records if record.get("label") == "REGRETTED"]
    planned = [record for record in labeled_records if record.get("label") == "PLANNED"]
    matched = [record for record in labeled_records if expression_matches(expression, record)]
    matched_regretted = [record for record in matched if record.get("label") == "REGRETTED"]
    matched_planned = [record for record in matched if record.get("label") == "PLANNED"]

    global_regretted_rate = len(regretted) / total if total else 0
    precision = len(matched_regretted) / len(matched) if matched else None
    recall = len(matched_regretted) / len(regretted) if regretted else None
    false_positive_rate = len(matched_planned) / len(planned) if planned else None
    lift = precision / global_regretted_rate if precision is not None and global_regretted_rate > 0 else None

    return RuleSimulationResult(
        trigger_count=len(matched),
        support=len(matched),
        coverage=len(matched) / total if total else 0.0,
        precision=precision,
        recall=recall,
        false_positive_rate=false_positive_rate,
        planned_trigger_rate=false_positive_rate,
        regretted_capture_rate=recall,
        lift=lift,
    )
