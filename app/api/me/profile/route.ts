import { NextRequest } from "next/server";
import { getRequiredUserId } from "@/backend/common/auth";
import { errorResponse, ok } from "@/backend/common/api";
import {
  getProfile,
  patchProfile,
} from "@/backend/modules/auth/service";
import { validateProfilePatchInput } from "@/backend/modules/auth/schema";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const userId = await getRequiredUserId(req);
    const profile = await getProfile(userId);

    return ok(profile);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const userId = await getRequiredUserId(req);
    const body = await req.json();
    const input = validateProfilePatchInput(body);
    const profile = await patchProfile(userId, input);

    return ok(profile);
  } catch (error) {
    return errorResponse(error);
  }
}
