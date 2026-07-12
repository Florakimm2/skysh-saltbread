import type { FlameMode } from "@/frontend/auth/flame-mascot";

export type ConsentId =
  | "terms"
  | "privacy"
  | "orderLogs"
  | "feedback"
  | "upbitPrivateApi";

export type ConsentState = Record<ConsentId, boolean>;

export type PatternId = "chaseBuy" | "panicSell" | "repeatOrders";

type LiteralOperand = {
  operandType: "LITERAL";
  value: string | number | boolean | string[];
};

type FieldOperand = {
  operandType: "FIELD";
  field: string;
};

type RuleCondition =
  | {
      nodeType: "CONDITION";
      leftField: string;
      operator: "IS_NULL" | "IS_NOT_NULL";
    }
  | {
      nodeType: "CONDITION";
      leftField: string;
      operator: "EQ" | "GTE" | "LTE" | "LT";
      rightOperand: LiteralOperand | FieldOperand;
    };

type RuleExpression = {
  nodeType: "GROUP";
  operator: "AND";
  children: RuleCondition[];
};

export type DemoPattern = {
  id: PatternId;
  icon: "rocket" | "down" | "repeat";
  title: string;
  sentence: string;
  ruleName: string;
  ruleSummary: string;
  riskLevel: "MEDIUM" | "HIGH";
  visualMode: "SURPRISED" | "SCARED" | "FAST_BURN";
  flameMode: FlameMode;
  warningTitle: string;
  warningMessage: string;
  requiresPrivateApi: boolean;
  expressionText: string[];
  explanations: { term: string; description: string }[];
  expression: RuleExpression;
};

export type SavedDemoRule = {
  ruleId: string;
  userId: string;
  name: string;
  description: string;
  isEnabled: boolean;
  priority: number;
  riskLevel: "MEDIUM" | "HIGH";
  visualMode: "SURPRISED" | "SCARED" | "FAST_BURN";
  expression: RuleExpression;
  warningTitle: string;
  warningMessage: string;
  requiresPrivateApi: boolean;
  schemaVersion: "v1";
  createdAt: string;
  updatedAt: string;
};

