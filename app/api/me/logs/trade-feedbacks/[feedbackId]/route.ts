// app/api/me/logs/trade-feedbacks/[feedbackId]/route.ts

import { makeItemHandlers } from "@/backend/modules/logs/route-handlers";
import { patchTradeFeedbackSchema } from "@/backend/modules/logs/schema";
import {
  deleteFeedbackLog,
  getFeedbackLog,
  patchFeedbackLog,
} from "@/backend/modules/logs/service";

export const runtime = "nodejs";

const handlers = makeItemHandlers({
  idParamName: "feedbackId",
  patchSchema: patchTradeFeedbackSchema,
  get: getFeedbackLog,
  patch: patchFeedbackLog,
  remove: deleteFeedbackLog,
});

export const GET = handlers.GET;
export const PATCH = handlers.PATCH;
export const DELETE = handlers.DELETE;