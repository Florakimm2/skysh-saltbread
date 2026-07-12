from __future__ import annotations

import hashlib
import itertools
from dataclasses import dataclass
from typing import Any

import numpy as np

from app.analysis.guardrail.preprocessing import CATEGORICAL_FIELDS, NUMERIC_FIELDS, safe_float
from app.analysis.guardrail.representative import representative_values
from app.analysis.guardrail.rule_simulator import simulate_rule
from app.analysis.guardrail.rule_validator import (
    canonical_expression,
    expression_hash,
    requires_private_api,
    stable_json,
    validate_rule_expression,
)
from app.analysis.guardrail.schemas import (
    GuardrailRuleInput,
    ProposedGuardrailRule,
    RuleChangeDiff,
    RuleFieldDefinitionInput,
    RuleSimulationResult,
    SourceWindow,
)
from app.analysis.guardrail.scoring import (
    MOD_MAX_RECALL_DROP,
    MOD_MIN_PLANNED_FP_REDUCTION,
    MOD_MIN_PRECISION_GAIN,
    MOD_MIN_SUPPORT,
    NEW_MIN_LIFT,
    NEW_MIN_REGRETTED_RATE,
    NEW_MIN_SUPPORT,
    clamp_confidence,
    risk_level,
    visual_mode,
)

MAX_CONDITIONS_PER_CANDIDATE = 4
MAX_CONDITION_POOL = 10


@dataclass(frozen=True)
class InternalNewCandidate:
    proposed_rule: ProposedGuardrailRule
    evidence_count: int
    confidence: float
    representative_values: dict[str, Any]
    simulation: RuleSimulationResult
    cluster_metrics: dict[str, Any]
    source_window: SourceWindow


@dataclass(frozen=True)
class InternalModificationCandidate:
    rule_id: str
    base_rule_hash: str
    proposed_rule: ProposedGuardrailRule
    diff: list[RuleChangeDiff]
    evidence_count: int
    confidence: float
    representative_values: dict[str, Any]
    current_simulation: RuleSimulationResult
    proposed_simulation: RuleSimulationResult
    source_window: SourceWindow


def _condition(field: str, operator: str, value: Any) -> dict[str, Any]:
    return {
        "nodeType": "CONDITION",
        "leftField": field,
        "operator": operator,
        "rightOperand": {
            "operandType": "LITERAL",
            "value": value,
        },
    }


def _and_expression(conditions: list[dict[str, Any]]) -> dict[str, Any]:
    unique = {stable_json(canonical_expression(condition)): condition for condition in conditions}
    ordered = sorted(unique.values(), key=lambda condition: (condition["leftField"], condition["operator"], stable_json(condition["rightOperand"])))
    if len(ordered) == 1:
        return ordered[0]
    return {
        "nodeType": "GROUP",
        "operator": "AND",
        "children": ordered,
    }


def _round_threshold(value: float) -> float:
    return float(round(value, 6))


def _field_allowed(field_catalog: dict[str, RuleFieldDefinitionInput], field: str) -> bool:
    definition = field_catalog.get(field)
    return bool(definition and definition.rule_eligible)


def _numeric_values(records: list[dict[str, Any]], field: str) -> list[float]:
    values: list[float] = []
    for record in records:
        value = safe_float(record.get(field))
        if value is not None:
            values.append(value)
    return values


def _candidate_thresholds(values: list[float]) -> list[float]:
    finite = sorted({value for value in values if np.isfinite(value)})
    if not finite:
        return []
    quantiles = [0.25, 0.5, 0.6, 0.7, 0.75, 0.8, 0.9]
    result = {_round_threshold(float(np.quantile(finite, q))) for q in quantiles}
    for left, right in zip(finite, finite[1:]):
        if left != right:
            result.add(_round_threshold((left + right) / 2))
    result.update(_round_threshold(value) for value in finite)
    return sorted(result)


