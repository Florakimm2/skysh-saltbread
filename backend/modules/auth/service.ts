import { AppError } from "@/backend/common/errors";
import { adminAuth } from "@/backend/infrastructure/firebase/firebase-admin";
import {
  firebaseLogin,
  firebaseRefresh,
  firebaseSignup,
} from "@/backend/infrastructure/firebase/firebase-auth-rest";
import { createUserProfile, findUserProfileById } from "./repository";
import { LoginInput, SignupInput } from "./schema";

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