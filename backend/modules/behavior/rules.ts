// backend/modules/behavior/rules.ts

export const RISK_RULES = {
    // FOMO
    FOMO_CHANGE_RATE_15M: 5,
    VOLUME_SPIKE_RATIO: 3,
    FAST_ENTRY_MINUTES: 3,
  
    // Hesitation
    HESITATION_WINDOW_MINUTES: 5,
    AMOUNT_REVISION_COUNT: 4,
    CANCEL_REPEAT_COUNT: 3,
  
    // Order type switching
    ORDER_TYPE_CHANGE_COUNT: 3,
  
    // Orderbook chasing
    ORDERBOOK_CHASING_COUNT: 2,
  
    // Over-leveraging
    KRW_BALANCE_RATIO_LIMIT: 0.5,
  
    // Cooldown
    COOLDOWN_SECONDS: 30,
  };
  
  export const RISK_SCORE = {
    FOMO_CHASING: 45,
    HESITATION: 25,
    CANCEL_REPEAT: 25,
    ORDER_TYPE_SWITCHING: 15,
    ORDERBOOK_CHASING: 30,
    OVER_LEVERAGING: 35,
  };