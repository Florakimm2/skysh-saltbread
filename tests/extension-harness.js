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
                  detected: true,
                  type: "ALL_IN_IMPULSE",
                  message: "최대 금액 매수 감정 매매 타입을 감지했어요.",
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
