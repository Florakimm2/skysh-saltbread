// app/api/me/logs/order-context-snapshots/route.ts

import { makeCollectionHandlers } from "@/backend/modules/logs/route-handlers";
import { createOrderContextSnapshotSchema } from "@/backend/modules/logs/schema";
import {
  createSnapshotLog,
  listSnapshotLogs,
} from "@/backend/modules/logs/service";

export const runtime = "nodejs";

const handlers = makeCollectionHandlers({
  createSchema: createOrderContextSnapshotSchema,
  list: listSnapshotLogs,
  create: createSnapshotLog,
});

export const GET = handlers.GET;
export const POST = handlers.POST;