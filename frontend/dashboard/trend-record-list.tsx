import type {
  BehaviorSessionRecord,
  BehaviorEventType,
} from "@/backend/modules/behavior/types";
import styles from "./dashboard.module.css";

const EVENT_LABELS: Record<BehaviorEventType, string> = {
  AMOUNT_INPUT: "주문 금액 입력",
  QUANTITY_INPUT: "주문 수량 입력",
  PRICE_INPUT: "주문 가격 입력",
  ORDER_TYPE_CHANGE: "주문 방식 변경",
  BUY_CLICK: "매수 클릭",
  SELL_CLICK: "매도 클릭",
  CANCEL_CLICK: "주문 취소",
  SYMBOL_CHANGE: "종목 변경",
  ORDER_SUBMIT_ATTEMPT: "주문 시도",
};

const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Asia/Seoul",
});

function formatOrderDetails(record: BehaviorSessionRecord) {
  return [
    record.symbol,
    record.side === "BUY" ? "매수" : record.side === "SELL" ? "매도" : null,
    record.orderType === "LIMIT"
      ? "지정가"
      : record.orderType === "MARKET"
        ? "시장가"
        : null,
    record.amount !== undefined
      ? `${Math.round(record.amount).toLocaleString("ko-KR")}원`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export default function TrendRecordList({
  records,
  scrollable = false,
}: {
  records: BehaviorSessionRecord[];
  scrollable?: boolean;
}) {
  return (
    <div
      className={`${styles.trendListWrap} ${
        scrollable ? styles.trendListScrollable : ""
      }`}
    >
      <ol className={styles.trendList}>
        {records.map((record) => (
          <li className={styles.trendRecord} key={record.id}>
            <dl className={styles.trendDetails}>
              <div className={styles.trendDate}>
                <dt>언제</dt>
                <dd>
                  <time dateTime={record.occurredAt}>
                    {dateFormatter.format(new Date(record.occurredAt))}
                  </time>
                </dd>
              </div>

              <div>
                <dt>주문 정보</dt>
                <dd>{formatOrderDetails(record)}</dd>
              </div>

              <div>
                <dt>행동 데이터</dt>
                <dd className={styles.behaviorSummary}>
                  {record.behaviorData.length > 0
                    ? record.behaviorData
                        .map(
                          ({ eventType, count }) =>
                            `${EVENT_LABELS[eventType]} ${count}회`
                        )
                        .join(" · ")
                    : "연결된 행동 데이터가 없습니다."}
                </dd>
              </div>
            </dl>
          </li>
        ))}
      </ol>
    </div>
  );
}
