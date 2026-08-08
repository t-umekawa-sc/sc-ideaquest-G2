import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ideaquest",
  description: "社内アイデア創出をゲーミフィケーションで促す WEB アプリ",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
