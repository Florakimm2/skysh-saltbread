# Trading Insight FastAPI

시장·주문·행동 관찰 문장 목록을 OpenAI 모델로 분석해 매매 성향 요약을 반환하는
FastAPI 서비스입니다. 기존 `hack_AI.py`의 프롬프트 로직을 서비스 계층으로 옮겼고,
코드에 있던 OpenAI API 키는 제거했습니다.

## 로컬 실행

Python 3.10 이상에서 다음과 같이 실행합니다.

```bash
cd ai_server

rm -rf venv
python3 -m venv venv

./venv/bin/python -m pip install --upgrade pip
./venv/bin/python -m pip install -r requirements.txt

cd ..
npm run dev
```

`.env`의 `OPENAI_API_KEY`를 실제 값으로 변경한 뒤:

```bash
uvicorn app.main:app --reload --env-file .env
```

- Swagger UI: <http://localhost:8000/docs>
- Liveness: <http://localhost:8000/health/live>
- Readiness: <http://localhost:8000/health/ready>

## API

`POST /api/v1/insights/analyze`

```bash
curl -X POST http://localhost:8000/api/v1/insights/analyze \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: replace-with-your-service-key' \
  -d '{
    "summaries": [
      "시장은 완만하게 상승했고 거래량은 평소 수준이다.",
      "최근 평균 매수 금액과 비슷한 규모로 지정가 매수를 입력했다.",
      "충분히 차트를 확인했고 반복 클릭은 없었다."
    ]
  }'
```

응답:

```json
{
  "summary": "분석 결과 두 문장이 반환됩니다."
}
```

`SERVICE_API_KEY`를 비워 두면 `X-API-Key` 검증은 꺼집니다. 인터넷에 공개할
서비스라면 반드시 충분히 긴 임의 값을 설정하고 HTTPS 뒤에서 운영하세요.

## 환경변수

| 이름 | 필수 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | 예 | 없음 | 서버에서만 사용하는 OpenAI API 키 |
| `OPENAI_MODEL` | 아니요 | `gpt-4o-mini` | 분석 모델 |
| `OPENAI_TEMPERATURE` | 아니요 | `0.3` | 0~2 범위 |
| `OPENAI_TIMEOUT_SECONDS` | 아니요 | `30` | 1~300초 범위 |
| `SERVICE_API_KEY` | 권장 | 없음 | 클라이언트의 `X-API-Key` 검증값 |

`.env`는 `.gitignore`와 `.dockerignore`에 포함됩니다. 클라우드 배포에서는 `.env`
파일을 이미지에 복사하지 말고 플랫폼의 Secret/Environment Variable 기능으로
주입하세요.
