// app/api/me/logs/guardrail-reactions/[reactionId]/route.ts

import { makeItemHandlers } from "@/backend/modules/logs/route-handlers";
import { patchGuardrailReactionSchema } from "@/backend/modules/logs/schema";
import {
  deleteReactionLog,
  getReactionLog,
  patchReactionLog,
} from "@/backend/modules/logs/service";

export const runtime = "nodejs";

const handlers = makeItemHandlers({
  idParamName: "reactionId",
  patchSchema: patchGuardrailReactionSchema,
  get: getReactionLog,
  patch: patchReactionLog,
  remove: deleteReactionLog,
});

export const GET = handlers.GET;
export const PATCH = handlers.PATCH;
export const DELETE = handlers.DELETE;