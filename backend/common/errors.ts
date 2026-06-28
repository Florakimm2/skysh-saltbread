import { NextResponse } from "next/server";

export class AppError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function handleRouteError(error: unknown) {
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