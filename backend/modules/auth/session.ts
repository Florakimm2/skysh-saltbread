import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { REFRESH_TOKEN_COOKIE_NAME } from "@/backend/common/cookies";
import { refresh } from "./service";

export const getDashboardSession = cache(async () => {
  const refreshToken = (await cookies()).get(
    REFRESH_TOKEN_COOKIE_NAME
  )?.value;

  if (!refreshToken) {
    return null;
  }

  try {
    const session = await refresh(refreshToken);

    return {
      userId: session.userId,
    };
  } catch {
    return null;
  }
});
