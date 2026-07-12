from __future__ import annotations

import logging
import time
from collections import defaultdict
from typing import Any

from langchain_core.output_parsers import PydanticOutputParser
from langchain_core.prompts import PromptTemplate
from langchain_openai import ChatOpenAI

from app.analysis.guardrail.candidate_generator import (
    attach_candidate_key,
    generate_modification_candidate,
    generate_new_guardrail_candidate,
)
from app.analysis.guardrail.clustering import find_behavior_clusters
from app.analysis.guardrail.feature_builder import build_feature_matrix
from app.analysis.guardrail.schemas import (
    ALGORITHM_VERSION,
    AnalysisDiagnostics,
    GuardrailModificationSuggestion,
    GuardrailSuggestionAnalysisRequest,
    GuardrailSuggestionAnalysisResponse,
    NewGuardrailSuggestion,
    SourceSummary,
    SuggestionAnalysisResult,
    SuggestionExplanation,
)

logger = logging.getLogger(__name__)

EXPLANATION_PROMPT = """당신은 암호화폐 개인 투자자의 주문 기록을 바탕으로 가드레일 제안을 설명하는 AI 어드바이저입니다.

[중요한 역할 분리]
아래 입력의 expression, threshold, confidence, evidenceCount, simulation, diff는 이미 데이터 분석 코드가 확정했습니다.
당신은 조건을 바꾸거나 새 조건을 만들지 말고, 사용자에게 보일 설명 문구만 작성하세요.

[금지 표현]
감정적 뇌동매매, 이성적인 투자자, 귀를 닫은 트레이더, 나쁜 거래 습관, 무조건 손실을 막음, 수익률을 높여줌

[권장 표현]
후회가 남는다고 기록한 주문, 반복된 주문 시도, 계획과 실제 주문 행동의 차이, 가드레일 이후 계속 진행한 기록, 유사한 주문 상황, 다음 주문에서 확인할 기준

[확정 분석 결과]
{candidate_summary}

{format_instructions}"""


