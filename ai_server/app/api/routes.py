import hmac
import logging
from typing import Annotated, Protocol

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from fastapi.concurrency import run_in_threadpool

from app.config import Settings
from app.models import (
    AnalyzeRequest,
    ErrorResponse,
    HealthResponse,
    InsightResponse,
)
from app.services.insight_analyzer import (
    AnalyzerTimeoutError,
    AnalyzerUpstreamError,
    InsightAnalyzer,
)
# ┌─────────────────────────────────────────────────────────┐
# │ 추가: 필드 분석기 import                                  │
# └─────────────────────────────────────────────────────────┘
from app.services.field_insight_analyzer import (
    FieldAnalyzeRequest,
    FieldInsightAnalyzer,
    FieldInsightResponse,
    AnalyzerTimeoutError as FieldTimeoutError,
    AnalyzerUpstreamError as FieldUpstreamError,
)

logger = logging.getLogger(__name__)
router = APIRouter()


class Analyzer(Protocol):
    def analyze(self, summaries: list[str]) -> InsightResponse: ...


def _settings(request: Request) -> Settings:
    return request.app.state.settings


def _analyzer(request: Request) -> Analyzer:
    analyzer = request.app.state.analyzer
    if analyzer is not None:
        return analyzer

    with request.app.state.analyzer_lock:
        analyzer = request.app.state.analyzer
        if analyzer is not None:
            return analyzer

        settings = _settings(request)
        if settings.openai_api_key is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="OPENAI_API_KEY is not configured",
            )

        try:
            analyzer = InsightAnalyzer(
                api_key=settings.openai_api_key,
                model=settings.openai_model,
                temperature=settings.openai_temperature,
                timeout_seconds=settings.openai_timeout_seconds,
            )
        except (ImportError, ValueError):
            logger.exception("Insight analyzer initialization failed")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Analysis service is not available",
            ) from None

        request.app.state.analyzer = analyzer
        return analyzer


# ┌─────────────────────────────────────────────────────────┐
# │ 추가: 필드 분석기 의존성 함수                               │
# └─────────────────────────────────────────────────────────┘
def _field_analyzer(request: Request) -> FieldInsightAnalyzer:
    analyzer = getattr(request.app.state, "field_analyzer", None)
    if analyzer is not None:
        return analyzer

    with request.app.state.analyzer_lock:
        analyzer = getattr(request.app.state, "field_analyzer", None)
        if analyzer is not None:
            return analyzer

        settings = _settings(request)
        if settings.openai_api_key is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="OPENAI_API_KEY is not configured",
            )

        try:
            analyzer = FieldInsightAnalyzer(
                api_key=settings.openai_api_key,
                model=settings.openai_model,
                temperature=settings.openai_temperature,
                timeout_seconds=settings.openai_timeout_seconds,
            )
        except (ImportError, ValueError):
            logger.exception("Field insight analyzer initialization failed")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Field analysis service is not available",
            ) from None

        request.app.state.field_analyzer = analyzer
        return analyzer


def _verify_service_api_key(
    request: Request,
    x_api_key: Annotated[str | None, Header()] = None,
) -> None:
    expected_key = _settings(request).service_api_key

    if expected_key is None:
        logger.error("SERVICE_API_KEY is not configured in the server environment.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Server configuration error: API Key is not set.",
        )

    if x_api_key is None or not hmac.compare_digest(x_api_key, expected_key):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing API key",
            headers={"WWW-Authenticate": "ApiKey"},
        )


@router.get("/", include_in_schema=False)
async def root() -> dict[str, str]:
    return {"service": "Trading Insight API", "docs": "/docs"}


@router.get("/health/live", response_model=HealthResponse, tags=["health"])
async def liveness() -> HealthResponse:
    return HealthResponse(status="ok")


@router.get(
    "/health/ready",
    response_model=HealthResponse,
    responses={503: {"model": ErrorResponse}},
    tags=["health"],
)
async def readiness(
    _configured_analyzer: Annotated[Analyzer, Depends(_analyzer)],
) -> HealthResponse:
    return HealthResponse(status="ready")


@router.post(
    "/api/v1/insights/analyze",
    response_model=InsightResponse,
    responses={
        401: {"model": ErrorResponse},
        502: {"model": ErrorResponse},
        503: {"model": ErrorResponse},
        504: {"model": ErrorResponse},
    },
    tags=["insights"],
    dependencies=[Depends(_verify_service_api_key)],
)
async def analyze_insight(
    payload: AnalyzeRequest,
    analyzer: Annotated[Analyzer, Depends(_analyzer)],
) -> InsightResponse:
    try:
        return await run_in_threadpool(
            analyzer.analyze,
            payload.summaries,
        )
    except AnalyzerTimeoutError:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="The analysis provider timed out",
        ) from None
    except AnalyzerUpstreamError:
        logger.exception("Upstream analysis failed")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="The analysis provider returned an invalid response",
        ) from None


# ┌─────────────────────────────────────────────────────────┐
# │ 추가: 필드별 상세 분석 엔드포인트                            │
# └─────────────────────────────────────────────────────────┘
@router.post(
    "/api/v1/insights/field-analyze",
    response_model=FieldInsightResponse,
    responses={
        401: {"model": ErrorResponse},
        502: {"model": ErrorResponse},
        503: {"model": ErrorResponse},
        504: {"model": ErrorResponse},
    },
    tags=["insights"],
    dependencies=[Depends(_verify_service_api_key)],
)
async def analyze_field_insight(
    payload: FieldAnalyzeRequest,
    analyzer: Annotated[FieldInsightAnalyzer, Depends(_field_analyzer)],
) -> FieldInsightResponse:
    try:
        return await run_in_threadpool(
            analyzer.analyze,
            payload.summaries,
        )
    except FieldTimeoutError:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="The field analysis provider timed out",
        ) from None
    except FieldUpstreamError:
        logger.exception("Field upstream analysis failed")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="The field analysis provider returned an invalid response",
        ) from None