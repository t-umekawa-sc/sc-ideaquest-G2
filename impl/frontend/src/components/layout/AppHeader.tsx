"use client";

// 共通ヘッダー（app-shell・デザイン標準 §4・SC-01 モック準拠）。認証後の全画面で共用。
// presentational＝ログアウト等の操作は app 層から children(メニュー項目)として受け取る
// （components は features に依存しない・§4.1 の一方向依存）。
// 残高（Lv/コイン/SP）・通知ベルは shared.css の .pixel-stat / .bell。値は K.1（GET /me 残高）・H（通知）
// 接続まで呼び出し側のデモ値（フロントエンド実装フロー規約＝画面モック先行）。
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Avatar } from "@/components/ui";

type Props = {
  user: { display_name: string; avatar_url?: string | null };
  balance?: { level: number; coin: number; sp: number };
  unreadCount?: number;
  children: React.ReactNode; // .usermenu__list の中身（<li>…</li>）
};

export function AppHeader({ user, balance, unreadCount = 0, children }: Props) {
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
          {balance && (
            <>
              <span className="pixel-stat level">Lv.{balance.level}</span>
              <span className="pixel-stat coin">◆ {balance.coin}</span>
              <Link className="pixel-stat skill" href="/spells" title="スキルポイント（魔法/スキル画面へ）">
                ✦ SP {balance.sp}
              </Link>
            </>
          )}
          <Link className="bell" href="/notifications" aria-label={`通知（未読${unreadCount}件）`}>
            🔔{unreadCount > 0 && <span className="bell__badge">{unreadCount}</span>}
          </Link>
          <div className="usermenu" ref={ref}>
            <button
              type="button"
              className="usermenu__trigger"
              aria-haspopup="menu"
              aria-expanded={open}
              aria-label={`${user.display_name} のメニュー`}
              onClick={() => setOpen((v) => !v)}
            >
              <Avatar name={user.display_name} imageUrl={user.avatar_url} size="sm" level={balance?.level} />
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
