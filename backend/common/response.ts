import { NextResponse } from "next/server";
import { AppError } from "./errors";

export function handleApiError(error: unknown) {
  if (error instanceof AppError) {
    return NextResponse.json(
      { message: error.message },
      { status: error.statusCode }
    );
  }

  console.error(error);

  return NextResponse.json(
    { message: "서버 오류가 발생했습니다." },
    { status: 500 }
  );
}