from typing import Annotated

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


class InsightResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    summary: str = Field(
        min_length=1,
        description="사용자의 매매 행동 패턴에 대한 두 문장의 핵심 요약",
    )


class HealthResponse(BaseModel):
    status: str


class ErrorResponse(BaseModel):
    detail: str
