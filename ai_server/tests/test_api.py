import unittest

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.models import InsightResponse
from app.services.insight_analyzer import AnalyzerUpstreamError


class FakeAnalyzer:
    def __init__(self, error: Exception | None = None) -> None:
        self.error = error
        self.received: list[str] | None = None

    def analyze(self, summaries: list[str]) -> InsightResponse:
        self.received = summaries
        if self.error:
            raise self.error
        return InsightResponse(summary="첫 번째 분석 문장입니다. 안정적인 성향이 나타납니다.")


def settings(
    *, openai_key: str | None = "test-openai-key", service_key: str | None = None
) -> Settings:
    return Settings(openai_api_key=openai_key, service_api_key=service_key)


class ApiTests(unittest.TestCase):
    def test_liveness_does_not_require_openai_key(self) -> None:
        client = TestClient(create_app(settings(openai_key=None)))

        response = client.get("/health/live")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})

    def test_readiness_fails_without_openai_key(self) -> None:
        client = TestClient(create_app(settings(openai_key=None)))

        response = client.get("/health/ready")

        self.assertEqual(response.status_code, 503)

    def test_readiness_succeeds_when_analyzer_is_initialized(self) -> None:
        client = TestClient(create_app(settings(), analyzer=FakeAnalyzer()))

        response = client.get("/health/ready")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ready"})

    def test_analyze_returns_structured_response(self) -> None:
        analyzer = FakeAnalyzer()
        client = TestClient(create_app(settings(), analyzer=analyzer))
        payload = {"summaries": ["시장 변동은 완만했다.", "평균 규모로 주문했다."]}

        response = client.post("/api/v1/insights/analyze", json=payload)

        self.assertEqual(response.status_code, 200)
        self.assertIn("summary", response.json())
        self.assertEqual(analyzer.received, payload["summaries"])

    def test_analyze_rejects_blank_summary(self) -> None:
        analyzer = FakeAnalyzer()
        client = TestClient(create_app(settings(), analyzer=analyzer))

        response = client.post(
            "/api/v1/insights/analyze", json={"summaries": ["   "]}
        )

        self.assertEqual(response.status_code, 422)
        self.assertIsNone(analyzer.received)

    def test_optional_service_api_key_protects_analysis(self) -> None:
        client = TestClient(
            create_app(settings(service_key="client-secret"), analyzer=FakeAnalyzer())
        )

        missing = client.post(
            "/api/v1/insights/analyze", json={"summaries": ["관찰 문장"]}
        )
        accepted = client.post(
            "/api/v1/insights/analyze",
            json={"summaries": ["관찰 문장"]},
            headers={"X-API-Key": "client-secret"},
        )

        self.assertEqual(missing.status_code, 401)
        self.assertEqual(accepted.status_code, 200)

    def test_upstream_error_is_hidden_from_client(self) -> None:
        analyzer = FakeAnalyzer(AnalyzerUpstreamError("sensitive upstream error"))
        client = TestClient(create_app(settings(), analyzer=analyzer))

        response = client.post(
            "/api/v1/insights/analyze", json={"summaries": ["관찰 문장"]}
        )

        self.assertEqual(response.status_code, 502)
        self.assertNotIn("sensitive", response.text)


if __name__ == "__main__":
    unittest.main()
