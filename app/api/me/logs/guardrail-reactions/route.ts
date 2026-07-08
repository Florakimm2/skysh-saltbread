// app/api/me/logs/guardrail-reactions/route.ts

import { makeCollectionHandlers } from "@/backend/modules/logs/route-handlers";
import { createGuardrailReactionSchema } from "@/backend/modules/logs/schema";
import {
  createReactionLog,
  listReactionLogs,
} from "@/backend/modules/logs/service";

export const runtime = "nodejs";

const handlers = makeCollectionHandlers({
  createSchema: createGuardrailReactionSchema,
  list: listReactionLogs,
  create: createReactionLog,
});

export const GET = handlers.GET;
export const POST = handlers.POST;