def _score_simulation(simulation: RuleSimulationResult) -> float:
    precision = simulation.precision or 0.0
    recall = simulation.recall or 0.0
    lift = min(simulation.lift or 0.0, 4.0) / 4.0
    coverage = min(simulation.coverage, 0.5) / 0.5
    return precision * 0.45 + recall * 0.25 + lift * 0.2 + coverage * 0.1


def _condition_pool_for_cluster(
    *,
    cluster_records: list[dict[str, Any]],
    labeled_records: list[dict[str, Any]],
    field_catalog: dict[str, RuleFieldDefinitionInput],
) -> list[dict[str, Any]]:
    pool: list[tuple[float, dict[str, Any]]] = []

    for field in CATEGORICAL_FIELDS:
        if not _field_allowed(field_catalog, field):
            continue
        values = [record.get(field) for record in cluster_records if record.get(field) is not None]
        if not values:
            continue
        counts: dict[str, int] = {}
        for value in values:
            counts[str(value)] = counts.get(str(value), 0) + 1
        mode, count = max(counts.items(), key=lambda item: item[1])
        ratio = count / max(len(cluster_records), 1)
        if ratio >= 0.72:
            condition = _condition(field, "EQ", mode)
            simulation = simulate_rule(condition, labeled_records)
            pool.append((_score_simulation(simulation) + ratio * 0.2, condition))

    regretted_records = [record for record in cluster_records if record.get("label") == "REGRETTED"]
    planned_records = [record for record in labeled_records if record.get("label") == "PLANNED"]
    for field in NUMERIC_FIELDS:
        if not _field_allowed(field_catalog, field):
            continue
        cluster_values = _numeric_values(regretted_records or cluster_records, field)
        all_values = _numeric_values(labeled_records, field)
        planned_values = _numeric_values(planned_records, field)
        if len(cluster_values) < 3 or len(all_values) < 5:
            continue
        cluster_median = float(np.median(cluster_values))
        baseline_median = float(np.median(planned_values or all_values))
        operators = ["GTE", "GT"] if cluster_median >= baseline_median else ["LTE", "LT"]
        for threshold in _candidate_thresholds([*cluster_values, *all_values]):
            for operator in operators:
                condition = _condition(field, operator, threshold)
                simulation = simulate_rule(condition, labeled_records)
                if simulation.support < NEW_MIN_SUPPORT:
                    continue
                if (simulation.precision or 0.0) < 0.45:
                    continue
                pool.append((_score_simulation(simulation), condition))

    deduped: dict[str, tuple[float, dict[str, Any]]] = {}
    for score, condition in pool:
        key = stable_json(canonical_expression(condition))
        if key not in deduped or score > deduped[key][0]:
            deduped[key] = (score, condition)
    return [
        condition
        for _, condition in sorted(deduped.values(), key=lambda item: item[0], reverse=True)[:MAX_CONDITION_POOL]
    ]


def _current_expression_hashes(rules: list[GuardrailRuleInput]) -> set[str]:
    return {expression_hash(rule.expression) for rule in rules if rule.expression}


def _candidate_key(
    *,
    algorithm_version: str,
    suggestion_type: str,
    expression: dict[str, Any],
    rule_id: str,
    source_window: SourceWindow,
    field_catalog: dict[str, RuleFieldDefinitionInput],
) -> str:
    catalog_digest = hashlib.sha256(
        stable_json({
            key: {
                "valueType": value.value_type,
                "requiresPrivateApi": value.requires_private_api,
                "ruleEligible": value.rule_eligible,
            }
            for key, value in sorted(field_catalog.items())
        }).encode(),
    ).hexdigest()
    digest = hashlib.sha256(
        stable_json({
            "algorithmVersion": algorithm_version,
            "type": suggestion_type,
            "expression": canonical_expression(expression),
            "ruleId": rule_id,
            "sourceWindow": {
                "fromAt": source_window.from_at.isoformat(),
                "toAt": source_window.to_at.isoformat(),
            },
            "fieldCatalog": catalog_digest,
        }).encode(),
    ).hexdigest()
    return f"{suggestion_type.lower()}_{digest[:24]}"


