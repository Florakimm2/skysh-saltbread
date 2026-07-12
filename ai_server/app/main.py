from dotenv import load_dotenv

import logging
import sys
from pathlib import Path
from threading import Lock

# 애플리케이션 시작 전 환경 변수를 명시적으로 프로세스에 주입
load_dotenv()


AI_SERVER_ROOT = Path(__file__).resolve().parents[1]  # ai-server/
if str(AI_SERVER_ROOT) not in sys.path:
    sys.path.insert(0, str(AI_SERVER_ROOT))

from fastapi import FastAPI, Request  # noqa: E402
from fastapi.exceptions import RequestValidationError  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402

from app.api.routes import router  # noqa: E402
from app.config import Settings  # noqa: E402


class ServicePrefixMiddleware:
    def __init__(self, app, prefix: str) -> None:
        self.app = app
        self.prefix = prefix
        self.prefix_bytes = prefix.encode()

    async def __call__(self, scope, receive, send):
        if scope["type"] in {"http", "websocket"}:
            path = scope.get("path", "")

            if path == self.prefix or path.startswith(f"{self.prefix}/"):
                scope = {
                    **scope,
                    "path": path[len(self.prefix):] or "/",
                    "root_path": f"{scope.get('root_path', '')}{self.prefix}",
                }

                raw_path = scope.get("raw_path")
                if (
                    isinstance(raw_path, bytes)
                    and raw_path.startswith(self.prefix_bytes)
                ):
                    scope["raw_path"] = raw_path[len(self.prefix_bytes):] or b"/"

        await self.app(scope, receive, send)

def create_app(
    settings: Settings | None = None,
    *,
    analyzer: object | None = None,
    guardrail_suggestion_analyzer: object | None = None,
) -> FastAPI:
    application = FastAPI(
        title="Trading Insight API",
        summary="암호화폐 주문 행동 요약을 AI 인사이트로 변환합니다.",
        version="1.0.0",
    )

    # 2. CORS 통행증 발급 설정 추가
    application.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # 프론트엔드/익스텐션에서의 접근을 모두 허용
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    application.add_middleware(
        ServicePrefixMiddleware,
        prefix="/api/ai",
    )

    application.state.settings = settings or Settings.from_env()
    application.state.analyzer = analyzer
    application.state.guardrail_suggestion_analyzer = guardrail_suggestion_analyzer
    application.state.analyzer_lock = Lock()

    @application.exception_handler(RequestValidationError)
    async def validation_exception_handler(
        request: Request,
        exc: RequestValidationError,
    ) -> JSONResponse:
        safe_detail = []
        for item in exc.errors():
            input_value = item.get("input")
            if isinstance(input_value, list):
                input_info = {"type": "array", "length": len(input_value)}
            elif isinstance(input_value, dict):
                input_info = {"type": "object"}
            elif input_value is None:
                input_info = None
            else:
                input_info = {"type": type(input_value).__name__}
            safe_detail.append(
                {
                    "loc": item.get("loc"),
                    "type": item.get("type"),
                    "msg": item.get("msg"),
                    "input": input_info,
                }
            )
        logging.getLogger(__name__).warning(
            "Request validation failed",
            extra={
                "http_status": 422,
                "path": request.url.path,
                "error_stage": "REQUEST_VALIDATION",
                "error_code": "REQUEST_VALIDATION_FAILED",
                "validation_detail": safe_detail,
            },
        )
        return JSONResponse(status_code=422, content={"detail": exc.errors()})

    application.include_router(router)
    return application


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
app = create_app()
