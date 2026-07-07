// backend/modules/guardrail/catalog.ts

import type { RuleFieldDefinition } from "./types";

export const RULE_FIELD_CATALOG = {
  side: {
    valueType: "STRING",
    requiresPrivateApi: false,
  },
  orderMode: {
    valueType: "STRING",
    requiresPrivateApi: false,
  },
  snapshotTrigger: {
    valueType: "STRING",
    requiresPrivateApi: false,
  },

  signedChangeRate: {
    valueType: "NUMBER",
    requiresPrivateApi: false,
  },
  shortTermReturn5m: {
    valueType: "NUMBER",
    requiresPrivateApi: false,
  },
  pricePositionIn5mRange: {
    valueType: "NUMBER",
    requiresPrivateApi: false,
  },
  requestedBalanceRatio: {
    valueType: "NUMBER",
    requiresPrivateApi: false,
  },
  orderbookClickToSnapshotMs: {
    valueType: "NUMBER",
    requiresPrivateApi: false,
  },

  tradePriceAtSnapshot: {
    valueType: "DECIMAL_STRING",
    requiresPrivateApi: false,
  },
  baseAssetAvgBuyPriceBeforeSnapshot: {
    valueType: "DECIMAL_STRING",
    requiresPrivateApi: true,
  },

  priceVsAvgBuyRateAtSnapshot: {
    valueType: "NUMBER",
    requiresPrivateApi: true,
  },
  actualOrderCreatedCount10m: {
    valueType: "NUMBER",
    requiresPrivateApi: true,
  },
} as const satisfies Record<string, RuleFieldDefinition>;

export type RuleFieldName = keyof typeof RULE_FIELD_CATALOG;

export function getRuleFieldDefinition(field: string) {
  return RULE_FIELD_CATALOG[field as RuleFieldName];
}