def attach_candidate_key(
    *,
    algorithm_version: str,
    suggestion_type: str,
    expression: dict[str, Any],
    rule_id: str,
    source_window: SourceWindow,
    field_catalog: dict[str, RuleFieldDefinitionInput],
) -> str:
    return _candidate_key(
        algorithm_version=algorithm_version,
        suggestion_type=suggestion_type,
        expression=expression,
        rule_id=rule_id,
        source_window=source_window,
        field_catalog=field_catalog,
    )


def generate_new_guardrail_candidate(
    *,
    records: list[dict[str, Any]],
    matrix: np.ndarray,
    labels: list[int],
    current_rules: list[GuardrailRuleInput],
    field_catalog: dict[str, RuleFieldDefinitionInput],
    source_window: SourceWindow,
) -> tuple[InternalNewCandidate | None, list[str], int, int]:
    rejection_reasons: list[str] = []
    before_count = 0
    after_count = 0
    regretted_total = sum(1 for record in records if record.get("label") == "REGRETTED")
    global_regretted_rate = regretted_total / max(len(records), 1)
    existing_hashes = _current_expression_hashes(current_rules)
    best: tuple[float, InternalNewCandidate] | None = None

    for cluster_id in sorted({label for label in labels if label != -1}):
        indices = [index for index, label in enumerate(labels) if label == cluster_id]
        cluster_records = [records[index] for index in indices]
        regretted_count = sum(1 for record in cluster_records if record.get("label") == "REGRETTED")
        planned_count = sum(1 for record in cluster_records if record.get("label") == "PLANNED")
        cluster_size = len(cluster_records)
        regretted_rate = regretted_count / max(cluster_size, 1)
        lift = regretted_rate / global_regretted_rate if global_regretted_rate > 0 else 0
        if cluster_size < NEW_MIN_SUPPORT:
            rejection_reasons.append("cluster_support_below_minimum")
            continue
        if regretted_rate < NEW_MIN_REGRETTED_RATE or lift < NEW_MIN_LIFT:
            rejection_reasons.append("cluster_regretted_concentration_below_minimum")
            continue

        pool = _condition_pool_for_cluster(
            cluster_records=cluster_records,
            labeled_records=records,
            field_catalog=field_catalog,
        )
        if not pool:
            rejection_reasons.append("no_rule_condition_pool")
            continue

        for condition_count in range(1, min(MAX_CONDITIONS_PER_CANDIDATE, len(pool)) + 1):
            for condition_set in itertools.combinations(pool, condition_count):
                before_count += 1
                expression = _and_expression(list(condition_set))
                expression = canonical_expression(expression)
                try:
                    validate_rule_expression(expression, field_catalog)
                except Exception:
                    rejection_reasons.append("candidate_failed_rule_validation")
                    continue
                if expression_hash(expression) in existing_hashes:
                    rejection_reasons.append("candidate_duplicates_existing_rule")
                    continue
                simulation = simulate_rule(expression, records)
                if simulation.support < NEW_MIN_SUPPORT:
                    rejection_reasons.append("candidate_support_below_minimum")
                    continue
                if (simulation.precision or 0.0) < 0.55:
                    rejection_reasons.append("candidate_precision_below_minimum")
                    continue
                if (simulation.lift or 0.0) < NEW_MIN_LIFT:
                    rejection_reasons.append("candidate_lift_below_minimum")
                    continue

                after_count += 1
                representative = representative_values(records=records, matrix=matrix, indices=indices)
                confidence = clamp_confidence(
                    0.35
                    + (simulation.precision or 0.0) * 0.35
                    + min((simulation.lift or 0.0) / 4.0, 1.0) * 0.2
                    + min(simulation.support / 30.0, 1.0) * 0.1
                )
                proposed = ProposedGuardrailRule(
                    name="유사 주문 상황 확인",
                    description="최근 기록에서 후회가 남는다고 남긴 주문과 비슷한 조건을 다시 확인합니다.",
                    riskLevel=risk_level(regretted_rate, simulation.support),
                    visualMode=visual_mode(expression),
                    expression=expression,
                    warningTitle="주문 기준을 한 번 더 확인해 볼까요?",
                    warningMessage="최근 비슷한 주문 상황에서 후회가 남는다는 기록이 반복됐어요. 처음 세운 기준과 주문 방식을 다시 확인해 보세요.",
                    requiresPrivateApi=requires_private_api(expression, field_catalog),
                )
                candidate = InternalNewCandidate(
                    proposed_rule=proposed,
                    evidence_count=regretted_count,
                    confidence=confidence,
                    representative_values=representative,
                    simulation=simulation,
                    cluster_metrics={
                        "clusterId": cluster_id,
                        "clusterSize": cluster_size,
                        "regrettedCount": regretted_count,
                        "plannedCount": planned_count,
                        "regrettedRate": regretted_rate,
                        "globalRegrettedRate": global_regretted_rate,
                        "lift": lift,
                    },
                    source_window=source_window,
                )
                score = _score_simulation(simulation) + regretted_rate * 0.15
                if best is None or score > best[0]:
                    best = (score, candidate)

    return (best[1] if best else None, rejection_reasons, before_count, after_count)


