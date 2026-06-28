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