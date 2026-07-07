// backend/modules/logs/route-handlers.ts

import { NextRequest } from "next/server";
import { z } from "zod";
import { getRequiredUserId } from "@/backend/common/auth";
import { created, errorResponse, noContent, ok } from "@/backend/common/api";
import type { LogListParams } from "./types";

type ParsedObject = Record<string, unknown>;

function parseListParams(req: NextRequest, userId: string): LogListParams {
  const { searchParams } = new URL(req.url);

  const limitParam = searchParams.get("limit");

  return {
    userId,
    limit: limitParam ? Number(limitParam) : undefined,
    market: searchParams.get("market") ?? undefined,
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
    attemptId: searchParams.get("attemptId") ?? undefined,
    snapshotId: searchParams.get("snapshotId") ?? undefined,
    upbitOrderUuid: searchParams.get("upbitOrderUuid") ?? undefined,
  };
}

function assertParsedObject(value: unknown): ParsedObject {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new Error("Parsed body must be an object.");
  }

  return value as ParsedObject;
}

function parseBodyAsObject(schema: z.ZodTypeAny, body: unknown): ParsedObject {
  const parsed = schema.parse(body);
  return assertParsedObject(parsed);
}

export function makeCollectionHandlers(params: {
  createSchema: z.ZodTypeAny;
  list: (params: LogListParams) => Promise<unknown>;
  create: (params: {
    userId: string;
    input: ParsedObject;
  }) => Promise<unknown>;
}) {
  return {
    async GET(req: NextRequest) {
      try {
        const userId = await getRequiredUserId(req);
        const listParams = parseListParams(req, userId);

        const result = await params.list(listParams);

        return ok(result);
      } catch (error) {
        return errorResponse(error);
      }
    },

    async POST(req: NextRequest) {
      try {
        const userId = await getRequiredUserId(req);
        const body = await req.json();

        const input = parseBodyAsObject(params.createSchema, body);

        const result = await params.create({
          userId,
          input,
        });

        return created(result);
      } catch (error) {
        return errorResponse(error);
      }
    },
  };
}

export function makeItemHandlers<IdParamName extends string>(params: {
  idParamName: IdParamName;
  patchSchema: z.ZodTypeAny;

  get: (
    params: { userId: string } & Record<IdParamName, string>
  ) => Promise<unknown>;

  patch: (
    params: { userId: string; patch: ParsedObject } & Record<
      IdParamName,
      string
    >
  ) => Promise<unknown>;

  remove: (
    params: { userId: string } & Record<IdParamName, string>
  ) => Promise<unknown>;
}) {
  type RouteContext = {
    params: Promise<Record<IdParamName, string>>;
  };

  function buildIdParam(id: string): Record<IdParamName, string> {
    return {
      [params.idParamName]: id,
    } as Record<IdParamName, string>;
  }

  return {
    async GET(req: NextRequest, context: RouteContext) {
      try {
        const userId = await getRequiredUserId(req);
        const routeParams = await context.params;
        const id = routeParams[params.idParamName];

        const result = await params.get({
          userId,
          ...buildIdParam(id),
        });

        return ok(result);
      } catch (error) {
        return errorResponse(error);
      }
    },

    async PATCH(req: NextRequest, context: RouteContext) {
      try {
        const userId = await getRequiredUserId(req);
        const routeParams = await context.params;
        const id = routeParams[params.idParamName];

        const body = await req.json();
        const patch = parseBodyAsObject(params.patchSchema, body);

        const result = await params.patch({
          userId,
          ...buildIdParam(id),
          patch,
        });

        return ok(result);
      } catch (error) {
        return errorResponse(error);
      }
    },

    async DELETE(req: NextRequest, context: RouteContext) {
      try {
        const userId = await getRequiredUserId(req);
        const routeParams = await context.params;
        const id = routeParams[params.idParamName];

        await params.remove({
          userId,
          ...buildIdParam(id),
        });

        return noContent();
      } catch (error) {
        return errorResponse(error);
      }
    },
  };
}