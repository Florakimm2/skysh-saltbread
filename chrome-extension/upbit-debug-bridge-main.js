(() => {
  const SOURCE = "SALTBREAD_UPBIT_DEBUG_BRIDGE";
  const STATE_EVENT = "SALTBREAD_UPBIT_DEBUG_STATE";

  if (window.__SALTBREAD_UPBIT_DEBUG__?.__installed) {
    return;
  }

  let latestState = null;

  function clone(value) {
    try {
      return structuredClone(value);
    } catch {
      try {
        return JSON.parse(JSON.stringify(value));
      } catch {
        return value;
      }
    }
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;

    const data = event.data;
    if (!data || data.source !== SOURCE || data.type !== STATE_EVENT) return;

    latestState = data.state || null;
    window.__SALTBREAD_UPBIT_DEBUG_STATE__ = latestState;
  });

  window.__SALTBREAD_UPBIT_DEBUG__ = {
    __installed: true,

    getState() {
      return clone(latestState || window.__SALTBREAD_UPBIT_DEBUG_STATE__ || null);
    },

    print() {
      console.log("[불씨] UPBIT DEBUG STATE", this.getState());
    },

    printLastExtraction() {
      const state = this.getState();
      console.log("[불씨] lastExtractionResult", state?.lastExtractionResult);
    },

    printLastOrderIntent() {
      const state = this.getState();
      console.log("[불씨] lastOrderIntentDto", state?.lastOrderIntentDto);
    },

    printLastRuleEvaluation() {
      const state = this.getState();
      const evaluation = state?.lastRuleEvaluation;
      console.log("[불씨] lastRuleEvaluation", evaluation);

      if (evaluation?.conditionResults) {
        console.table(evaluation.conditionResults);
      }
    },

    enable() {
      localStorage.setItem("saltbread:upbit-order-debug", "true");
      console.log("[불씨] upbit order debug enabled");
    },

    disable() {
      localStorage.setItem("saltbread:upbit-order-debug", "false");
      console.log("[불씨] upbit order debug disabled");
    },

    clear() {
      latestState = null;
      window.__SALTBREAD_UPBIT_DEBUG_STATE__ = null;
      console.log("[불씨] upbit debug state cleared");
    },
  };

  console.info("[불씨] __SALTBREAD_UPBIT_DEBUG__ MAIN bridge installed");
})();
