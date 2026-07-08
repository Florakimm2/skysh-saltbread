// app/api/me/logs/trade-feedbacks/route.ts

import { makeCollectionHandlers } from "@/backend/modules/logs/route-handlers";
import { createTradeFeedbackSchema } from "@/backend/modules/logs/schema";
import {
  createFeedbackLog,
  listFeedbackLogs,
} from "@/backend/modules/logs/service";

export const runtime = "nodejs";

const handlers = makeCollectionHandlers({
  createSchema: createTradeFeedbackSchema,
  list: listFeedbackLogs,
  create: createFeedbackLog,
});

export const GET = handlers.GET;
export const POST = handlers.POST;