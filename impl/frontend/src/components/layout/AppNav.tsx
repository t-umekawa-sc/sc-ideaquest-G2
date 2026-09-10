"use client";

// グローバルナビ（ドロワー／📌ピン留めでサイドバー・デザイン標準 §4.1・画面遷移図 §4 集約 2026-09-10・レビュー#1）。
// ☰(.appnav-burger)で左ドロワー(.appnav)をオーバーレイ表示／📌で常設サイドバー化（本文右シフト）。
// ピン状態は localStorage(端末記憶・iq_nav_pinned)。ピン可は広い画面(≥1024px)のみ＝狭幅は常にオーバーレイ。
// ゲーム群はゲームモード(レビュー#2)ON 時のみ＝#2 実装までは既定 true（常時表示）。
// components は features に依存しない（一方向依存・デザイン標準 §4.1）＝行き先は app ルートの静的リンク。
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type NavItem = { href: string; label: string; icon: string };
const BIZ: NavItem[] = [
  { href: "/", label: "ホーム", icon: "🏠" },
  { href: "/quests", label: "クエスト", icon: "📜" },
  { href: "/notifications", label: "通知", icon: "🔔" },
];
const GAME: NavItem[] = [
  { href: "/shop", label: "ショップ", icon: "🛒" },
  { href: "/avatar", label: "きせかえ", icon: "🧍" },
  { href: "/spells", label: "魔法・スキル", icon: "✦" },
  { href: "/achievements", label: "実績", icon: "🏅" },
  { href: "/ranking", label: "ランキング", icon: "🏆" },
];

const PIN_KEY = "iq_nav_pinned";
const WIDE = "(min-width: 1024px)";

export function AppNav({ gameEnabled = true }: { gameEnabled?: boolean }) {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [wide, setWide] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  const burgerRef = useRef<HTMLButtonElement>(null);

  // マウント後にのみ localStorage / matchMedia を読む（SSR 差異回避）。
  useEffect(() => {
    setMounted(true);
    const mq = window.matchMedia(WIDE);
    const applyWide = () => setWide(mq.matches);
    applyWide();
    mq.addEventListener("change", applyWide);
    try {
      setPinned(localStorage.getItem(PIN_KEY) === "1");
    } catch {
      /* localStorage 不可時は既定 false */
    }
    return () => mq.removeEventListener("change", applyWide);
  }, []);

  // 実効ドック＝ピン かつ 広い画面（狭幅ではオーバーレイに落とす）。
  const docked = mounted && pinned && wide;
  const overlayOpen = open && !docked;

  // 本文シフト＝<html> にクラス（レイアウトは server component のため DOM クラスで制御）。
  useEffect(() => {
    document.documentElement.classList.toggle("iq-nav-pinned", docked);
    return () => document.documentElement.classList.remove("iq-nav-pinned");
  }, [docked]);

  // オーバーレイ表示中はスクロールロック（ドック中はしない）。
  useEffect(() => {
    if (!overlayOpen) return;
    document.body.classList.add("iq-nav-lock");
    return () => document.body.classList.remove("iq-nav-lock");
  }, [overlayOpen]);

  // ルート遷移でオーバーレイは閉じる（ドックは維持）。
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const close = useCallback(() => setOpen(false), []);

  // Esc で閉じる＋Tab フォーカストラップ（オーバーレイ時のみ）。
  useEffect(() => {
    if (!overlayOpen) return;
    const el = drawerRef.current;
    el?.querySelector<HTMLElement>("a[href],button:not([disabled])")?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        close();
        burgerRef.current?.focus();
        return;
      }
      if (e.key === "Tab" && el) {
        const f = el.querySelectorAll<HTMLElement>("a[href],button:not([disabled])");
        if (f.length === 0) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [overlayOpen, close]);

  const togglePin = () => {
    setPinned((p) => {
      const next = !p;
      try {
        localStorage.setItem(PIN_KEY, next ? "1" : "0");
      } catch {
        /* noop */
      }
      return next;
    });
    setOpen(true); // ピン＝常設で開いた状態にする
  };

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  const renderItem = (it: NavItem) => {
    const active = isActive(it.href);
    return (
      <Link
        key={it.href}
        href={it.href}
        className={"appnav__item" + (active ? " is-active" : "")}
        role="menuitem"
        aria-current={active ? "page" : undefined}
        onClick={close}
      >
        <span className="appnav__ico" aria-hidden>
          {it.icon}
        </span>
        {it.label}
      </Link>
    );
  };

  return (
    <>
      <button
        ref={burgerRef}
        type="button"
        className="appnav-burger"
        aria-label="ナビゲーションメニュー"
        aria-expanded={overlayOpen || docked}
        aria-controls="appnav-drawer"
        onClick={() => setOpen((v) => !v)}
      >
        ☰
      </button>
      {mounted &&
        createPortal(
          <div className={"appnav-root" + (docked ? " is-docked" : "") + (overlayOpen ? " is-open" : "")}>
            <div className="appnav-backdrop" onClick={close} aria-hidden />
            <aside
              ref={drawerRef}
              id="appnav-drawer"
              className="appnav"
              role={docked ? "navigation" : "dialog"}
              aria-modal={!docked && overlayOpen ? true : undefined}
              aria-label="グローバルナビ"
              aria-hidden={!docked && !overlayOpen ? true : undefined}
            >
              <div className="appnav__head">
                <span className="appnav__title">メニュー</span>
                {wide && (
                  <button type="button" className="appnav-pin" aria-pressed={pinned} title="ピン留め（サイドバー固定）" onClick={togglePin}>
                    📌
                  </button>
                )}
                {!docked && (
                  <button type="button" className="appnav-x" aria-label="閉じる" onClick={close}>
                    ✕
                  </button>
                )}
              </div>
              <nav className="appnav__menu menu-pixel">
                <div className="appnav__grp">業務</div>
                {BIZ.map(renderItem)}
                {gameEnabled && (
                  <>
                    <div className="appnav__grp appnav__grp--game">ゲーム</div>
                    {GAME.map(renderItem)}
                  </>
                )}
              </nav>
              <div className="appnav__foot">アカウント / 設定 / 管理 / ログアウトは右上のメニュー</div>
            </aside>
          </div>,
          document.body,
        )}
    </>
  );
}
