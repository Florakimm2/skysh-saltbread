from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import unittest

from fastapi.testclient import TestClient

from app.analysis.guardrail.rule_validator import validate_rule_expression
from app.analysis.guardrail.schemas import GuardrailSuggestionAnalysisRequest
from app.config import Settings
from app.main import create_app
from app.services.guardrail_suggestion_analyzer import GuardrailSuggestionAnalyzer


def catalog():
    numeric = ["EQ", "NEQ", "GT", "GTE", "LT", "LTE", "IS_NULL", "IS_NOT_NULL"]
    enum = ["EQ", "NEQ", "IS_NULL", "IS_NOT_NULL"]
    result = {}
    for field in [
        "requestedBalanceRatio",
        "draftDurationMs",
        "sameSideIntentCount1m",
        "shortTermReturn5m",
        "signedChangeRate",
        "orderIntentCount1m",
    ]:
        result[field] = {
            "key": field,
            "valueType": "NUMBER",
            "nullable": True,
            "ruleEligible": True,
            "requiresPrivateApi": False,
            "supportedOperators": numeric,
            "comparisonGroup": "RATE" if "Rate" in field or "Return" in field else "COUNT",
            "input": {"control": "PERCENT" if "Rate" in field or "Return" in field else "COUNT_STEPPER"},
        }
    for field in ["side", "orderMode", "snapshotTrigger", "entryPoint", "allocationPresetPercent"]:
        result[field] = {
            "key": field,
            "valueType": "STRING" if field != "allocationPresetPercent" else "MIXED_ENUM",
            "nullable": True,
            "ruleEligible": True,
            "requiresPrivateApi": False,
            "supportedOperators": enum,
            "comparisonGroup": field,
            "input": {"control": "SELECT"},
        }
    result["actualOrderCreatedCount10m"] = {
        "key": "actualOrderCreatedCount10m",
        "valueType": "NUMBER",
        "nullable": True,
        "ruleEligible": True,
        "requiresPrivateApi": True,
        "supportedOperators": numeric,
        "comparisonGroup": "COUNT",
        "input": {"control": "COUNT_STEPPER"},
    }
    return result


def base_snapshot(index: int, captured_at: datetime, **overrides):
    record = {
        "recordId": f"s{index}",
        "attemptId": f"a{index}",
        "snapshotTrigger": "ORDER_INTENT_CLICK",
        "capturedAt": captured_at.isoformat(),
        "market": "KRW-BTC",
        "side": "SELL",
        "orderMode": "LIMIT",
        "entryPoint": "NORMAL",
        "allocationPresetPercent": "CUSTOM",
        "modeChangedToMarket": False,
        "requestedBalanceRatio": 0.2,
        "draftDurationMs": 18000 + index * 10,
        "sameSideIntentCount1m": 1,
        "orderIntentCount1m": 1,
        "shortTermReturn5m": 0.005,
        "signedChangeRate": 0.01,
        "shownRuleIds": [],
        "matchedRuleIdsAtSnapshot": [],
        "primaryShownRuleId": None,
    }
    record.update(overrides)
    return record


def feedback(index: int, self_assessment: str):
    return {
        "recordId": f"f{index}",
        "attemptId": f"a{index}",
        "feedbackStatus": "ANSWERED",
        "selfAssessment": self_assessment,
        "respondedAt": f"2026-07-01T02:{index % 60:02d}:00+00:00",
    }


def make_request(snapshots, feedbacks, rules=None):
    return GuardrailSuggestionAnalysisRequest.model_validate(
        {
            "analysis_date": "2026-07-12",
            "timezone": "Asia/Seoul",
            "source_window": {
                "from_at": "2026-04-13T00:00:00+00:00",
                "to_at": "2026-07-12T00:00:00+00:00",
            },
            "snapshots": snapshots,
            "reactions": [],
            "feedbacks": feedbacks,
            "confirmedTrades": [],
            "currentRules": rules or [],
            "fieldCatalog": catalog(),
            "options": {
                "min_total_labeled_samples": 20,
                "min_regretted_samples": 5,
                "min_cluster_samples": 5,
            },
        }
    )


