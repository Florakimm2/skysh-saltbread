// app/api/me/logs/order-context-snapshots/[snapshotId]/route.ts

import { makeItemHandlers } from "@/backend/modules/logs/route-handlers";
import { patchOrderContextSnapshotSchema } from "@/backend/modules/logs/schema";
import {
  deleteSnapshotLog,
  getSnapshotLog,
  patchSnapshotLog,
} from "@/backend/modules/logs/service";

export const runtime = "nodejs";

const handlers = makeItemHandlers({
  idParamName: "snapshotId",
  patchSchema: patchOrderContextSnapshotSchema,
  get: getSnapshotLog,
  patch: patchSnapshotLog,
  remove: deleteSnapshotLog,
});

export const GET = handlers.GET;
export const PATCH = handlers.PATCH;
export const DELETE = handlers.DELETE;