def _walk_conditions(expression: dict[str, Any], path: str = "expression") -> list[tuple[str, dict[str, Any]]]:
    if expression.get("nodeType") == "CONDITION":
        return [(path, expression)]
    if expression.get("nodeType") != "GROUP":
        return []
    result: list[tuple[str, dict[str, Any]]] = []
    for index, child in enumerate(expression.get("children", []) or []):
        if isinstance(child, dict):
            result.extend(_walk_conditions(child, f"{path}.children[{index}]"))
    return result


def _replace_at_path(expression: dict[str, Any], target_path: str, next_value: float) -> dict[str, Any]:
    if target_path == "expression" and expression.get("nodeType") == "CONDITION":
        clone = dict(expression)
        clone["rightOperand"] = {**clone.get("rightOperand", {}), "value": next_value}
        return clone
    if expression.get("nodeType") != "GROUP":
        return dict(expression)
    children = []
    for index, child in enumerate(expression.get("children", []) or []):
        child_path = f"expression.children[{index}]"
        if target_path == child_path:
            clone = dict(child)
            clone["rightOperand"] = {**clone.get("rightOperand", {}), "value": next_value}
            children.append(clone)
        elif target_path.startswith(f"{child_path}."):
            children.append(_replace_at_path(child, target_path, next_value))
        else:
            children.append(child)
    return {**expression, "children": children}


