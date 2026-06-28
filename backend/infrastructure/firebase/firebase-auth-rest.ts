import { AppError } from "@/backend/common/errors";

const API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;

if (!API_KEY) {
  throw new Error("FIREBASE_WEB_API_KEY is missing");
}

type FirebaseAuthResponse = {
  idToken: string;
  email: string;
  refreshToken: string;
  expiresIn: string;
  localId: string;
  displayName?: string;
};

async function parseFirebaseError(response: Response) {
  const data = await response.json().catch(() => null);
  const code = data?.error?.message;

  if (code === "EMAIL_EXISTS") {
    throw new AppError("이미 가입된 이메일입니다.", 409);
  }

  if (
    code === "EMAIL_NOT_FOUND" ||
    code === "INVALID_PASSWORD" ||
    code === "INVALID_LOGIN_CREDENTIALS"
  ) {
    throw new AppError("이메일 또는 비밀번호가 올바르지 않습니다.", 401);
  }

  if (code === "INVALID_REFRESH_TOKEN" || code === "TOKEN_EXPIRED") {
    throw new AppError("Refresh Token이 유효하지 않습니다.", 401);
  }

  throw new AppError(code ?? "Firebase Auth 요청 실패", response.status);
}

export async function firebaseSignup(email: string, password: string) {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        password,
        returnSecureToken: true,
      }),
    }
  );

  if (!response.ok) {
    await parseFirebaseError(response);
  }

  return (await response.json()) as FirebaseAuthResponse;
}

export async function firebaseLogin(email: string, password: string) {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        password,
        returnSecureToken: true,
      }),
    }
  );

  if (!response.ok) {
    await parseFirebaseError(response);
  }

  return (await response.json()) as FirebaseAuthResponse;
}

export async function firebaseRefresh(refreshToken: string) {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const response = await fetch(
    `https://securetoken.googleapis.com/v1/token?key=${API_KEY}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    }
  );

  if (!response.ok) {
    await parseFirebaseError(response);
  }

  const data = await response.json();

  return {
    idToken: data.id_token as string,
    refreshToken: data.refresh_token as string,
    expiresIn: data.expires_in as string,
    userId: data.user_id as string,
  };
}