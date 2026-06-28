import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "UPbit 주문 테스트 터미널 | Fireguard",
  description: "Fireguard 입력 감지 및 감정 매매 시나리오 테스트 화면",
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
