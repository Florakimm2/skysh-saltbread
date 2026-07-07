import { AppError } from "@/backend/common/errors";
import { adminAuth } from "@/backend/infrastructure/firebase/firebase-admin";
import {
  firebaseLogin,
  firebaseRefresh,
  firebaseSignup,
} from "@/backend/infrastructure/firebase/firebase-auth-rest";
import {
  createUserProfile,
  findUserProfileById,
  updateUserProfileName,
} from "./repository";
import { LoginInput, ProfilePatchInput, SignupInput } from "./schema";
import { ensureProfileAfterSignup } from "@/backend/modules/guardrail/service";

export async function signup(input: SignupInput) {
  const authResult = await firebaseSignup(input.email, input.password);

  const now = new Date().toISOString();

  const user = await createUserProfile({
    id: authResult.localId,
    email: authResult.email,
    name: input.name,
    createdAt: now,
    updatedAt: now,
  });

  await ensureProfileAfterSignup({
    userId: authResult.localId,
    email: authResult.email,
    displayName: input.name ?? null,
  });

  return {
    message: "회원가입이 완료되었습니다.",
    user,
  };
}

export async function login(input: LoginInput) {
  const authResult = await firebaseLogin(input.email, input.password);

  const profile = await findUserProfileById(authResult.localId);

  return {
    message: "로그인에 성공했습니다.",
    accessToken: authResult.idToken,
    refreshToken: authResult.refreshToken,
    expiresIn: Number(authResult.expiresIn),
    user: {
      id: authResult.localId,
      email: authResult.email,
      name: profile?.name ?? "",
    },
  };
}

export async function refresh(refreshToken: string | null) {
  if (!refreshToken) {
    throw new AppError("Refresh Token이 없습니다.", 401);
  }

  const result = await firebaseRefresh(refreshToken);

  return {
    message: "Access Token이 재발급되었습니다.",
    accessToken: result.idToken,
    refreshToken: result.refreshToken,
    expiresIn: Number(result.expiresIn),
    userId: result.userId,
  };
}

export async function logout(accessToken: string | null) {
  if (accessToken) {
    const decoded = await adminAuth.verifyIdToken(accessToken);
    await adminAuth.revokeRefreshTokens(decoded.uid);
  }

  return {
    message: "로그아웃되었습니다.",
  };
}

export async function verifyAccessToken(accessToken: string) {
  try {
    return await adminAuth.verifyIdToken(accessToken, true);
  } catch {
    throw new AppError("Access Token이 유효하지 않습니다.", 401);
  }
}

export async function getProfile(userId: string) {
  const [authUser, profile] = await Promise.all([
    adminAuth.getUser(userId),
    findUserProfileById(userId),
  ]);

  return {
    userId,
    email: authUser.email ?? profile?.email ?? null,
    displayName: profile?.name ?? authUser.displayName ?? null,
  };
}

export async function patchProfile(userId: string, input: ProfilePatchInput) {
  const authUser = await adminAuth.getUser(userId);
  const displayName = input.displayName;

  if (input.newPassword) {
    const email = authUser.email;

    if (!email) {
      throw new AppError("비밀번호를 확인할 이메일 계정을 찾지 못했습니다.", 400);
    }

    await firebaseLogin(email, input.currentPassword ?? "");
    await adminAuth.updateUser(userId, {
      password: input.newPassword,
    });
  }

  if (displayName) {
    await adminAuth.updateUser(userId, {
      displayName,
    });
    await ensureProfileAfterSignup({
      userId,
      email: authUser.email ?? null,
      displayName,
    });
    await updateUserProfileName({
      userId,
      name: displayName,
    });
  }

  return getProfile(userId);
}