class GuardrailSuggestionAnalyzer:
    def __init__(
        self,
        *,
        api_key: str | None = None,
        model: str = "gpt-4o-mini",
        temperature: float = 0.3,
        timeout_seconds: float = 30.0,
        explanation_chain: Any | None = None,
    ) -> None:
        if explanation_chain is not None:
            self._chain = explanation_chain
            return
        if not api_key:
            self._chain = None
            return
        parser = PydanticOutputParser(pydantic_object=SuggestionExplanation)
        prompt = PromptTemplate(
            template=EXPLANATION_PROMPT,
            input_variables=["candidate_summary"],
            partial_variables={"format_instructions": parser.get_format_instructions()},
        )
        llm = ChatOpenAI(
            model=model,
            temperature=temperature,
            api_key=api_key,
            timeout=timeout_seconds,
            max_retries=2,
        )
        self._chain = prompt | llm | parser

    def _fallback_explanation(self, suggestion_type: str) -> SuggestionExplanation:
        if suggestion_type == "MODIFY_GUARDRAIL":
            return SuggestionExplanation(
                title="기존 가드레일 조정 제안",
                rationale="기존 가드레일이 표시된 기록을 다시 계산해 보니 조건을 조금 조정해 볼 만한 패턴이 있었어요.",
                evidence_summary="실제 표시된 가드레일 기록과 피드백이 연결된 표본을 기준으로 계산했어요.",
                expected_change="전체 경고 횟수와 계획적 거래에서의 경고를 줄이면서 후회가 남는다고 기록한 주문 감지는 비슷하게 유지하는 방향입니다.",
                caution="표본이 더 쌓이면 기준이 달라질 수 있어요.",
                rule_name="조정된 가드레일",
                rule_description="최근 기록의 대표값을 바탕으로 조건을 조정합니다.",
                warning_title="주문 기준을 다시 확인해 볼까요?",
                warning_message="최근 기록과 비슷한 주문 상황입니다. 처음 세운 기준과 주문 내용을 한 번 더 확인해 보세요.",
            )
        return SuggestionExplanation(
            title="새로운 가드레일 제안",
            rationale="최근 기록에서 비슷한 주문 상황과 후회가 남는다고 기록한 주문이 함께 반복됐어요.",
            evidence_summary="유사한 주문 상황의 대표값과 과거 기록 시뮬레이션을 기준으로 계산했어요.",
            expected_change="다음 주문에서 같은 조건이 나타나면 주문 기준을 한 번 더 확인하도록 도와줍니다.",
            caution="이 제안은 확정적인 진단이 아니라 최근 기록에서 발견된 반복 패턴입니다.",
            rule_name="유사 주문 상황 확인",
            rule_description="후회가 남는다고 기록한 주문과 비슷한 조건을 주문 전에 확인합니다.",
            warning_title="주문 기준을 한 번 더 확인해 볼까요?",
            warning_message="최근 비슷한 주문 상황에서 후회가 남는다는 기록이 반복됐어요. 처음 세운 기준과 주문 방식을 다시 확인해 보세요.",
        )

    def _explain(self, suggestion_type: str, summary: dict[str, Any]) -> tuple[SuggestionExplanation, bool]:
        if self._chain is None:
            return self._fallback_explanation(suggestion_type), False
        try:
            explanation = self._chain.invoke({"candidate_summary": summary})
            if isinstance(explanation, SuggestionExplanation):
                return explanation, True
            return SuggestionExplanation.model_validate(explanation), True
        except Exception:
            logger.exception("Guardrail suggestion explanation generation failed")
            return self._fallback_explanation(suggestion_type), False

    def _feedback_labels(self, request: GuardrailSuggestionAnalysisRequest) -> dict[str, str]:
        grouped: dict[str, list[Any]] = defaultdict(list)
        for feedback in request.feedbacks:
            grouped[feedback.attempt_id].append(feedback)

        labels: dict[str, str] = {}
        for attempt_id, feedbacks in grouped.items():
            if len(feedbacks) != 1:
                continue
            feedback = feedbacks[0]
            if feedback.feedback_status != "ANSWERED":
                continue
            if feedback.self_assessment == "PLANNED":
                labels[attempt_id] = "PLANNED"
            elif feedback.self_assessment == "EMOTIONAL":
                labels[attempt_id] = "REGRETTED"
        return labels

    def _shown_rule_ids_by_attempt(
        self,
        request: GuardrailSuggestionAnalysisRequest,
    ) -> dict[str, set[str]]:
        by_attempt: dict[str, set[str]] = defaultdict(set)
        intent_snapshots = [
            snapshot
            for snapshot in request.snapshots
            if snapshot.snapshot_trigger == "ORDER_INTENT_CLICK" and snapshot.attempt_id
        ]
        for snapshot in request.snapshots:
            shown_rule_ids = set(snapshot.shown_rule_ids or [])
            if snapshot.primary_shown_rule_id:
                shown_rule_ids.add(snapshot.primary_shown_rule_id)
            if not shown_rule_ids:
                continue
            if snapshot.attempt_id:
                by_attempt[snapshot.attempt_id].update(shown_rule_ids)
                continue
            start_ms = snapshot.captured_at.timestamp()
            candidates = [
                candidate
                for candidate in intent_snapshots
                if candidate.market == snapshot.market
                and candidate.side == snapshot.side
                and 0 <= candidate.captured_at.timestamp() - start_ms <= 10 * 60
            ]
            if len(candidates) == 1 and candidates[0].attempt_id:
                by_attempt[candidates[0].attempt_id].update(shown_rule_ids)
        return by_attempt

    def _labeled_snapshots(
        self,
        request: GuardrailSuggestionAnalysisRequest,
    ) -> tuple[list[Any], list[str]]:
        labels_by_attempt = self._feedback_labels(request)
        shown_by_attempt = self._shown_rule_ids_by_attempt(request)
        snapshots = []
        labels = []
        for snapshot in sorted(request.snapshots, key=lambda item: item.captured_at):
            if snapshot.snapshot_trigger != "ORDER_INTENT_CLICK":
                continue
            if not snapshot.attempt_id:
                continue
            label = labels_by_attempt.get(snapshot.attempt_id)
            if not label:
                continue
            if shown_by_attempt.get(snapshot.attempt_id):
                snapshot = snapshot.model_copy(
                    update={
                        "shown_rule_ids": sorted(
                            set(snapshot.shown_rule_ids) | shown_by_attempt[snapshot.attempt_id],
                        ),
                    },
                )
            snapshots.append(snapshot)
            labels.append(label)
        return snapshots, labels

    def _source_summary(
        self,
        request: GuardrailSuggestionAnalysisRequest,
        labeled_count: int,
        regretted_count: int,
        planned_count: int,
    ) -> SourceSummary:
        guardrail_trigger_count = sum(
            1
            for snapshot in request.snapshots
            if snapshot.shown_rule_ids or snapshot.primary_shown_rule_id
        )
        return SourceSummary(
            input_sample_count=len(request.snapshots),
            labeled_sample_count=labeled_count,
            regretted_sample_count=regretted_count,
            planned_sample_count=planned_count,
            guardrail_trigger_count=guardrail_trigger_count,
            current_rule_count=len(request.current_rules),
        )

    def _active_days(self, request: GuardrailSuggestionAnalysisRequest) -> int:
        return len({snapshot.captured_at.date().isoformat() for snapshot in request.snapshots})

    def _analysis_result(
        self,
        *,
        status: str,
        reason_code: str | None,
        evidence_count: int = 0,
        active_days: int = 0,
        evaluation_mode: str | None = None,
    ) -> SuggestionAnalysisResult:
        return SuggestionAnalysisResult(
            status=status,
            reasonCode=reason_code,
            evidenceCount=evidence_count,
            activeDays=active_days,
            evaluationMode=evaluation_mode,
        )

    def analyze(
        self,
        request: GuardrailSuggestionAnalysisRequest,
    ) -> GuardrailSuggestionAnalysisResponse:
        started = time.perf_counter()
        diagnostics = AnalysisDiagnostics(algorithm_version=ALGORITHM_VERSION)
        stage = "START"

        try:
            stage = "FEEDBACK_LINKING"
            snapshots, labels = self._labeled_snapshots(request)
            regretted_count = sum(1 for label in labels if label == "REGRETTED")
            planned_count = sum(1 for label in labels if label == "PLANNED")
            source_summary = self._source_summary(
                request,
                labeled_count=len(labels),
                regretted_count=regretted_count,
                planned_count=planned_count,
            )
            active_days = self._active_days(request)

            if len(labels) < request.options.min_total_labeled_samples:
                diagnostics.rejection_reasons.append("insufficient_total_labeled_samples")
                diagnostics.analysis_duration_ms = int((time.perf_counter() - started) * 1000)
                reason = "insufficient_total_labeled_samples"
                return GuardrailSuggestionAnalysisResponse(
                    status="INSUFFICIENT_DATA",
                    algorithmVersion=ALGORITHM_VERSION,
                    sourceSummary=source_summary,
                    newGuardrail=None,
                    modification=None,
                    newAnalysis=self._analysis_result(
                        status="INSUFFICIENT_DATA",
                        reason_code=reason,
                        evidence_count=len(labels),
                        active_days=active_days,
                    ),
                    modificationAnalysis=self._analysis_result(
                        status="INSUFFICIENT_DATA",
                        reason_code=(
                            "no_shown_guardrail_records"
                            if source_summary.guardrail_trigger_count == 0
                            else reason
                        ),
                        evidence_count=source_summary.guardrail_trigger_count,
                        active_days=active_days,
                    ),
                    diagnostics=diagnostics,
                )

            if regretted_count < request.options.min_regretted_samples:
                diagnostics.rejection_reasons.append("insufficient_regretted_samples")
                diagnostics.analysis_duration_ms = int((time.perf_counter() - started) * 1000)
                reason = "insufficient_regretted_samples"
                return GuardrailSuggestionAnalysisResponse(
                    status="INSUFFICIENT_DATA",
                    algorithmVersion=ALGORITHM_VERSION,
                    sourceSummary=source_summary,
                    newGuardrail=None,
                    modification=None,
                    newAnalysis=self._analysis_result(
                        status="INSUFFICIENT_DATA",
                        reason_code=reason,
                        evidence_count=regretted_count,
                        active_days=active_days,
                    ),
                    modificationAnalysis=self._analysis_result(
                        status="INSUFFICIENT_DATA",
                        reason_code=(
                            "no_shown_guardrail_records"
                            if source_summary.guardrail_trigger_count == 0
                            else reason
                        ),
                        evidence_count=source_summary.guardrail_trigger_count,
                        active_days=active_days,
                    ),
                    diagnostics=diagnostics,
                )

            stage = "FEATURE_BUILDING"
            limited_snapshots = snapshots[: request.options.max_records]
            limited_labels = labels[: request.options.max_records]
            features = build_feature_matrix(limited_snapshots)
            diagnostics.used_feature_names = features.used_feature_names
            diagnostics.dropped_feature_names = features.dropped_feature_names

            if features.matrix.shape[1] == 0 or not features.used_feature_names:
                diagnostics.rejection_reasons.append("insufficient_valid_features")
                diagnostics.analysis_duration_ms = int((time.perf_counter() - started) * 1000)
                reason = "insufficient_valid_features"
                return GuardrailSuggestionAnalysisResponse(
                    status="INSUFFICIENT_DATA",
                    algorithmVersion=ALGORITHM_VERSION,
                    sourceSummary=source_summary,
                    newGuardrail=None,
                    modification=None,
                    newAnalysis=self._analysis_result(
                        status="INSUFFICIENT_DATA",
                        reason_code=reason,
                        evidence_count=len(labels),
                        active_days=active_days,
                    ),
                    modificationAnalysis=self._analysis_result(
                        status="INSUFFICIENT_DATA",
                        reason_code=(
                            "no_shown_guardrail_records"
                            if source_summary.guardrail_trigger_count == 0
                            else reason
                        ),
                        evidence_count=source_summary.guardrail_trigger_count,
                        active_days=active_days,
                    ),
                    diagnostics=diagnostics,
                )

            stage = "PREPROCESSING"
            labeled_records = []
            for record, label in zip(features.records, limited_labels, strict=True):
                labeled_records.append({**record, "label": label})

            stage = "CLUSTERING"
            cluster_result = find_behavior_clusters(
                features.matrix,
                min_samples=request.options.min_cluster_samples,
            )
            diagnostics.cluster_count = cluster_result.cluster_count
            diagnostics.noise_count = cluster_result.noise_count

            stage = "CANDIDATE_GENERATION"
            new_candidate, new_rejections, new_before, new_after = generate_new_guardrail_candidate(
                records=labeled_records,
                matrix=features.matrix,
                labels=cluster_result.labels,
                current_rules=request.current_rules,
                field_catalog=request.field_catalog,
                source_window=request.source_window,
            )
            diagnostics.rejection_reasons.extend(new_rejections)
            diagnostics.candidate_count_before_filtering += new_before
            diagnostics.candidate_count_after_filtering += new_after

            modification_candidate = None
            modification_reason_code = None
            if source_summary.guardrail_trigger_count == 0:
                modification_reason_code = "no_shown_guardrail_records"
                diagnostics.rejection_reasons.append(modification_reason_code)
                mod_before = 0
                mod_after = 0
            elif not request.current_rules:
                modification_reason_code = "no_current_rules"
                diagnostics.rejection_reasons.append(modification_reason_code)
                mod_before = 0
                mod_after = 0
            else:
                modification_candidate, mod_rejections, mod_before, mod_after = generate_modification_candidate(
                    records=labeled_records,
                    all_records_matrix=features.matrix,
                    current_rules=request.current_rules,
                    field_catalog=request.field_catalog,
                    source_window=request.source_window,
                )
                diagnostics.rejection_reasons.extend(mod_rejections)
                if mod_rejections and not modification_candidate:
                    modification_reason_code = mod_rejections[0]
            diagnostics.candidate_count_before_filtering += mod_before
            diagnostics.candidate_count_after_filtering += mod_after

            if (
                cluster_result.cluster_count == 0
                and not modification_candidate
            ):
                diagnostics.rejection_reasons.append("all_clusters_noise")
                diagnostics.analysis_duration_ms = int((time.perf_counter() - started) * 1000)
                return GuardrailSuggestionAnalysisResponse(
                    status="NO_SUGGESTION",
                    algorithmVersion=ALGORITHM_VERSION,
                    sourceSummary=source_summary,
                    newGuardrail=None,
                    modification=None,
                    newAnalysis=self._analysis_result(
                        status="NO_SUGGESTION",
                        reason_code="all_clusters_noise",
                        evidence_count=len(labels),
                        active_days=active_days,
                        evaluation_mode="IN_SAMPLE",
                    ),
                    modificationAnalysis=self._analysis_result(
                        status="INSUFFICIENT_DATA"
                        if modification_reason_code in {"no_shown_guardrail_records", "no_current_rules"}
                        else "NO_SUGGESTION",
                        reason_code=modification_reason_code or "all_clusters_noise",
                        evidence_count=source_summary.guardrail_trigger_count,
                        active_days=active_days,
                        evaluation_mode=None
                        if modification_reason_code in {"no_shown_guardrail_records", "no_current_rules"}
                        else "IN_SAMPLE",
                    ),
                    diagnostics=diagnostics,
                )

            explanation_ok = True
            new_suggestion = None
            if new_candidate:
                stage = "LLM_EXPLANATION"
                explanation, ok = self._explain(
                    "NEW_GUARDRAIL",
                    {
                        "type": "NEW_GUARDRAIL",
                        "expression": new_candidate.proposed_rule.expression,
                        "representativeValues": new_candidate.representative_values,
                        "evidenceCount": new_candidate.evidence_count,
                        "simulation": new_candidate.simulation.model_dump(),
                        "clusterMetrics": new_candidate.cluster_metrics,
                    },
                )
                explanation_ok = explanation_ok and ok
                proposed_rule = new_candidate.proposed_rule.model_copy(
                    update={
                        "name": explanation.rule_name,
                        "description": explanation.rule_description,
                        "warning_title": explanation.warning_title,
                        "warning_message": explanation.warning_message,
                    },
                )
                new_suggestion = NewGuardrailSuggestion(
                    candidateKey=attach_candidate_key(
                        algorithm_version=ALGORITHM_VERSION,
                        suggestion_type="NEW_GUARDRAIL",
                        expression=proposed_rule.expression,
                        rule_id="NEW",
                        source_window=request.source_window,
                        field_catalog=request.field_catalog,
                    ),
                    type="NEW_GUARDRAIL",
                    proposedRule=proposed_rule,
                    explanation=explanation,
                    evidenceCount=new_candidate.evidence_count,
                    confidence=new_candidate.confidence,
                    representativeValues=new_candidate.representative_values,
                    simulation=new_candidate.simulation,
                    sourceWindow=new_candidate.source_window,
                )

            modification_suggestion = None
            if modification_candidate:
                stage = "LLM_EXPLANATION"
                explanation, ok = self._explain(
                    "MODIFY_GUARDRAIL",
                    {
                        "type": "MODIFY_GUARDRAIL",
                        "ruleId": modification_candidate.rule_id,
                        "baseRuleHash": modification_candidate.base_rule_hash,
                        "expression": modification_candidate.proposed_rule.expression,
                        "diff": [item.model_dump() for item in modification_candidate.diff],
                        "representativeValues": modification_candidate.representative_values,
                        "evidenceCount": modification_candidate.evidence_count,
                        "currentSimulation": modification_candidate.current_simulation.model_dump(),
                        "proposedSimulation": modification_candidate.proposed_simulation.model_dump(),
                    },
                )
                explanation_ok = explanation_ok and ok
                proposed_rule = modification_candidate.proposed_rule.model_copy(
                    update={
                        "description": explanation.rule_description,
                        "warning_title": explanation.warning_title,
                        "warning_message": explanation.warning_message,
                    },
                )
                modification_suggestion = GuardrailModificationSuggestion(
                    candidateKey=attach_candidate_key(
                        algorithm_version=ALGORITHM_VERSION,
                        suggestion_type="MODIFY_GUARDRAIL",
                        expression=proposed_rule.expression,
                        rule_id=modification_candidate.rule_id,
                        source_window=request.source_window,
                        field_catalog=request.field_catalog,
                    ),
                    type="MODIFY_GUARDRAIL",
                    ruleId=modification_candidate.rule_id,
                    baseRuleHash=modification_candidate.base_rule_hash,
                    proposedRule=proposed_rule,
                    diff=modification_candidate.diff,
                    explanation=explanation,
                    evidenceCount=modification_candidate.evidence_count,
                    confidence=modification_candidate.confidence,
                    representativeValues=modification_candidate.representative_values,
                    currentSimulation=modification_candidate.current_simulation,
                    proposedSimulation=modification_candidate.proposed_simulation,
                    sourceWindow=modification_candidate.source_window,
                )

            diagnostics.explanation_status = "COMPLETED" if explanation_ok else "FALLBACK"
            status = "AVAILABLE" if new_suggestion or modification_suggestion else "NO_SUGGESTION"
            new_analysis = self._analysis_result(
                status="AVAILABLE" if new_suggestion else "NO_SUGGESTION",
                reason_code=None if new_suggestion else "no_valid_new_candidate",
                evidence_count=new_suggestion.evidence_count if new_suggestion else len(labels),
                active_days=active_days,
                evaluation_mode="IN_SAMPLE" if new_suggestion else None,
            )
            modification_analysis = self._analysis_result(
                status="AVAILABLE"
                if modification_suggestion
                else (
                    "INSUFFICIENT_DATA"
                    if modification_reason_code in {"no_shown_guardrail_records", "no_current_rules"}
                    else "NO_SUGGESTION"
                ),
                reason_code=None if modification_suggestion else modification_reason_code or "no_valid_modification_candidate",
                evidence_count=modification_suggestion.evidence_count if modification_suggestion else source_summary.guardrail_trigger_count,
                active_days=active_days,
                evaluation_mode="IN_SAMPLE" if modification_suggestion else None,
            )
            diagnostics.analysis_duration_ms = int((time.perf_counter() - started) * 1000)
            logger.info(
                "Guardrail suggestion analysis completed",
                extra={
                    "http_status": 200,
                    "analysis_status": status,
                    "error_stage": None,
                    "error_code": None,
                    "input_sample_count": source_summary.input_sample_count,
                    "labeled_sample_count": source_summary.labeled_sample_count,
                    "regretted_sample_count": source_summary.regretted_sample_count,
                    "shown_guardrail_count": source_summary.guardrail_trigger_count,
                    "used_feature_count": len(diagnostics.used_feature_names),
                    "dropped_feature_count": len(diagnostics.dropped_feature_names),
                    "analysis_duration_ms": diagnostics.analysis_duration_ms,
                },
            )
            return GuardrailSuggestionAnalysisResponse(
                status=status,
                algorithmVersion=ALGORITHM_VERSION,
                sourceSummary=source_summary,
                newGuardrail=new_suggestion,
                modification=modification_suggestion,
                newAnalysis=new_analysis,
                modificationAnalysis=modification_analysis,
                diagnostics=diagnostics,
            )
        except Exception:
            logger.exception("Guardrail suggestion analysis failed")
            diagnostics.rejection_reasons.append("unexpected_analysis_error")
            diagnostics.error_stage = stage
            diagnostics.error_code = "INTERNAL_ANALYSIS_ERROR"
            diagnostics.analysis_duration_ms = int((time.perf_counter() - started) * 1000)
            source_summary = self._source_summary(
                request,
                labeled_count=0,
                regretted_count=0,
                planned_count=0,
            )
            return GuardrailSuggestionAnalysisResponse(
                status="ERROR",
                algorithmVersion=ALGORITHM_VERSION,
                errorCode="INTERNAL_ANALYSIS_ERROR",
                errorStage=stage,
                sourceSummary=source_summary,
                newGuardrail=None,
                modification=None,
                newAnalysis=self._analysis_result(
                    status="ERROR",
                    reason_code="INTERNAL_ANALYSIS_ERROR",
                    evidence_count=0,
                    active_days=self._active_days(request),
                ),
                modificationAnalysis=self._analysis_result(
                    status="ERROR",
                    reason_code="INTERNAL_ANALYSIS_ERROR",
                    evidence_count=0,
                    active_days=self._active_days(request),
                ),
                diagnostics=diagnostics,
            )
