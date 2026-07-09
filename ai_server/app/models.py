from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

Observation = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=2_000),
]


class AnalyzeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    summaries: list[Observation] = Field(
        min_length=1,
        max_length=50,
        description="시장·주문·행동 데이터를 사실 문장으로 정리한 목록",
        examples=[
            [
                "시장은 완만하게 상승했고 거래량은 평소 수준이다.",
                "최근 평균 매수 금액과 비슷한 규모로 지정가 매수를 입력했다.",
                "충분히 차트를 확인했고 반복 클릭은 없었다.",
            ]
        ],
    )

# --- 1. AI 내부 처리용 스키마 ---
class InsightCard(BaseModel):
    title: str
    description: str
    score: int

class LLMInsightResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    summary: str
    insights: list[InsightCard] = Field(min_length=4, max_length=4)


# --- 2. 프론트엔드 반환용 최종 스키마 (5단계 적용) ---
class Card(BaseModel):
    title: str = Field(description="UI에 표시할 메인 제목")
    description: str = Field(description="UI에 표시할 세부 내용")
    severity: str = Field(description="score를 기반으로 치환된 중요도 (critical, high, medium, low)")

class InsightResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    
    summary: str = Field(description="사용자의 매매 행동 패턴 핵심 요약 (상단 표시용)")
    flameStatus: Literal["default", "breathing", "sad", "fastBurn", "surprised", "scared", "curious"] = Field(
        description="UI에서 불꽃 애니메이션/표정을 결정하는 키워드"
    )
    cards: list[Card] = Field(description="UI에 그려질 인사이트 카드 배열")


class HealthResponse(BaseModel):
    status: str


class ErrorResponse(BaseModel):
    detail: str