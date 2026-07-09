import FlameMascot from "@/frontend/auth/flame-mascot";
import styles from "./dashboard.module.css";

export default function FlameIcon() {
  return (
    <FlameMascot
      className={styles.flameIcon}
      label="Fireguard 불꽃"
      size="100%"
      speed="slow"
    />
  );
}