def generate_modification_candidate(
    *,
    records: list[dict[str, Any]],
    all_records_matrix: np.ndarray,
    current_rules: list[GuardrailRuleInput],
    field_catalog: dict[str, RuleFieldDefinitionInput],
    source_window: SourceWindow,
) -> tuple[InternalModificationCandidate | None, list[str], int, int]:
    rejection_reasons: list[str] = []
    before_count = 0
    after_count = 0
    best: tuple[float, InternalModificationCandidate] | None = None

    for rule in current_rules:
        triggered_indices = [
            index
            for index, record in enumerate(records)
            if rule.rule_id in (record.get("shownRuleIds") or [])
        ]
        if len(triggered_indices) < MOD_MIN_SUPPORT:
            rejection_reasons.append("rule_trigger_support_below_minimum")
            continue

        current_simulation = simulate_rule(rule.expression, records)
        if current_simulation.support < MOD_MIN_SUPPORT:
            rejection_reasons.append("current_rule_support_below_minimum")
            continue

        for condition_path, condition in _walk_conditions(rule.expression):
            if condition.get("operator") not in {"GT", "GTE", "LT", "LTE"}:
                continue
            right = condition.get("rightOperand") or {}
            if right.get("operandType") != "LITERAL":
                continue
            field = condition.get("leftField")
            if not isinstance(field, str) or not _field_allowed(field_catalog, field):
                continue
            current_threshold = safe_float(right.get("value"))
            if current_threshold is None:
                continue
            values = _numeric_values(records, field)
            triggered_values = _numeric_values([records[index] for index in triggered_indices], field)
            for threshold in _candidate_thresholds([*values, *triggered_values]):
                before_count += 1
                if condition.get("operator") in {"GT", "GTE"} and threshold <= current_threshold:
                    continue
                if condition.get("operator") in {"LT", "LTE"} and threshold >= current_threshold:
                    continue
                proposed_expression = canonical_expression(
                    _replace_at_path(rule.expression, condition_path, threshold),
                )
                try:
                    validate_rule_expression(proposed_expression, field_catalog)
                except Exception:
                    rejection_reasons.append("modification_failed_rule_validation")
                    continue
                proposed_simulation = simulate_rule(proposed_expression, records)
                if proposed_simulation.support < MOD_MIN_SUPPORT:
                    rejection_reasons.append("modification_support_below_minimum")
                    continue
                precision_gain = (proposed_simulation.precision or 0.0) - (current_simulation.precision or 0.0)
                planned_reduction = (
                    (current_simulation.false_positive_rate or 0.0)
                    - (proposed_simulation.false_positive_rate or 0.0)
                )
                recall_drop = (current_simulation.recall or 0.0) - (proposed_simulation.recall or 0.0)
                if precision_gain < MOD_MIN_PRECISION_GAIN and planned_reduction < MOD_MIN_PLANNED_FP_REDUCTION:
                    rejection_reasons.append("modification_improvement_below_minimum")
                    continue
                if recall_drop > MOD_MAX_RECALL_DROP:
                    rejection_reasons.append("modification_regretted_recall_drop_too_large")
                    continue

                after_count += 1
                representative = representative_values(
                    records=records,
                    matrix=all_records_matrix,
                    indices=triggered_indices,
                )
                diff_path = f"{condition_path}.rightOperand.value"
                proposed = ProposedGuardrailRule(
                    ruleId=rule.rule_id,
                    name=rule.name,
                    description=rule.description,
                    isEnabled=rule.is_enabled,
                    priority=rule.priority,
                    riskLevel=rule.risk_level,
                    visualMode=rule.visual_mode,
                    expression=proposed_expression,
                    warningTitle=rule.warning_title,
                    warningMessage=rule.warning_message,
                    requiresPrivateApi=requires_private_api(proposed_expression, field_catalog),
                    schemaVersion=rule.schema_version,
                )
                candidate = InternalModificationCandidate(
                    rule_id=rule.rule_id,
                    base_rule_hash=expression_hash(rule.expression),
                    proposed_rule=proposed,
                    diff=[
                        RuleChangeDiff(
                            path=diff_path,
                            before=right.get("value"),
                            after=threshold,
                            reason="계획적 거래에서 발생한 경고를 줄이면서 후회 거래 감지율을 유지한 임계값입니다.",
                        ),
                    ],
                    evidence_count=len(triggered_indices),
                    confidence=clamp_confidence(
                        0.45
                        + max(precision_gain, 0.0) * 0.3
                        + max(planned_reduction, 0.0) * 0.2
                        + min(proposed_simulation.support / 30.0, 1.0) * 0.1
                    ),
                    representative_values=representative,
                    current_simulation=current_simulation,
                    proposed_simulation=proposed_simulation,
                    source_window=source_window,
                )
                direction_bonus = (
                    threshold * 0.0001
                    if condition.get("operator") in {"GT", "GTE"}
                    else -threshold * 0.0001
                )
                score = precision_gain + planned_reduction - max(recall_drop, 0.0) + direction_bonus
                if best is None or score > best[0]:
                    best = (score, candidate)

    return (best[1] if best else None, rejection_reasons, before_count, after_count)
