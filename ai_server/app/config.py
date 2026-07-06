import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


AI_SERVER_ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = AI_SERVER_ROOT / ".env"

# 이미 운영 환경변수가 있으면 그것을 우선한다.
load_dotenv(ENV_PATH, override=False)

def _read_float(name: str, default: float, minimum: float, maximum: float) -> float:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default

    try:
        value = float(raw_value)
    except ValueError as exc:
        raise ValueError(f"{name} must be a number") from exc

    if not minimum <= value <= maximum:
        raise ValueError(f"{name} must be between {minimum} and {maximum}")
    return value


def _read_optional_secret(name: str) -> str | None:
    value = os.getenv(name)
    return value.strip() if value and value.strip() else None


@dataclass(frozen=True, slots=True)
class Settings:
    openai_api_key: str | None
    openai_model: str = "gpt-4o-mini"
    openai_temperature: float = 0.3
    openai_timeout_seconds: float = 30.0
    service_api_key: str | None = None

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            openai_api_key=_read_optional_secret("OPENAI_API_KEY"),
            openai_model=os.getenv("OPENAI_MODEL", "gpt-4o-mini").strip()
            or "gpt-4o-mini",
            openai_temperature=_read_float(
                "OPENAI_TEMPERATURE", default=0.3, minimum=0.0, maximum=2.0
            ),
            openai_timeout_seconds=_read_float(
                "OPENAI_TIMEOUT_SECONDS", default=30.0, minimum=1.0, maximum=300.0
            ),
            service_api_key=_read_optional_secret("SERVICE_API_KEY"),
        )
