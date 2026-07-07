import Link from "next/link";
import styles from "./home.module.css";

export default function Home() {
  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <span className={styles.eyebrow}>불씨 · FIREGUARD</span>
        <h1>투자하기 전에, 내 행동부터 바라보세요.</h1>
        <p>
          실제 업비트 공개 시세와 가상 자산으로 주문 흐름을 체험하고,
          확장 프로그램이 어떤 행동과 시장 맥락을 읽는지 확인할 수 있습니다.
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
