import { AppError } from "@/backend/common/errors";

export type SignupInput = {
  email: string;
  password: string;
  name: string;
};

export type LoginInput = {
  email: string;
  password: string;
};

export type ProfilePatchInput = {
  displayName?: string;
  currentPassword?: string;
  newPassword?: string;
};

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function validateSignupInput(body: unknown): SignupInput {
  const input = body as Partial<SignupInput>;

  if (!input.email || !input.password || !input.name) {
    throw new AppError("email, password, name은 필수입니다.", 400);
  }

  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();

  if (!isValidEmail(email)) {
    throw new AppError("이메일 형식이 올바르지 않습니다.", 400);
  }

  if (input.password.length < 8) {
    throw new AppError("비밀번호는 8자 이상이어야 합니다.", 400);
  }

  if (!name) {
    throw new AppError("name은 필수입니다.", 400);
  }

  return {
    email,
    password: input.password,
    name,
  };
}

export function validateLoginInput(body: unknown): LoginInput {
  const input = body as Partial<LoginInput>;

  if (!input.email || !input.password) {
    throw new AppError("email, password는 필수입니다.", 400);
  }

  const email = input.email.trim().toLowerCase();

  if (!isValidEmail(email)) {
    throw new AppError("이메일 형식이 올바르지 않습니다.", 400);
  }

  return {
    email,
    password: input.password,
  };
}

export function validateProfilePatchInput(body: unknown): ProfilePatchInput {
  const input = body as Partial<ProfilePatchInput>;
  const result: ProfilePatchInput = {};

  if (input.displayName !== undefined) {
    const displayName = String(input.displayName).trim();

    if (displayName.length < 2 || displayName.length > 20) {
      throw new AppError("닉네임은 2자 이상 20자 이하로 입력해 주세요.", 400);
    }

    result.displayName = displayName;
  }

  const wantsPasswordChange =
    input.currentPassword !== undefined || input.newPassword !== undefined;

  if (wantsPasswordChange) {
    const currentPassword = String(input.currentPassword ?? "");
    const newPassword = String(input.newPassword ?? "");

    if (!currentPassword) {
      throw new AppError("현재 비밀번호를 입력해 주세요.", 400);
    }

    if (newPassword.length < 8) {
      throw new AppError("새 비밀번호는 8자 이상이어야 합니다.", 400);
    }

    if (currentPassword === newPassword) {
      throw new AppError("새 비밀번호는 현재 비밀번호와 달라야 합니다.", 400);
    }

    result.currentPassword = currentPassword;
    result.newPassword = newPassword;
  }

  if (Object.keys(result).length === 0) {
    throw new AppError("수정할 프로필 정보가 없습니다.", 400);
  }

  return result;
}
