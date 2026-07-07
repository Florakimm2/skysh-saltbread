import type { Metadata } from "next";
import TradingTerminal from "@/frontend/demo/trading-terminal";
import "@/frontend/demo/demo.css";

export const metadata: Metadata = {
  title: "UPbit 모의투자 데모 | 불씨",
  description: "실제 공개 시세로 체험하는 불씨 주문 행동 수집 데모",
};

export default function DemoPage() {
  return <TradingTerminal />;
}