export const CONSENT_ITEMS: {
  id: ConsentId;
  icon: "document" | "shield" | "chart" | "message" | "analytics";
  title: string;
  summary: string;
  detailSections: Array<{
    title: string;
    items: string[];
  }>;
  required: boolean;
}[] = [
  {
    id: "terms",
    icon: "document",
    title: "서비스 이용 약관 동의",
    summary: "불씨 서비스 이용을 위한 기본 약관입니다.",
    detailSections: [
      {
        title: "서비스 성격",
        items: [
          "불씨는 투자 수익률을 높이거나 매수·매도 시점을 추천하는 투자 자문 도구가 아닙니다.",
          "사용자가 직접 설정한 거래 규칙을 주문 직전에 다시 확인하도록 돕는 개인 투자 보조 도구입니다.",
          "최종 투자 판단과 그에 따른 책임은 사용자에게 있습니다.",
        ],
      },
      {
        title: "서비스 이용 정보",
        items: [
          "Firebase 사용자 식별자, 이메일, 닉네임",
          "로그인 상태, 개인정보 동의 상태, 온보딩 완료 상태, 서비스 표시 시간대",
          "사용자가 생성한 가드레일 규칙, 활성화 상태, 우선순위, 위험도, 표시 방식, 경고 제목과 메시지, 조건 expression",
        ],
      },
    ],
    required: true,
  },
  {
    id: "privacy",
    icon: "shield",
    title: "개인정보 처리방침 동의",
    summary: "계정 정보 수집 및 이용에 동의합니다.",
    detailSections: [
      {
        title: "Firestore에 저장되는 계정 정보",
        items: [
          "users: userId, email, displayName/name, timezone",
          "users: personalDataConsentAgreed, personalDataConsentAgreedAt, personalDataConsentVersion",
          "users: onboardingCompleted, onboardingCompletedAt, createdAt, updatedAt",
        ],
      },
      {
        title: "브라우저에 임시 저장되는 정보",
        items: [
          "온보딩 진행 단계, 동의 체크 상태, 선택한 패턴, 제안 규칙 활성화 여부",
          "확장 프로그램 로그인 상태와 규칙 캐시는 Chrome storage에 저장됩니다.",
        ],
      },
    ],
    required: true,
  },
  {
    id: "orderLogs",
    icon: "chart",
    title: "주문 입력값 및 규칙 판정 로그 수집 동의",
    summary: "주문 입력 및 규칙 매칭 결과 로그 수집에 동의합니다.",
    detailSections: [
      {
        title: "주문 입력 및 주문 시점 데이터",
        items: [
          "거래 종목, 매수·매도 방향, 주문 방식, 주문 시작 방식",
          "주문 가격, 주문 수량, 주문 금액, 주문 비중, 선택한 주문 비율 버튼",
          "주문 snapshot 시각, 주문하는 시간(HH:mm), 주문하는 시간의 분 단위 값",
          "주문 작성 시간, 마지막 수정 후 주문까지 걸린 시간, 주문 수정 횟수, 주문 금액 변화율, 시장가 전환 여부, 호가 클릭 후 주문까지 걸린 시간",
          "최근 주문 시도 횟수, 같은 방향 주문 시도 횟수, 종목 변경 횟수, 매수·매도 변경 횟수, 가격·수량·금액 수정 횟수, 입력 되돌림 횟수, 가격 방향 변경 횟수, 주문 방식 변경 횟수, 주문 초기화 횟수",
        ],
      },
      {
        title: "시장 데이터",
        items: [
          "현재가, 전일 대비 가격 변화, 최근 5분 가격 변화",
          "스프레드, 시장 경보 플래그, 최근 5분 가격대에서 현재 위치, 최근 거래량 증가 배수",
          "데모 및 감지 API 요청에서 사용하는 15분 가격 변화율, 1분 거래량 변화율, 변동성 상위 여부, 주의 배지 여부",
        ],
      },
      {
        title: "가드레일 판정 및 경고 기록",
        items: [
          "판정 시 사용한 주문 snapshot과 시장 snapshot 값",
          "일치한 규칙 ID, 대표 표시 규칙 ID, 경고 발생 당시 규칙 snapshot, 조건별 실제값과 기준값",
          "위험 수준, 경고 표시 시각, 사용자의 경고 응답, 응답 시각과 UI 버전",
        ],
      },
    ],
    required: true,
  },
  {
    id: "feedback",
    icon: "message",
    title: "가드레일 반응 및 거래 피드백 데이터 수집 동의",
    summary: "가드레일 반응과 거래 피드백 수집에 동의합니다.",
    detailSections: [
      {
        title: "경고 반응",
        items: [
          "경고 snapshot ID, 진행·다시 보기·닫기 중 사용자가 선택한 행동",
          "반응 시각, 반응 UI 버전, 생성·수정 시각",
        ],
      },
      {
        title: "거래 피드백",
        items: [
          "주문 시도 ID, 피드백 응답 또는 닫힘 상태",
          "정한 원칙을 따른 거래였는지 후회했던 거래였는지에 대한 자기평가",
          "피드백 표시 시각, 응답 시각, 피드백 UI 버전",
        ],
      },
    ],
    required: true,
  },
  {
    id: "upbitPrivateApi",
    icon: "analytics",
    title: "업비트 개인 API 연결 선택 동의",
    summary: "개인 API 연결 시에만 처리되는 선택 데이터입니다.",
    detailSections: [
      {
        title: "브라우저 로컬에만 저장되는 데이터",
        items: [
          "업비트 Access Key와 Secret Key는 사용자가 입력한 로컬 비밀번호로 암호화되어 Chrome storage에 저장됩니다.",
          "복호화용 세션 키는 Chrome session storage에 저장되며, 서버로 전송하거나 Firestore에 저장하지 않습니다.",
        ],
      },
      {
        title: "API 연결 시 처리하고 일부 로그에 저장될 수 있는 데이터",
        items: [
          "보유 자산 잔고, 평균 매수가, 주문 가능 금액 계산에 필요한 계정 snapshot",
          "평균 매수가, 평균 매수가 대비 현재 손익률, 최근 10분 실제 주문 횟수",
          "주문 UUID, 주문 생성 시각, 주문 상태, 체결 수량, 체결 금액, 수수료, 미체결 수량",
        ],
      },
    ],
    required: false,
  },
];

const literal = (
  leftField: string,
  operator: "EQ" | "GTE" | "LTE",
  value: string | number,
): RuleCondition => ({
  nodeType: "CONDITION",
  leftField,
  operator,
  rightOperand: {
    operandType: "LITERAL",
    value,
  },
});

