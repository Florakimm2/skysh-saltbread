import logging
from threading import Lock

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware # 1. CORS 미들웨어 불러오기 추가

from app.api.routes import router
from app.config import Settings


def create_app(
    settings: Settings | None = None,
    *,
    analyzer: object | None = None,
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

    application.state.settings = settings or Settings.from_env()
    application.state.analyzer = analyzer
    application.state.analyzer_lock = Lock()
    application.include_router(router)
    return application


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
app = create_app()