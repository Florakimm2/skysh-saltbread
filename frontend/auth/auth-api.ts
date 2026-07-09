export type AuthUser = {
  id: string;
  email: string;
  name: string;
};

type AuthResponse = {
  message?: string;
  user?: AuthUser;
};

export async function requestAuth(
  path: "/api/auth/login" | "/api/auth/signup",
  body: Record<string, string>,
) {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "same-origin",
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as AuthResponse;

  if (!response.ok) {
    throw new Error(data.message || "요청을 처리하지 못했습니다.");
  }

  return data;
}

export function rememberActiveUser(user: AuthUser | undefined) {
  if (!user) return;
  window.localStorage.setItem("fireguard:onboarding:active-user", user.id);
}

export function getSafeNextPath(nextPath?: string) {
  if (!nextPath?.startsWith("/") || nextPath.startsWith("//")) {
    return "/dashboard";
  }

  if (
    nextPath === "/onboarding" ||
    nextPath === "/dashboard" ||
    nextPath.startsWith("/dashboard/")
  ) {
    return nextPath;
  }

  return "/dashboard";
}
