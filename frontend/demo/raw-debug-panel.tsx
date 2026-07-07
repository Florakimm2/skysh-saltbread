"use client";

export type DebugCategory = "behavior" | "market" | "personal";
export type DebugSource = "page" | "extension";

export type DebugRecord = {
  id: string;
  source: DebugSource;
  category: DebugCategory;
  kind: string;
  occurredAt: string;
  payload: unknown;
};

type Props = {
  records: DebugRecord[];
  extensionConnected: boolean;
  onClear: () => void;
};

const CATEGORIES: Array<{ key: DebugCategory; label: string }> = [
  { key: "behavior", label: "행동" },
  { key: "market", label: "시장" },
  { key: "personal", label: "개인" },
];

function DebugColumn({
  source,
  records,
  extensionConnected,
}: {
  source: DebugSource;
  records: DebugRecord[];
  extensionConnected: boolean;
}) {
  return (
    <section className="raw-debug__column">
      <div className="raw-debug__source">
        <div>
          <span>{source === "page" ? "PAGE INTERNAL" : "EXTENSION COLLECTOR"}</span>
          <strong>
            {source === "page" ? "데모 페이지 원본" : "확장 프로그램 수집값"}
          </strong>
        </div>
        <i
          className={
            source === "page" || extensionConnected
              ? "is-connected"
              : "is-waiting"
          }
        >
          {source === "page"
            ? "LIVE"
            : extensionConnected
              ? "CONNECTED"
              : "WAITING"}
        </i>
      </div>

      {source === "extension" && !extensionConnected && (
        <p className="raw-debug__empty">
          확장 프로그램 이벤트를 기다리고 있습니다. 설치 후 이 페이지를
          새로고침하면 실제 수집값이 여기에 표시됩니다.
        </p>
      )}

      <div className="raw-debug__categories">
        {CATEGORIES.map((category) => {
          const items = records
            .filter(
              (record) =>
                record.source === source && record.category === category.key,
            )
            .slice(0, 100);

          return (
            <div className="raw-debug__category" key={category.key}>
              <div className="raw-debug__category-title">
                <strong>{category.label} 데이터</strong>
                <span>{items.length}</span>
              </div>
              <div className="raw-debug__list">
                {items.length === 0 ? (
                  <p className="raw-debug__empty">아직 기록이 없습니다.</p>
                ) : (
                  items.map((record) => (
                    <details className="raw-debug__record" key={record.id}>
                      <summary>
                        <span>{record.kind}</span>
                        <time>
                          {new Date(record.occurredAt).toLocaleTimeString(
                            "ko-KR",
                            { hour12: false },
                          )}
                        </time>
                      </summary>
                      <pre>{JSON.stringify(record.payload, null, 2)}</pre>
                    </details>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function RawDebugPanel({
  records,
  extensionConnected,
  onClear,
}: Props) {
  return (
    <section className="raw-debug" aria-label="수집 데이터 디버그">
      <div className="raw-debug__heading">
        <div>
          <span>RAW DATA INSPECTOR</span>
          <h2>수집 데이터 실시간 비교</h2>
          <p>
            페이지가 만든 원본과 확장 프로그램이 해석한 값을 펼쳐서 비교할 수
            있습니다.
          </p>
        </div>
        <button type="button" onClick={onClear}>
          로그 전체 지우기
        </button>
      </div>
      <div className="raw-debug__grid">
        <DebugColumn
          source="page"
          records={records}
          extensionConnected={extensionConnected}
        />
        <DebugColumn
          source="extension"
          records={records}
          extensionConnected={extensionConnected}
        />
      </div>
    </section>
  );
}
