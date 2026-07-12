import Link from "next/link";
import styles from "./home.module.css";

export default function Home() {
  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <span className={styles.eyebrow}>WITH GUARDRAIL</span>
        <h1>투자에 원칙을 더하다</h1>
        <p>
          직접 정한 거래 원칙을 주문 순간에 확인하고, 이후 기록을 통해
          같은 후회를 반복하지 않도록 돕는 투자 보조 도구입니다.
        </p>
        <div className={styles.actions}>
          <Link className={styles.primary} href="/demo">
            모의투자 데모 열기
          </Link>
          <Link className={styles.secondary} href="/login">
            로그인
          </Link>
          <Link className={styles.secondary} href="/dashboard">
            대시보드
          </Link>
        </div>
        <small>
          데모의 주문과 자산은 브라우저 메모리에만 존재하며 실제 거래소로
          전송되지 않습니다.
        </small>
      </section>
    </main>
  );
}
