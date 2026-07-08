// backend/modules/logs/service.ts

import { ApiError } from "@/backend/common/api";
import {
  createConfirmedTradeLog,
  createGuardrailReaction,
  createOrderContextSnapshot,
  createTradeFeedback,
  deleteConfirmedTradeLog,
  deleteGuardrailReaction,
  deleteOrderContextSnapshot,
  deleteTradeFeedback,
  getConfirmedTradeLog,
  getGuardrailReaction,
  getOrderContextSnapshot,
  getTradeFeedback,
  listConfirmedTradeLogs,
  listGuardrailReactions,
  listOrderContextSnapshots,
  listTradeFeedbacks,
  patchConfirmedTradeLog,
  patchConfirmedTradeOutcome,
  patchGuardrailReaction,
  patchOrderContextSnapshot,
  patchTradeFeedback,
} from "./repository";
import type {
  ConfirmedTradeLogDTO,
  GuardrailReactionDTO,
  LogListParams,
  OrderContextSnapshotDTO,
  OrderOutcomePatchDTO,
  TradeFeedbackDTO,
} from "./types";

function notFound(): never {
  throw new ApiError(
    404,
    "LOG_NOT_FOUND",
    "로그를 찾을 수 없거나 접근 권한이 없습니다."
  );
}

export async function createSnapshotLog(params: {
  userId: string;
  input: Record<string, unknown>;
}) {
  return createOrderContextSnapshot(params);
}

export async function listSnapshotLogs(params: LogListParams) {
  return listOrderContextSnapshots(params);
}

export async function getSnapshotLog(params: {
  userId: string;
  snapshotId: string;
}): Promise<OrderContextSnapshotDTO> {
  const result = await getOrderContextSnapshot(params);
  if (!result) notFound();
  return result;
}

export async function patchSnapshotLog(params: {
  userId: string;
  snapshotId: string;
  patch: Record<string, unknown>;
}) {
  const result = await patchOrderContextSnapshot(params);
  if (!result) notFound();
  return result;
}

export async function deleteSnapshotLog(params: {
  userId: string;
  snapshotId: string;
}) {
  const deleted = await deleteOrderContextSnapshot(params);
  if (!deleted) notFound();
  return { deleted: true, snapshotId: params.snapshotId };
}

export async function createReactionLog(params: {
  userId: string;
  input: Record<string, unknown>;
}) {
  return createGuardrailReaction(params);
}

export async function listReactionLogs(params: LogListParams) {
  return listGuardrailReactions(params);
}

export async function getReactionLog(params: {
  userId: string;
  reactionId: string;
}): Promise<GuardrailReactionDTO> {
  const result = await getGuardrailReaction(params);
  if (!result) notFound();
  return result;
}

export async function patchReactionLog(params: {
  userId: string;
  reactionId: string;
  patch: Record<string, unknown>;
}) {
  const result = await patchGuardrailReaction(params);
  if (!result) notFound();
  return result;
}

export async function deleteReactionLog(params: {
  userId: string;
  reactionId: string;
}) {
  const deleted = await deleteGuardrailReaction(params);
  if (!deleted) notFound();
  return { deleted: true, reactionId: params.reactionId };
}

export async function createFeedbackLog(params: {
  userId: string;
  input: Record<string, unknown>;
}) {
  return createTradeFeedback(params);
}

export async function listFeedbackLogs(params: LogListParams) {
  return listTradeFeedbacks(params);
}

export async function getFeedbackLog(params: {
  userId: string;
  feedbackId: string;
}): Promise<TradeFeedbackDTO> {
  const result = await getTradeFeedback(params);
  if (!result) notFound();
  return result;
}

export async function patchFeedbackLog(params: {
  userId: string;
  feedbackId: string;
  patch: Record<string, unknown>;
}) {
  const result = await patchTradeFeedback(params);
  if (!result) notFound();
  return result;
}

export async function deleteFeedbackLog(params: {
  userId: string;
  feedbackId: string;
}) {
  const deleted = await deleteTradeFeedback(params);
  if (!deleted) notFound();
  return { deleted: true, feedbackId: params.feedbackId };
}

export async function createConfirmedLog(params: {
  userId: string;
  input: Record<string, unknown>;
}) {
  return createConfirmedTradeLog(params);
}

export async function listConfirmedLogs(params: LogListParams) {
  return listConfirmedTradeLogs(params);
}

export async function getConfirmedLog(params: {
  userId: string;
  tradeLogId: string;
}): Promise<ConfirmedTradeLogDTO> {
  const result = await getConfirmedTradeLog(params);
  if (!result) notFound();
  return result;
}

export async function patchConfirmedLog(params: {
  userId: string;
  tradeLogId: string;
  patch: Record<string, unknown>;
}) {
  const result = await patchConfirmedTradeLog(params);
  if (!result) notFound();
  return result;
}

export async function deleteConfirmedLog(params: {
  userId: string;
  tradeLogId: string;
}) {
  const deleted = await deleteConfirmedTradeLog(params);
  if (!deleted) notFound();
  return { deleted: true, tradeLogId: params.tradeLogId };
}

export async function patchConfirmedOutcome(params: {
  userId: string;
  input: OrderOutcomePatchDTO;
}) {
  const result = await patchConfirmedTradeOutcome(params);

  if (!result) {
    throw new ApiError(
      404,
      "TRADE_LOG_NOT_FOUND",
      "해당 upbitOrderUuid의 실제 주문 로그를 찾을 수 없거나 접근 권한이 없습니다."
    );
  }

  return result;
}