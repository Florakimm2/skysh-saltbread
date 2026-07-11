import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "불씨 | 투자 행동 가드레일",
  description: "거래 원칙을 세우고 주문 순간에 확인하는 Fireguard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
