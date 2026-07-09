import Link from "next/link";
import FlameMascot from "./flame-mascot";
import styles from "./auth-pages.module.css";

export function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h14m-5-5 5 5-5 5" />
    </svg>
  );
}

export function EyeIcon({ closed = false }: { closed?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2.8 12s3.2-5 9.2-5 9.2 5 9.2 5-3.2 5-9.2 5-9.2-5-9.2-5Z" />
      <circle cx="12" cy="12" r="2.2" />
      {closed && <path d="m4 4 16 16" />}
    </svg>
  );
}

export function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="m4 7 8 6 8-6" />
    </svg>
  );
}

export function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3" />
    </svg>
  );
}

export function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3 5.5 5.7v5.4c0 4.3 2.7 8.2 6.5 9.9 3.8-1.7 6.5-5.6 6.5-9.9V5.7L12 3Z" />
      <path d="m8.8 11.9 2.1 2.1 4.5-4.6" />
    </svg>
  );
}

export function Brand({ href = "/" }: { href?: string }) {
  return (
    <Link className={styles.brand} href={href} aria-label="불씨 홈">
      <FlameMascot
        className={styles.brandFlame}
        label=""
        size={42}
        speed="slow"
      />
      <strong>불씨</strong>
    </Link>
  );
}

export function CandlestickBackdrop() {
  return (
    <svg
      className={styles.candles}
      viewBox="0 0 760 250"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path d="M0 184C100 145 160 214 242 153s139-22 210 4 136-78 308-37" />
      {[
        [42, 154, 39, 176],
        [66, 126, 64, 166],
        [90, 138, 28, 156],
        [118, 164, 34, 184],
        [154, 141, 29, 169],
        [542, 126, 45, 162],
        [570, 83, 64, 139],
        [598, 106, 38, 151],
        [628, 74, 53, 125],
        [662, 32, 75, 105],
        [698, 64, 36, 97],
        [728, 26, 44, 75],
      ].map(([x, y, h, wick]) => (
        <g key={x}>
          <line x1={x} y1={y - 13} x2={x} y2={y + wick} />
          <rect x={x - 5} y={y} width="10" height={h} rx="1" />
        </g>
      ))}
    </svg>
  );
}

export function TrustFooter() {
  return (
    <div className={styles.trustFooter}>
      <span>
        <ShieldIcon />
        불씨는 사용자의 계정 정보를 안전하게 보호해요.
      </span>
      <i />
      <span>
        <LockIcon />
        안전하고 투명하게, 당신의 투자를 지켜드려요.
      </span>
    </div>
  );
}

export function AuthArtwork({
  children,
  mode = "default",
}: {
  children: React.ReactNode;
  mode?: "default" | "curious";
}) {
  return (
    <section className={styles.artwork}>
      <div className={styles.artworkCopy}>{children}</div>
      <CandlestickBackdrop />
      <FlameMascot
        className={styles.heroFlame}
        mode={mode}
        size="clamp(190px, 22vw, 310px)"
      />
    </section>
  );
}