export const DEMO_PATTERNS: DemoPattern[] = [
  {
    id: "chaseBuy",
    icon: "rocket",
    title: "급등한 종목을 따라 산 경험",
    sentence: "가격이 빠르게 오른 종목을 뒤늦게 매수한 적이 있어요.",
    ruleName: "급등 종목 시장가 매수 확인",
    ruleSummary:
      "최근 5분 가격이 크게 오른 종목을 시장가로 매수하려는 순간을 확인해요.",
    riskLevel: "MEDIUM",
    visualMode: "SURPRISED",
    flameMode: "surprised",
    warningTitle: "정한 원칙과 맞는 매수인지 확인해 주세요",
    warningMessage:
      "최근 5분 가격이 크게 오른 종목을 시장가로 매수하려고 해요. 주문 전 기준을 한 번 더 확인해 주세요.",
    requiresPrivateApi: false,
    expressionText: [
      "매수 주문일 때",
      "시장가 주문일 때",
      "최근 5분 가격 변화가 5% 이상일 때",
    ],
    explanations: [
      {
        term: "매수 주문",
        description: "현재 매수 주문을 시도하는 경우만 확인합니다.",
      },
      {
        term: "시장가 주문",
        description: "가격을 직접 정하지 않는 주문 방식입니다.",
      },
      {
        term: "최근 5분 가격 변화 5% 이상",
        description: "단기간에 가격이 크게 오른 종목인지 공개 시장 데이터로 확인합니다.",
      },
    ],
    expression: {
      nodeType: "GROUP",
      operator: "AND",
      children: [
        literal("side", "EQ", "BUY"),
        literal("orderMode", "EQ", "MARKET"),
        literal("shortTermReturn5m", "GTE", 0.05),
      ],
    },
  },
  {
    id: "panicSell",
    icon: "down",
    title: "급락 중 급하게 판 경험",
    sentence: "가격이 빠르게 내려갈 때 급하게 매도한 적이 있어요.",
    ruleName: "급락 중 시장가 매도 확인",
    ruleSummary:
      "최근 5분 가격이 크게 내린 종목을 시장가로 매도하려는 순간을 확인해요.",
    riskLevel: "MEDIUM",
    visualMode: "SCARED",
    flameMode: "scared",
    warningTitle: "정한 매도 기준을 다시 확인해 주세요",
    warningMessage:
      "최근 5분 가격이 크게 내린 종목을 시장가로 매도하려고 해요. 매도 기준에 맞는지 확인해 주세요.",
    requiresPrivateApi: false,
    expressionText: [
      "매도 주문일 때",
      "시장가 주문일 때",
      "최근 5분 가격 변화가 -5% 이하일 때",
    ],
    explanations: [
      {
        term: "매도 주문",
        description: "현재 매도 주문을 시도하는 경우만 확인합니다.",
      },
      {
        term: "시장가 주문",
        description: "가격을 기다리지 않고 즉시 체결을 시도하는 주문입니다.",
      },
      {
        term: "최근 5분 가격 변화 -5% 이하",
        description: "단기간에 가격이 크게 내린 상황인지 공개 시장 데이터로 확인합니다.",
      },
    ],
    expression: {
      nodeType: "GROUP",
      operator: "AND",
      children: [
        literal("side", "EQ", "SELL"),
        literal("orderMode", "EQ", "MARKET"),
        literal("shortTermReturn5m", "LTE", -0.05),
      ],
    },
  },
  {
    id: "repeatOrders",
    icon: "repeat",
    title: "짧은 시간 반복 주문 경험",
    sentence: "짧은 시간 안에 주문을 여러 번 반복한 적이 있어요.",
    ruleName: "최근 1분 반복 주문 확인",
    ruleSummary:
      "최근 1분 동안 주문 시도가 3회 이상 이어지는 순간을 확인해요.",
    riskLevel: "MEDIUM",
    visualMode: "FAST_BURN",
    flameMode: "fastBurn",
    warningTitle: "주문 간격을 한 번 점검해 주세요",
    warningMessage:
      "최근 1분 동안 주문 시도가 반복되고 있어요. 이번 주문이 정한 원칙에 맞는지 확인해 주세요.",
    requiresPrivateApi: false,
    expressionText: [
      "최근 1분 주문 시도 횟수가 3회 이상일 때",
    ],
    explanations: [
      {
        term: "최근 1분 주문 시도 횟수 3회 이상",
        description:
          "확장 프로그램이 주문 버튼을 누른 시점을 기준으로 최근 시도를 집계합니다.",
      },
    ],
    expression: {
      nodeType: "GROUP",
      operator: "AND",
      children: [
        literal("orderIntentCount1m", "GTE", 3),
      ],
    },
  },
];

export const EMPTY_CONSENTS: ConsentState = {
  terms: false,
  privacy: false,
  orderLogs: false,
  feedback: false,
  upbitPrivateApi: false,
};

export function buildSavedRules(
  userId: string,
  selectedPatternIds: PatternId[],
  enabledRules: Partial<Record<PatternId, boolean>>,
): SavedDemoRule[] {
  const now = new Date().toISOString();

  return DEMO_PATTERNS.filter((pattern) =>
    selectedPatternIds.includes(pattern.id),
  ).map((pattern, index) => ({
    ruleId: `demo-${pattern.id}-v1`,
    userId,
    name: pattern.ruleName,
    description: pattern.ruleSummary,
    isEnabled: enabledRules[pattern.id] ?? true,
    priority: index + 1,
    riskLevel: pattern.riskLevel,
    visualMode: pattern.visualMode,
    expression: pattern.expression,
    warningTitle: pattern.warningTitle,
    warningMessage: pattern.warningMessage,
    requiresPrivateApi: pattern.requiresPrivateApi,
    schemaVersion: "v1",
    createdAt: now,
    updatedAt: now,
  }));
}
