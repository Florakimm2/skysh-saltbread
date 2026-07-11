# ai-server/app/services/field_insight_analyzer.py
#
# 스냅샷 필드 집계 데이터를 받아 주제(토픽)별 아코디언 카드 형태의
# AI 인사이트를 생성하는 분석기.
# 기존 insight_analyzer.py와 병렬로 동작하며, 별도 엔드포인트에서 호출된다.

from collections.abc import Sequence
from typing import Any

from langchain_core.output_parsers import PydanticOutputParser
from langchain_core.prompts import PromptTemplate
from langchain_openai import ChatOpenAI
from pydantic import BaseModel, ConfigDict, Field


# ─── Pydantic 모델 ───

class FieldTopicAnalysis(BaseModel):
    """AI가 생성하는 주제별 분석 카드 1장"""
    topic_key: str = Field(description="주제 식별 키 (ORDER_INFO, BEHAVIOR_TIMING 등)")
    topic_label: str = Field(description="주제 이모지 포함 제목 (📊 주문 정보 분석 등)")
    headline: str = Field(description="해당 주제의 핵심 판단을 한 줄로 요약 (15자 이내)")
    analysis: str = Field(description="해당 주제의 데이터를 분석한 2~3문장 설명")
    severity: str = Field(description="good / caution / warning 중 하나")


class FieldInsightLLMResponse(BaseModel):
    """LLM이 반환하는 전체 응답"""
    model_config = ConfigDict(extra="forbid")
    topics: list[FieldTopicAnalysis] = Field(
        min_length=5, max_length=5,
        description="5개 주제별 분석 카드"
    )
    one_line_advice: str = Field(
        description="모든 분석을 종합한 사용자 개선 제안 한 줄 (30자 이내)"
    )


class FieldInsightResponse(BaseModel):
    """프론트엔드에 반환하는 최종 응답"""
    model_config = ConfigDict(extra="forbid")
    topics: list[FieldTopicAnalysis]
    one_line_advice: str


class FieldAnalyzeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    summaries: list[str] = Field(
        min_length=1,
        max_length=100,
        description="snapshot-field-aggregator에서 생성한 집계 텍스트 라인들",
    )


# ─── 프롬프트 ───

FIELD_INSIGHT_PROMPT = """당신은 암호화폐 개인 투자자의 매매 행동 데이터를 분석하는 전문 AI 어드바이저입니다.

[역할]
아래 [필드 집계 데이터]에는 사용자의 최근 주문 스냅샷을 5개 주제별로 집계한 정량 지표가 포함되어 있습니다.
각 주제의 데이터를 분석하여 해당 주제에 대한 판단과 설명을 작성하세요.

[5개 분석 주제]
1. ORDER_INFO (📊 주문 정보 분석): 주문 금액, 매수/매도 비율, 지정가/시장가 비율, 거래 종목 다양성 등
2. BEHAVIOR_TIMING (⏱️ 주문 작성 행동): 주문 작성 소요 시간, 수정 후 제출까지 시간, 충동 매매 여부 등
3. FREQUENCY_PATTERNS (🔄 반복·수정 패턴): 연타 주문, 매수매도 전환, 가격/금액 반복 수정, 종목 이동 빈도 등
4. MARKET_CONTEXT (📈 시장 상황 맥락): 주문 시점의 등락률, 거래량 급증, 스프레드, 위험 플래그 등
5. PERSONAL_API (🔑 개인 계좌 기반 분석): 평균 매입가 대비 현재가, 실제 체결 빈도 등

[작성 규칙]
1. 각 주제(topic)마다 아래 필드를 작성하세요:
   - topic_key: 위 5개 키 중 하나
   - topic_label: 이모지 포함 제목 (위 괄호 안 텍스트 그대로)
   - headline: 핵심 판단 한 줄 (15자 이내). 예: "안정적인 매매 규모", "충동 매매 주의", "과도한 연타 패턴"
   - analysis: 데이터 수치를 근거로 삼아 2~3문장으로 분석. 구체적 수치는 쓰지 말고 추상화하세요.
     예: "평균보다 큰 금액으로 매수하는 경향이 있으며..." (O)
         "평균 매수 금액이 523,000원이며..." (X)
   - severity: 해당 주제의 상태를 아래 기준으로 판정
     * "good": 안정적이거나 양호한 상태
     * "caution": 약간의 주의가 필요한 상태
     * "warning": 명확한 위험 신호가 감지된 상태

2. severity 판정 가이드:
   - ORDER_INFO: 평균 주문 비중이 50%를 넘거나 단일 주문이 평균의 5배 이상이면 warning
   - BEHAVIOR_TIMING: 최단 작성 시간이 3초 미만이거나 평균 작성 시간이 5초 미만이면 caution 이상
   - FREQUENCY_PATTERNS: 1분 내 주문 시도가 평균 3회 이상이면 warning, 수정 횟수가 5회 이상이면 caution
   - MARKET_CONTEXT: 주문 시 평균 등락률이 5% 이상이거나 거래량 급증 3배 이상이면 caution 이상
   - PERSONAL_API: 데이터가 없으면 caution (연결 권장), 손실 상태 거래가 과반이면 warning

3. one_line_advice: 5개 주제의 분석을 종합하여, 사용자가 가장 먼저 개선했으면 하는 점을 한 줄(30자 이내)로 작성하세요.
   - warning이 있는 주제를 우선 반영하세요.
   - 예: "주문 전 5초간 호흡을 고르는 습관을 들여보세요."
   - 예: "한 종목에 집중하고 종목 이동을 줄여보세요."

4. 금지 사항:
   - 데이터에 없는 사실을 추측하지 마세요.
   - 구체적 금액, 가격, 퍼센트 수치를 analysis에 포함하지 마세요.
   - "데이터 없음"으로 표시된 항목은 해당 항목의 데이터가 수집되지 않았다는 의미이므로, 분석 불가로 처리하세요.

[필드 집계 데이터]
{summary_bundle}

{format_instructions}"""


