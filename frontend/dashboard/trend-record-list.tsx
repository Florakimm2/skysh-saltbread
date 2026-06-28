import type {
  BehaviorEventType,
  EmotionPattern,
  PastTrendRecord,
} from "@/backend/modules/behavior/types";
import styles from "./dashboard.module.css";

const PATTERN_LABELS: Record<EmotionPattern, string> = {
  FOMO_CHASING: "급등 추격 매수",
  HESITATION: "주문 망설임",
  CANCEL_REPEAT: "반복 취소",
  ORDER_TYPE_SWITCHING: "주문 방식 반복 변경",
  OVER_LEVERAGING: "과도한 투자 비중",
  ORDERBOOK_CHASING: "호가 따라가기",
};

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

export default function TrendRecordList({
  records,
  scrollable = false,
}: {
  records: PastTrendRecord[];
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
                  <time dateTime={record.detectedAt}>
                    {dateFormatter.format(new Date(record.detectedAt))}
                  </time>
                </dd>
              </div>

              <div>
                <dt>감지 패턴</dt>
                <dd className={styles.patternTags}>
                  {record.patterns.length > 0 ? (
                    record.patterns.map((pattern) => (
                      <span key={pattern}>
                        {PATTERN_LABELS[pattern] ?? pattern}
                      </span>
                    ))
                  ) : (
                    <span className={styles.neutralTag}>
                      감지된 패턴 없음
                    </span>
                  )}
                </dd>
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
