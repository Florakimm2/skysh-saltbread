from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

ALGORITHM_VERSION = "guardrail-suggestions-v2"


class StrictBaseModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
        str_strip_whitespace=True,
    )


class SourceWindow(StrictBaseModel):
    from_at: datetime
    to_at: datetime


class GuardrailAnalysisOptions(StrictBaseModel):
    max_history_days: int = 90
    max_records: int = 1000
    min_total_labeled_samples: int = 20
    min_regretted_samples: int = 5
    min_cluster_samples: int = 5
    max_new_suggestions: int = 1
    max_modification_suggestions: int = 1
    random_state: int = 42

    @field_validator("max_history_days", "max_records", "min_total_labeled_samples")
    @classmethod
    def positive_int(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("must be positive")
        return value


class SnapshotFeatureRecord(StrictBaseModel):
    record_id: str = Field(alias="recordId")
    attempt_id: str | None = Field(default=None, alias="attemptId")
    snapshot_id: str | None = Field(default=None, alias="snapshotId")
    snapshot_trigger: Literal["GUARDRAIL_SHOWN", "ORDER_INTENT_CLICK"] = Field(
        alias="snapshotTrigger",
    )
    captured_at: datetime = Field(alias="capturedAt")

    market: str | None = None
    side: Literal["BUY", "SELL", "UNKNOWN"] = "UNKNOWN"
    order_mode: Literal["LIMIT", "MARKET", "BEST", "RESERVED", "UNKNOWN"] = Field(
        default="UNKNOWN",
        alias="orderMode",
    )
    entry_point: str | None = Field(default=None, alias="entryPoint")
    allocation_preset_percent: int | float | str | None = Field(
        default=None,
        alias="allocationPresetPercent",
    )
    mode_changed_to_market: bool | None = Field(
        default=None,
        alias="modeChangedToMarket",
    )

    requested_balance_ratio: float | str | None = Field(
        default=None,
        alias="requestedBalanceRatio",
    )
    draft_duration_ms: float | str | None = Field(default=None, alias="draftDurationMs")
    last_edit_to_snapshot_ms: float | str | None = Field(
        default=None,
        alias="lastEditToSnapshotMs",
    )
    draft_edit_count: float | str | None = Field(default=None, alias="draftEditCount")
    amount_change_rate: float | str | None = Field(default=None, alias="amountChangeRate")
    orderbook_click_to_snapshot_ms: float | str | None = Field(
        default=None,
        alias="orderbookClickToSnapshotMs",
    )
    order_intent_count_1m: float | str | None = Field(
        default=None,
        alias="orderIntentCount1m",
    )
    actual_order_created_count_10m: float | str | None = Field(
        default=None,
        alias="actualOrderCreatedCount10m",
    )
    same_side_intent_count_1m: float | str | None = Field(
        default=None,
        alias="sameSideIntentCount1m",
    )
    market_change_count_5m: float | str | None = Field(
        default=None,
        alias="marketChangeCount5m",
    )
    side_change_count_3m: float | str | None = Field(
        default=None,
        alias="sideChangeCount3m",
    )
    price_edit_count_3m: float | str | None = Field(
        default=None,
        alias="priceEditCount3m",
    )
    quantity_edit_count_3m: float | str | None = Field(
        default=None,
        alias="quantityEditCount3m",
    )
    amount_edit_count_3m: float | str | None = Field(
        default=None,
        alias="amountEditCount3m",
    )
    input_revert_count: float | str | None = Field(default=None, alias="inputRevertCount")
    price_direction_change_count: float | str | None = Field(
        default=None,
        alias="priceDirectionChangeCount",
    )
    price_change_rate: float | str | None = Field(default=None, alias="priceChangeRate")
    order_mode_change_count_3m: float | str | None = Field(
        default=None,
        alias="orderModeChangeCount3m",
    )
    draft_reset_count_3m: float | str | None = Field(
        default=None,
        alias="draftResetCount3m",
    )
    short_term_return_5m: float | str | None = Field(
        default=None,
        alias="shortTermReturn5m",
    )
    signed_change_rate: float | str | None = Field(default=None, alias="signedChangeRate")
    spread_rate: float | str | None = Field(default=None, alias="spreadRate")
    price_position_in_5m_range: float | str | None = Field(
        default=None,
        alias="pricePositionIn5mRange",
    )
    volume_spike_ratio_5m: float | str | None = Field(
        default=None,
        alias="volumeSpikeRatio5m",
    )
    price_vs_avg_buy_rate_at_snapshot: float | str | None = Field(
        default=None,
        alias="priceVsAvgBuyRateAtSnapshot",
    )

    matched_rule_ids_at_snapshot: list[str] = Field(
        default_factory=list,
        alias="matchedRuleIdsAtSnapshot",
    )
    primary_shown_rule_id: str | None = Field(default=None, alias="primaryShownRuleId")
    shown_rule_ids: list[str] = Field(default_factory=list, alias="shownRuleIds")

    def feature_dict(self) -> dict[str, Any]:
        return self.model_dump(by_alias=True)


class ReactionRecord(StrictBaseModel):
    record_id: str = Field(alias="recordId")
    snapshot_id: str = Field(alias="snapshotId")
    action: Literal["PROCEED", "REVIEW", "CLOSE"]
    reacted_at: datetime = Field(alias="reactedAt")


class FeedbackRecord(StrictBaseModel):
    record_id: str = Field(alias="recordId")
    attempt_id: str = Field(alias="attemptId")
    feedback_status: Literal["ANSWERED", "DISMISSED"] = Field(alias="feedbackStatus")
    self_assessment: Literal["PLANNED", "EMOTIONAL"] | None = Field(
        default=None,
        alias="selfAssessment",
    )
    responded_at: datetime = Field(alias="respondedAt")


class ConfirmedTradeRecord(StrictBaseModel):
    record_id: str = Field(alias="recordId")
    attempt_id: str | None = Field(default=None, alias="attemptId")
    order_created_at: datetime = Field(alias="orderCreatedAt")
    market: str | None = None
    side: str | None = None
    ord_type: str | None = Field(default=None, alias="ordType")
    state: str | None = None
    executed_volume: str | None = Field(default=None, alias="executedVolume")
    executed_funds: str | None = Field(default=None, alias="executedFunds")
    paid_fee: str | None = Field(default=None, alias="paidFee")
    remaining_volume: str | None = Field(default=None, alias="remainingVolume")
    outcome_observed_at: datetime | None = Field(default=None, alias="outcomeObservedAt")


class RuleFieldDefinitionInput(StrictBaseModel):
    key: str
    value_type: str = Field(alias="valueType")
    nullable: bool = True
    rule_eligible: bool = Field(default=True, alias="ruleEligible")
    requires_private_api: bool = Field(default=False, alias="requiresPrivateApi")
    supported_operators: list[str] = Field(default_factory=list, alias="supportedOperators")
    comparison_group: str | None = Field(default=None, alias="comparisonGroup")
    input: dict[str, Any] = Field(default_factory=dict)


RuleExpression = dict[str, Any]


class GuardrailRuleInput(StrictBaseModel):
    rule_id: str = Field(alias="ruleId")
    name: str
    description: str | None = None
    is_enabled: bool = Field(default=True, alias="isEnabled")
    priority: int = 999
    risk_level: Literal["LOW", "MEDIUM", "HIGH"] = Field(default="MEDIUM", alias="riskLevel")
    visual_mode: Literal["CURIOUS", "SURPRISED", "FAST_BURN", "SCARED", "SAD"] = Field(
        default="CURIOUS",
        alias="visualMode",
    )
    expression: RuleExpression
    warning_title: str = Field(alias="warningTitle")
    warning_message: str = Field(alias="warningMessage")
    requires_private_api: bool = Field(default=False, alias="requiresPrivateApi")
    schema_version: str = Field(default="v1", alias="schemaVersion")
    updated_at: str | None = Field(default=None, alias="updatedAt")


class GuardrailSuggestionAnalysisRequest(StrictBaseModel):
    analysis_date: str
    week_key: str | None = None
    period_start: datetime | None = None
    period_end: datetime | None = None
    timezone: str
    source_window: SourceWindow
    snapshots: list[SnapshotFeatureRecord] = Field(default_factory=list)
    reactions: list[ReactionRecord] = Field(default_factory=list)
    feedbacks: list[FeedbackRecord] = Field(default_factory=list)
    confirmed_trades: list[ConfirmedTradeRecord] = Field(
        default_factory=list,
        alias="confirmedTrades",
    )
    current_rules: list[GuardrailRuleInput] = Field(
        default_factory=list,
        alias="currentRules",
    )
    field_catalog: dict[str, RuleFieldDefinitionInput] = Field(alias="fieldCatalog")
    options: GuardrailAnalysisOptions = Field(default_factory=GuardrailAnalysisOptions)


class SourceSummary(StrictBaseModel):
    input_sample_count: int
    labeled_sample_count: int
    regretted_sample_count: int
    planned_sample_count: int
    guardrail_trigger_count: int
    current_rule_count: int


class AnalysisDiagnostics(StrictBaseModel):
    used_feature_names: list[str] = Field(default_factory=list)
    dropped_feature_names: list[str] = Field(default_factory=list)
    cluster_count: int = 0
    noise_count: int = 0
    candidate_count_before_filtering: int = 0
    candidate_count_after_filtering: int = 0
    rejection_reasons: list[str] = Field(default_factory=list)
    analysis_duration_ms: int = 0
    algorithm_version: str = ALGORITHM_VERSION
    explanation_status: Literal["COMPLETED", "FALLBACK"] = "COMPLETED"
    error_code: str | None = None
    error_stage: str | None = None


class SuggestionExplanation(StrictBaseModel):
    title: str
    rationale: str
    evidence_summary: str
    expected_change: str
    caution: str
    rule_name: str
    rule_description: str
    warning_title: str
    warning_message: str


class RuleSimulationResult(StrictBaseModel):
    trigger_count: int
    support: int
    coverage: float
    precision: float | None
    recall: float | None
    false_positive_rate: float | None
    planned_trigger_rate: float | None
    regretted_capture_rate: float | None
    lift: float | None


class ProposedGuardrailRule(StrictBaseModel):
    rule_id: str | None = Field(default=None, alias="ruleId")
    name: str
    description: str | None = None
    is_enabled: bool = Field(default=True, alias="isEnabled")
    priority: int = 999
    risk_level: Literal["LOW", "MEDIUM", "HIGH"] = Field(alias="riskLevel")
    visual_mode: Literal["CURIOUS", "SURPRISED", "FAST_BURN", "SCARED", "SAD"] = Field(
        alias="visualMode",
    )
    expression: RuleExpression
    warning_title: str = Field(alias="warningTitle")
    warning_message: str = Field(alias="warningMessage")
    requires_private_api: bool = Field(alias="requiresPrivateApi")
    schema_version: str = Field(default="v1", alias="schemaVersion")


class RuleChangeDiff(StrictBaseModel):
    path: str
    before: Any
    after: Any
    reason: str


class NewGuardrailSuggestion(StrictBaseModel):
    candidate_key: str = Field(alias="candidateKey")
    type: Literal["NEW_GUARDRAIL"]
    proposed_rule: ProposedGuardrailRule = Field(alias="proposedRule")
    explanation: SuggestionExplanation
    evidence_count: int = Field(alias="evidenceCount")
    confidence: float = Field(ge=0, le=1)
    representative_values: dict[str, Any] = Field(alias="representativeValues")
    simulation: RuleSimulationResult
    source_window: SourceWindow = Field(alias="sourceWindow")


class GuardrailModificationSuggestion(StrictBaseModel):
    candidate_key: str = Field(alias="candidateKey")
    type: Literal["MODIFY_GUARDRAIL"]
    rule_id: str = Field(alias="ruleId")
    base_rule_hash: str = Field(alias="baseRuleHash")
    proposed_rule: ProposedGuardrailRule = Field(alias="proposedRule")
    diff: list[RuleChangeDiff]
    explanation: SuggestionExplanation
    evidence_count: int = Field(alias="evidenceCount")
    confidence: float = Field(ge=0, le=1)
    representative_values: dict[str, Any] = Field(alias="representativeValues")
    current_simulation: RuleSimulationResult = Field(alias="currentSimulation")
    proposed_simulation: RuleSimulationResult = Field(alias="proposedSimulation")
    source_window: SourceWindow = Field(alias="sourceWindow")


class SuggestionAnalysisResult(StrictBaseModel):
    status: Literal["AVAILABLE", "INSUFFICIENT_DATA", "NO_SUGGESTION", "ERROR"]
    reason_code: str | None = Field(default=None, alias="reasonCode")
    evidence_count: int = Field(default=0, alias="evidenceCount")
    active_days: int = Field(default=0, alias="activeDays")
    evaluation_mode: Literal["IN_SAMPLE", "TEMPORAL_HOLDOUT"] | None = Field(
        default=None,
        alias="evaluationMode",
    )


class GuardrailSuggestionAnalysisResponse(StrictBaseModel):
    status: Literal["AVAILABLE", "INSUFFICIENT_DATA", "NO_SUGGESTION", "ERROR"]
    algorithm_version: str = Field(alias="algorithmVersion")
    error_code: str | None = Field(default=None, alias="errorCode")
    error_stage: str | None = Field(default=None, alias="errorStage")
    source_summary: SourceSummary = Field(alias="sourceSummary")
    new_guardrail: NewGuardrailSuggestion | None = Field(default=None, alias="newGuardrail")
    modification: GuardrailModificationSuggestion | None = None
    new_analysis: SuggestionAnalysisResult | None = Field(default=None, alias="newAnalysis")
    modification_analysis: SuggestionAnalysisResult | None = Field(
        default=None,
        alias="modificationAnalysis",
    )
    diagnostics: AnalysisDiagnostics
