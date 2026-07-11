import { NextRequest } from "next/server";
import { getRequiredUserId } from "@/backend/common/auth";
import { errorResponse, ok } from "@/backend/common/api";
import { listGuardrailTimeline } from "@/backend/modules/logs/timeline";

export const runtime = "nodejs";

function parseType(value: string | null) {
  if (value === "WARNING" || value === "FEEDBACK") return value;
  return "ALL";
}

export async function GET(req: NextRequest) {
  try {
    const userId = await getRequiredUserId(req);
    const { searchParams } = new URL(req.url);
    const limitParam = searchParams.get("limit");

    const result = await listGuardrailTimeline({
      userId,
      limit: limitParam ? Number(limitParam) : undefined,
      cursor: searchParams.get("cursor"),
      type: parseType(searchParams.get("type")),
    });

    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}
