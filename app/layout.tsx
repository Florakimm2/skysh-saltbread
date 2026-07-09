import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "불씨 | 투자 행동 가드레일",
  description: "투자 행동을 기록하고 감정 매매를 돌아보는 Fireguard",
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
