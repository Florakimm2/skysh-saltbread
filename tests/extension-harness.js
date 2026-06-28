const runtimeListeners = [];
const storageListeners = [];
const auth = {
  accessToken: "test-access-token",
  user: { email: "tester@saltbread.local" },
};

globalThis.chrome = {
  runtime: {
    onMessage: {
      addListener(listener) {
        runtimeListeners.push(listener);
      },
    },
    async sendMessage(message) {
      if (message.type === "ORDER_ACTION_DETECTED") {
        const isAllInBuy =
          message.payload.currentOrder.order_side === "BUY" &&
          message.payload.behaviorData.is_max_button_clicked;
        window.setTimeout(() => {
          for (const listener of runtimeListeners) {
            listener(
              {
                type: "ORDER_DATA_UPDATED",
                payload: { clientAverageBuyAmount: 500_000 },
              },
              {},
              () => {},
            );
            listener(
              {
                type: "DETECTION_RESULT",
                payload: {
                  detected: isAllInBuy,
                  type: isAllInBuy ? "ALL_IN_IMPULSE" : null,
                  message: isAllInBuy
                    ? "최대 금액 매수 감정 매매 타입을 감지했어요."
                    : "현재 감정적 매매 패턴은 감지되지 않았어요.",
                  flameMode:
                    message.payload.currentOrder.order_side === "SELL"
                      ? "blue"
                      : "pink",
                },
              },
              {},
              () => {},
            );
          }
        }, 50);
      }

      return { ok: true };
    },
  },
  storage: {
    local: {
      async get(keys) {
        const result = {
          auth,
          flameTheme: { mode: "default" },
        };

        if (typeof keys === "string") {
          return { [keys]: result[keys] };
        }

        return result;
      },
    },
    onChanged: {
      addListener(listener) {
        storageListeners.push(listener);
      },
    },
  },
};

const sideTabs = [
  document.querySelector("#test-side-buy"),
  document.querySelector("#test-side-sell"),
];

for (const sideTab of sideTabs) {
  sideTab.addEventListener("click", () => {
    for (const candidate of sideTabs) {
      candidate.setAttribute(
        "aria-selected",
        String(candidate === sideTab),
      );
    }
  });
}

document.querySelector("#test-detect-now").addEventListener("click", () => {
  const requestId = crypto.randomUUID();
  document.dispatchEvent(
    new CustomEvent("saltbread:detect-now", {
      detail: { requestId },
    }),
  );
  const handled =
    document.documentElement.dataset.saltbreadEventAck === requestId;
  document.querySelector("#test-event-status").textContent = handled
    ? "즉시 감지 이벤트 연결됨"
    : "즉시 감지 이벤트 연결 안 됨";
});

document.querySelector("#test-demo-reset").addEventListener("click", () => {
  const requestId = crypto.randomUUID();
  document.dispatchEvent(
    new CustomEvent("saltbread:demo-reset", {
      detail: { requestId },
    }),
  );
  const handled =
    document.documentElement.dataset.saltbreadEventAck === requestId;
  document.querySelector("#test-event-status").textContent = handled
    ? "초기화 이벤트 연결됨"
    : "초기화 이벤트 연결 안 됨";
});

document.querySelector("#test-demo-scenario").addEventListener("click", () => {
  const requestId = crypto.randomUUID();
  const now = new Date().toISOString();
  document.dispatchEvent(
    new CustomEvent("saltbread:demo-scenario", {
      detail: {
        requestId,
        id: 1,
        type: "FOMO_CHASING",
        title: "급등 추격 매수",
        market: "KRW-BTC",
        behaviorData: {
          is_max_button_clicked: false,
          client_avg_buy_amount: 500_000,
          buy_click_count_1m: 2,
          input_edit_count: 2,
          page_stay_duration: 32,
        },
        currentOrder: {
          market: "KRW-BTC",
          order_side: "BUY",
          order_status: "WAIT",
          order_type: "LIMIT",
          order_price: 87_330_000,
          order_volume: 0.01374,
          order_amount: 1_200_000,
          realized_loss_pct_1h: null,
          order_request_time: now,
          order_cancel_time: null,
        },
        recentOrders: [],
        clientAverageBuyAmount: 500_000,
        currentPrice: 82_000_000,
        marketData: {
          price_change_rate_15m: 6.2,
          volume_change_rate_1m: 340,
          is_top3_volatility: false,
          has_warning_badge: false,
        },
        expiresAt: Date.now() + 180_000,
      },
    }),
  );
  const handled =
    document.documentElement.dataset.saltbreadEventAck === requestId;
  document.querySelector("#test-event-status").textContent = handled
    ? "시나리오 이벤트 연결됨"
    : "시나리오 이벤트 연결 안 됨";
});
