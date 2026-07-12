from __future__ import annotations

import hashlib
import json
from decimal import Decimal, InvalidOperation
from typing import Any

from app.analysis.guardrail.schemas import RuleFieldDefinitionInput

NULL_OPERATORS = {"IS_NULL", "IS_NOT_NULL"}
COMPARISON_OPERATORS = {"EQ", "NEQ", "GT", "GTE", "LT", "LTE", "IN", "NOT_IN"}
MAX_EXPRESSION_DEPTH = 5
MAX_CONDITION_COUNT = 8


class RuleValidationError(ValueError):
    pass


def stable_json(value: Any) -> str:
    if isinstance(value, dict):
        return "{" + ",".join(
            f"{json.dumps(str(key), ensure_ascii=False)}:{stable_json(value[key])}"
            for key in sorted(value)
            if value[key] is not None
        ) + "}"
    if isinstance(value, list):
        return "[" + ",".join(stable_json(item) for item in value) + "]"
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def canonical_expression(expression: dict[str, Any]) -> dict[str, Any]:
    if expression.get("nodeType") == "GROUP":
        children = [
            canonical_expression(child)
            for child in expression.get("children", []) or []
            if isinstance(child, dict)
        ]
        children = sorted(children, key=stable_json)
        return {
            "nodeType": "GROUP",
            "operator": expression.get("operator"),
            "children": children,
        }
    result = {
        "nodeType": "CONDITION",
        "leftField": expression.get("leftField"),
        "operator": expression.get("operator"),
    }
    if "rightOperand" in expression:
        result["rightOperand"] = expression.get("rightOperand")
    return result


def expression_hash(expression: dict[str, Any]) -> str:
    return hashlib.sha256(stable_json(canonical_expression(expression)).encode()).hexdigest()


def _is_decimal_string(value: str) -> bool:
    try:
        decimal = Decimal(value)
    except (InvalidOperation, ValueError):
        return False
    return decimal.is_finite()


def _catalog_field(
    field_catalog: dict[str, RuleFieldDefinitionInput],
    field: str,
) -> RuleFieldDefinitionInput:
    definition = field_catalog.get(field)
    if not definition or not definition.rule_eligible:
        raise RuleValidationError(f"unsupported rule field: {field}")
    return definition


def _validate_literal(
    definition: RuleFieldDefinitionInput,
    operator: str,
    value: Any,
) -> None:
    if operator in {"IN", "NOT_IN"}:
        if not isinstance(value, list):
            raise RuleValidationError("IN and NOT_IN literal value must be a list")
        if definition.value_type not in {"STRING", "STRING_ARRAY"}:
            raise RuleValidationError("IN and NOT_IN are only supported for string fields")
        if not all(isinstance(item, str) for item in value):
            raise RuleValidationError("IN and NOT_IN values must be string[]")
        return

    if definition.value_type == "STRING":
        if not isinstance(value, str):
            raise RuleValidationError("STRING literal must be a string")
        return
    if definition.value_type == "NUMBER":
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not value == value:
            raise RuleValidationError("NUMBER literal must be a finite number")
        return
    if definition.value_type == "BOOLEAN":
        if not isinstance(value, bool):
            raise RuleValidationError("BOOLEAN literal must be a boolean")
        return
    if definition.value_type == "DECIMAL_STRING":
        if not isinstance(value, str) or not _is_decimal_string(value):
            raise RuleValidationError("DECIMAL_STRING literal must be a decimal string")
        return
    if definition.value_type == "MIXED_ENUM":
        if not isinstance(value, (str, int, float, bool)) and value is not None:
            raise RuleValidationError("MIXED_ENUM literal has an invalid type")


def _validate_condition(
    condition: dict[str, Any],
    field_catalog: dict[str, RuleFieldDefinitionInput],
) -> bool:
    left_field = condition.get("leftField")
    operator = condition.get("operator")
    if not isinstance(left_field, str) or not isinstance(operator, str):
        raise RuleValidationError("condition requires leftField and operator")
    definition = _catalog_field(field_catalog, left_field)
    if operator not in NULL_OPERATORS | COMPARISON_OPERATORS:
        raise RuleValidationError(f"unsupported operator: {operator}")
    if definition.supported_operators and operator not in definition.supported_operators:
        raise RuleValidationError(f"operator not supported for field: {left_field}")

    requires_private_api = definition.requires_private_api
    if operator in NULL_OPERATORS:
        if "rightOperand" in condition:
            raise RuleValidationError("null operators cannot have rightOperand")
        return requires_private_api

    right = condition.get("rightOperand")
    if not isinstance(right, dict):
        raise RuleValidationError("comparison operator requires rightOperand")
    operand_type = right.get("operandType")
    if operand_type == "LITERAL":
        _validate_literal(definition, operator, right.get("value"))
        return requires_private_api
    if operand_type == "FIELD":
        right_field = right.get("field")
        if not isinstance(right_field, str):
            raise RuleValidationError("FIELD operand requires field")
        right_definition = _catalog_field(field_catalog, right_field)
        if (
            not definition.comparison_group
            or definition.comparison_group != right_definition.comparison_group
        ):
            raise RuleValidationError("FIELD operand must use the same comparison group")
        return requires_private_api or right_definition.requires_private_api
    raise RuleValidationError("rightOperand.operandType must be LITERAL or FIELD")


def validate_rule_expression(
    expression: dict[str, Any],
    field_catalog: dict[str, RuleFieldDefinitionInput],
    *,
    depth: int = 0,
) -> dict[str, Any]:
    if depth > MAX_EXPRESSION_DEPTH:
        raise RuleValidationError("expression depth limit exceeded")
    if not isinstance(expression, dict):
        raise RuleValidationError("expression must be an object")

    node_type = expression.get("nodeType")
    if node_type == "CONDITION":
        return {
            "requiresPrivateApi": _validate_condition(expression, field_catalog),
            "conditionCount": 1,
        }

    if node_type == "GROUP":
        operator = expression.get("operator")
        children = expression.get("children")
        if operator not in {"AND", "OR"}:
            raise RuleValidationError("GROUP operator must be AND or OR")
        if not isinstance(children, list) or not children:
            raise RuleValidationError("GROUP children cannot be empty")
        requires_private_api = False
        condition_count = 0
        for child in children:
            result = validate_rule_expression(child, field_catalog, depth=depth + 1)
            requires_private_api = requires_private_api or result["requiresPrivateApi"]
            condition_count += result["conditionCount"]
        if condition_count > MAX_CONDITION_COUNT:
            raise RuleValidationError("condition count limit exceeded")
        return {
            "requiresPrivateApi": requires_private_api,
            "conditionCount": condition_count,
        }

    raise RuleValidationError("expression.nodeType must be CONDITION or GROUP")


def requires_private_api(
    expression: dict[str, Any],
    field_catalog: dict[str, RuleFieldDefinitionInput],
) -> bool:
    return bool(validate_rule_expression(expression, field_catalog)["requiresPrivateApi"])
