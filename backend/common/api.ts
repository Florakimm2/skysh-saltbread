// backend/common/api.ts

import { NextResponse } from "next/server";
import { ZodError } from "zod";

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function ok<T>(data: T, status = 200) {
  return NextResponse.json(
    {
      ok: true,
      data,
    },
    { status }
  );
}

export function created<T>(data: T) {
  return ok(data, 201);
}

export function noContent() {
  return new NextResponse(null, { status: 204 });
}

export function errorResponse(error: unknown) {
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        ok: false,
        code: "VALIDATION_ERROR",
        message: "요청 데이터 형식이 올바르지 않습니다.",
        errors: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 }
    );
  }

  if (error instanceof ApiError) {
    return NextResponse.json(
      {
        ok: false,
        code: error.code,
        message: error.message,
      },
      { status: error.status }
    );
  }

  return NextResponse.json(
    {
      ok: false,
      code: "INTERNAL_SERVER_ERROR",
      message:
        error instanceof Error
          ? error.message
          : "알 수 없는 서버 오류가 발생했습니다.",
    },
    { status: 500 }
  );
}