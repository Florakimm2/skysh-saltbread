// app/api/me/logs/confirmed-trade-logs/[tradeLogId]/route.ts

import { makeItemHandlers } from "@/backend/modules/logs/route-handlers";
import { patchConfirmedTradeLogSchema } from "@/backend/modules/logs/schema";
import {
  deleteConfirmedLog,
  getConfirmedLog,
  patchConfirmedLog,
} from "@/backend/modules/logs/service";

export const runtime = "nodejs";

const handlers = makeItemHandlers({
  idParamName: "tradeLogId",
  patchSchema: patchConfirmedTradeLogSchema,
  get: getConfirmedLog,
  patch: patchConfirmedLog,
  remove: deleteConfirmedLog,
});

export const GET = handlers.GET;
export const PATCH = handlers.PATCH;
export const DELETE = handlers.DELETE;