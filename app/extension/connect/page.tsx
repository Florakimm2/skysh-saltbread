import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getDashboardSession } from "@/backend/modules/auth/session";
import ExtensionConnectPage from "@/frontend/auth/extension-connect-page";

export const metadata: Metadata = {
  title: "확장 프로그램 연결 | 불씨",
  description: "불씨 웹 계정을 Chrome 확장 프로그램과 연결합니다.",
};

const EXTENSION_ID_PATTERN = /^[a-p]{32}$/;

function getString(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

function getSafeNextPath(path: string | undefined) {
  if (
    path === "/onboarding" ||
    path === "/dashboard" ||
    path?.startsWith("/dashboard/")
  ) {
    return path;
  }

  return "/dashboard";
}

export default async function ExtensionConnectRoute({
  searchParams,
}: {
  searchParams: Promise<{
    extensionId?: string | string[];
    next?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const extensionId = getString(params.extensionId);
  const nextPath = getSafeNextPath(getString(params.next));

  if (!extensionId || !EXTENSION_ID_PATTERN.test(extensionId)) {
    redirect(nextPath);
  }

  if (!(await getDashboardSession())) {
    const loginParams = new URLSearchParams({
      extensionId,
      next: nextPath,
    });
    redirect(`/login?${loginParams.toString()}`);
  }

  return (
    <ExtensionConnectPage extensionId={extensionId} nextPath={nextPath} />
  );
}