# ─── 분석기 클래스 ───

class AnalyzerTimeoutError(RuntimeError):
    pass

class AnalyzerUpstreamError(RuntimeError):
    pass


class FieldInsightAnalyzer:
    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        temperature: float,
        timeout_seconds: float,
    ) -> None:
        parser = PydanticOutputParser(pydantic_object=FieldInsightLLMResponse)
        prompt = PromptTemplate(
            template=FIELD_INSIGHT_PROMPT,
            input_variables=["summary_bundle"],
            partial_variables={
                "format_instructions": parser.get_format_instructions()
            },
        )
        llm = ChatOpenAI(
            model=model,
            temperature=temperature,
            api_key=api_key,
            timeout=timeout_seconds,
            max_retries=2,
        )
        self._chain: Any = prompt | llm | parser

    def analyze(self, summaries: Sequence[str]) -> FieldInsightResponse:
        summary_bundle = "\n".join(
            f"{idx}. {line}" for idx, line in enumerate(summaries, start=1)
        )

        try:
            llm_result: FieldInsightLLMResponse = self._chain.invoke(
                {"summary_bundle": summary_bundle}
            )
            return FieldInsightResponse(
                topics=llm_result.topics,
                one_line_advice=llm_result.one_line_advice,
            )
        except Exception as exc:
            timeout_names = {"APITimeoutError", "ConnectTimeout", "ReadTimeout"}
            if isinstance(exc, TimeoutError) or type(exc).__name__ in timeout_names:
                raise AnalyzerTimeoutError from exc
            raise AnalyzerUpstreamError from exc


# ─── FastAPI 라우트 추가분 ───
# 기존 routes.py에 아래 라우트를 추가하세요.
#
# from app.services.field_insight_analyzer import (
#     FieldAnalyzeRequest,
#     FieldInsightAnalyzer,
#     FieldInsightResponse,
#     AnalyzerTimeoutError as FieldTimeoutError,
#     AnalyzerUpstreamError as FieldUpstreamError,
# )
#
# def _field_analyzer(request: Request) -> FieldInsightAnalyzer:
#     analyzer = getattr(request.app.state, "field_analyzer", None)
#     if analyzer is not None:
#         return analyzer
#
#     with request.app.state.analyzer_lock:
#         analyzer = getattr(request.app.state, "field_analyzer", None)
#         if analyzer is not None:
#             return analyzer
#
#         settings = _settings(request)
#         if settings.openai_api_key is None:
#             raise HTTPException(
#                 status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
#                 detail="OPENAI_API_KEY is not configured",
#             )
#
#         analyzer = FieldInsightAnalyzer(
#             api_key=settings.openai_api_key,
#             model=settings.openai_model,
#             temperature=settings.openai_temperature,
#             timeout_seconds=settings.openai_timeout_seconds,
#         )
#         request.app.state.field_analyzer = analyzer
#         return analyzer
#
#
# @router.post(
#     "/api/v1/insights/field-analyze",
#     response_model=FieldInsightResponse,
#     responses={
#         401: {"model": ErrorResponse},
#         502: {"model": ErrorResponse},
#         504: {"model": ErrorResponse},
#     },
#     tags=["insights"],
#     dependencies=[Depends(_verify_service_api_key)],
# )
# async def analyze_field_insight(
#     payload: FieldAnalyzeRequest,
#     analyzer: Annotated[FieldInsightAnalyzer, Depends(_field_analyzer)],
# ) -> FieldInsightResponse:
#     try:
#         return await run_in_threadpool(analyzer.analyze, payload.summaries)
#     except FieldTimeoutError:
#         raise HTTPException(status_code=504, detail="Analysis timed out") from None
#     except FieldUpstreamError:
#         raise HTTPException(status_code=502, detail="Analysis failed") from None