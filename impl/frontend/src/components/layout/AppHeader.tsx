"use client";

// 共通ヘッダー（app-shell・デザイン標準 §4）。認証後の全画面で共用。
// presentational＝ログアウト等の操作は app 層から children(メニュー項目)として受け取る
// （components は features に依存しない・§4.1 の一方向依存）。
// 通知ベル・残高ステータスは対応ドメイン（H/K）実装時に追加。
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Avatar } from "@/components/ui";

type Props = {
  user: { display_name: string; avatar_url?: string | null };
  children: React.ReactNode; // .usermenu__list の中身（<li>…</li>）
};

export function AppHeader({ user, children }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <header className="app-header">
      <div className="container between">
        <Link href="/" className="brand" aria-label="ideaquest ホーム">
          <Image className="brand-logo" src="/assets/logo-ideaquest.png" alt="IDEAQUEST" width={88} height={40} priority />
        </Link>
        <div className="header-actions">
          <div className="usermenu" ref={ref}>
            <button
              type="button"
              className="usermenu__trigger"
              aria-haspopup="menu"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            >
              <Avatar name={user.display_name} imageUrl={user.avatar_url} size="sm" />
              <span>{user.display_name}</span>
            </button>
            <ul className="usermenu__list" role="menu" hidden={!open}>
              {children}
            </ul>
          </div>
        </div>
      </div>
    </header>
  );
}
