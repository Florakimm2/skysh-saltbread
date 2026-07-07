// app/api/me/logs/confirmed-trade-logs/route.ts

import { makeCollectionHandlers } from "@/backend/modules/logs/route-handlers";
import { createConfirmedTradeLogSchema } from "@/backend/modules/logs/schema";
import {
  createConfirmedLog,
  listConfirmedLogs,
} from "@/backend/modules/logs/service";

export const runtime = "nodejs";

const handlers = makeCollectionHandlers({
  createSchema: createConfirmedTradeLogSchema,
  list: listConfirmedLogs,
  create: createConfirmedLog,
});

export const GET = handlers.GET;
export const POST = handlers.POST;