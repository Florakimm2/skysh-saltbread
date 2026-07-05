"""기존 import 경로를 위한 호환 모듈.

새 HTTP 애플리케이션의 진입점은 ``app.main:app`` 입니다.
"""

from app.config import Settings
from app.models import InsightResponse
from app.services.insight_analyzer import InsightAnalyzer as _InsightAnalyzer


class InsightAnalyzer(_InsightAnalyzer):
    """환경변수를 사용하는 기존 무인자 생성자 호환 래퍼."""

    def __init__(self) -> None:
        settings = Settings.from_env()
        if settings.openai_api_key is None:
            raise RuntimeError("OPENAI_API_KEY is not configured")
        super().__init__(
            api_key=settings.openai_api_key,
            model=settings.openai_model,
            temperature=settings.openai_temperature,
            timeout_seconds=settings.openai_timeout_seconds,
        )


__all__ = ["InsightAnalyzer", "InsightResponse"]