class GuardrailSuggestionTests(unittest.TestCase):
    def test_new_guardrail_candidate_from_regretted_cluster(self) -> None:
        start = datetime(2026, 7, 1, tzinfo=timezone.utc)
        snapshots = []
        feedbacks = []
        for index in range(30):
            is_regretted = index >= 18
            clustered = 18 <= index < 26
            snapshots.append(
                base_snapshot(
                    index,
                    start + timedelta(minutes=index),
                    side="BUY" if clustered else ("BUY" if is_regretted else "SELL"),
                    orderMode="MARKET" if clustered else "LIMIT",
                    shortTermReturn5m=0.065 + index * 0.0001 if clustered else 0.004 + index * 0.0001,
                    draftDurationMs=1800 + index * 5 if clustered else 22000 + index * 20,
                    sameSideIntentCount1m=4 if clustered else 1,
                    shownRuleIds=["observed-rule"],
                )
            )
            feedbacks.append(feedback(index, "EMOTIONAL" if is_regretted else "PLANNED"))

        response = GuardrailSuggestionAnalyzer().analyze(make_request(snapshots, feedbacks))

        self.assertEqual(response.status, "AVAILABLE")
        self.assertIsNotNone(response.new_guardrail)
        expression = response.new_guardrail.proposed_rule.expression
        validation = validate_rule_expression(expression, make_request(snapshots, feedbacks).field_catalog)
        self.assertFalse(validation["requiresPrivateApi"])
        text = str(expression)
        self.assertIn("side", text)
        self.assertIn("BUY", text)
        self.assertGreaterEqual(response.new_guardrail.simulation.support, 5)
        self.assertGreaterEqual(response.new_guardrail.confidence, 0)

    def test_modification_candidate_tightens_existing_threshold(self) -> None:
        start = datetime(2026, 7, 1, tzinfo=timezone.utc)
        snapshots = []
        feedbacks = []
        for index in range(30):
            is_regretted = index >= 18
            if index < 10:
                signed_change = 0.035 + index * 0.0005
            elif is_regretted:
                signed_change = 0.055 + (index - 18) * 0.001
            else:
                signed_change = 0.015
            shown = ["rule-rise"] if signed_change >= 0.03 else []
            snapshots.append(
                base_snapshot(
                    index,
                    start + timedelta(minutes=index),
                    side="BUY",
                    orderMode="MARKET",
                    signedChangeRate=signed_change,
                    shownRuleIds=shown,
                )
            )
            feedbacks.append(feedback(index, "EMOTIONAL" if is_regretted else "PLANNED"))

        rules = [
            {
                "ruleId": "rule-rise",
                "name": "급등 추격 매수",
                "description": None,
                "isEnabled": True,
                "priority": 1,
                "riskLevel": "MEDIUM",
                "visualMode": "SURPRISED",
                "expression": {
                    "nodeType": "CONDITION",
                    "leftField": "signedChangeRate",
                    "operator": "GTE",
                    "rightOperand": {"operandType": "LITERAL", "value": 0.03},
                },
                "warningTitle": "급등 구간 확인",
                "warningMessage": "주문 기준을 확인해 주세요.",
                "requiresPrivateApi": False,
                "schemaVersion": "v1",
                "updatedAt": "2026-07-01T00:00:00+00:00",
            }
        ]
        response = GuardrailSuggestionAnalyzer().analyze(make_request(snapshots, feedbacks, rules))

        self.assertEqual(response.status, "AVAILABLE")
        self.assertIsNotNone(response.modification)
        self.assertEqual(response.modification.rule_id, "rule-rise")
        self.assertGreaterEqual(response.modification.diff[0].after, 0.05)
        self.assertGreater(
            response.modification.proposed_simulation.precision or 0,
            response.modification.current_simulation.precision or 0,
        )

    def test_minimum_samples_are_required(self) -> None:
        snapshots = [
            base_snapshot(index, datetime(2026, 7, 1, tzinfo=timezone.utc) + timedelta(minutes=index))
            for index in range(5)
        ]
        feedbacks = [feedback(index, "PLANNED") for index in range(5)]
        response = GuardrailSuggestionAnalyzer().analyze(make_request(snapshots, feedbacks))
        self.assertEqual(response.status, "INSUFFICIENT_DATA")

    def test_common_contract_fixture_returns_insufficient_data_not_422(self) -> None:
        fixture_path = (
            Path(__file__).resolve().parents[2]
            / "tests"
            / "fixtures"
            / "guardrail-suggestion-request.json"
        )
        payload = json.loads(fixture_path.read_text())
        client = TestClient(
            create_app(
                Settings(openai_api_key=None, service_api_key="secret"),
                guardrail_suggestion_analyzer=GuardrailSuggestionAnalyzer(),
            )
        )

        response = client.post(
            "/api/v1/insights/guardrail-suggestions/analyze",
            json=payload,
            headers={"X-API-Key": "secret"},
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["status"], "INSUFFICIENT_DATA")
        self.assertIsNone(body["newGuardrail"])
        self.assertIsNone(body["modification"])
        source_summary = body.get("sourceSummary") or body["source_summary"]
        self.assertEqual(source_summary.get("labeledSampleCount") or source_summary["labeled_sample_count"], 6)
        self.assertEqual(source_summary.get("guardrailTriggerCount") or source_summary["guardrail_trigger_count"], 0)

    def test_full_frontend_catalog_shape_is_rejected_with_validation_path(self) -> None:
        fixture_path = (
            Path(__file__).resolve().parents[2]
            / "tests"
            / "fixtures"
            / "guardrail-suggestion-request.json"
        )
        payload = json.loads(fixture_path.read_text())
        payload["field_catalog"]["signedChangeRate"]["label"] = "등락률"
        payload["field_catalog"]["signedChangeRate"]["category"] = "MARKET"
        client = TestClient(
            create_app(
                Settings(openai_api_key=None, service_api_key="secret"),
                guardrail_suggestion_analyzer=GuardrailSuggestionAnalyzer(),
            )
        )

        response = client.post(
            "/api/v1/insights/guardrail-suggestions/analyze",
            json=payload,
            headers={"X-API-Key": "secret"},
        )

        self.assertEqual(response.status_code, 422)
        locs = [item["loc"] for item in response.json()["detail"]]
        self.assertIn(["body", "field_catalog", "signedChangeRate", "label"], locs)
        self.assertIn(["body", "field_catalog", "signedChangeRate", "category"], locs)

    def test_all_cluster_noise_is_no_suggestion_not_error(self) -> None:
        start = datetime(2026, 7, 1, tzinfo=timezone.utc)
        snapshots = []
        feedbacks = []
        for index in range(20):
            snapshots.append(
                base_snapshot(
                    index,
                    start + timedelta(minutes=index),
                    requestedBalanceRatio=0.02 + index * 0.01,
                    draftDurationMs=1000 + index * 1000,
                    signedChangeRate=-0.1 + index * 0.01,
                    shownRuleIds=["observed-rule"],
                )
            )
            feedbacks.append(feedback(index, "EMOTIONAL" if index < 5 else "PLANNED"))
        request = make_request(snapshots, feedbacks).model_copy(
            update={"options": make_request(snapshots, feedbacks).options.model_copy(update={"min_cluster_samples": 20})}
        )

        response = GuardrailSuggestionAnalyzer().analyze(request)

        self.assertEqual(response.status, "NO_SUGGESTION")
        self.assertIsNone(response.new_guardrail)
        self.assertIsNone(response.modification)
        self.assertIn("all_clusters_noise", response.diagnostics.rejection_reasons)

    def test_llm_explanation_failure_keeps_python_candidate(self) -> None:
        class FailingChain:
            def invoke(self, _payload):
                raise RuntimeError("llm unavailable")

        start = datetime(2026, 7, 1, tzinfo=timezone.utc)
        snapshots = []
        feedbacks = []
        for index in range(30):
            is_regretted = index >= 18
            clustered = 18 <= index < 26
            snapshots.append(
                base_snapshot(
                    index,
                    start + timedelta(minutes=index),
                    side="BUY" if clustered else ("BUY" if is_regretted else "SELL"),
                    orderMode="MARKET" if clustered else "LIMIT",
                    shortTermReturn5m=0.065 + index * 0.0001 if clustered else 0.004 + index * 0.0001,
                    draftDurationMs=1800 + index * 5 if clustered else 22000 + index * 20,
                    sameSideIntentCount1m=4 if clustered else 1,
                    shownRuleIds=["observed-rule"],
                )
            )
            feedbacks.append(feedback(index, "EMOTIONAL" if is_regretted else "PLANNED"))

        response = GuardrailSuggestionAnalyzer(explanation_chain=FailingChain()).analyze(
            make_request(snapshots, feedbacks)
        )

        self.assertEqual(response.status, "AVAILABLE")
        self.assertIsNotNone(response.new_guardrail)
        self.assertEqual(response.diagnostics.explanation_status, "FALLBACK")

    def test_api_key_protects_guardrail_suggestion_endpoint(self) -> None:
        client = TestClient(
            create_app(
                Settings(openai_api_key=None, service_api_key="secret"),
                guardrail_suggestion_analyzer=GuardrailSuggestionAnalyzer(),
            )
        )
        payload = make_request([], []).model_dump(by_alias=True, mode="json")
        missing = client.post(
            "/api/v1/insights/guardrail-suggestions/analyze",
            json=payload,
        )
        accepted = client.post(
            "/api/v1/insights/guardrail-suggestions/analyze",
            json=payload,
            headers={"X-API-Key": "secret"},
        )
        self.assertEqual(missing.status_code, 401)
        self.assertEqual(accepted.status_code, 200)


if __name__ == "__main__":
    unittest.main()
