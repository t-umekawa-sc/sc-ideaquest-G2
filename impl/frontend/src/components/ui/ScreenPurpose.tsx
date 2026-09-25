"use client";

// 画面の狙い/用語ガイダンス（横断標準・デザイン標準 §4.13）。既定=ⓘ＋短ラベル／ホバー・フォーカスで本文を
// フローティング展開（絶対配置＝在来フローを動かさず地続き1ピル）／収まらなければ流れる（マーキー・折返さず端クランプ）
// ／クリックで全文ダイアログ。見本＝mocks/style-guide.html「4d」。CSS＝styles/design-system.css `.screen-purpose`。
// モーション抑制（OS or accounts.reduce_motion・§4.9）は reduceMotion() と CSS の [data-anim-reduced] で尊重する。
import { useEffect, useRef, useState } from "react";

import { reduceMotion } from "@/lib/motion";

import { Modal, ModalBody, ModalFooter } from "./Modal";
import { Button } from "./Button";

type Props = {
  label?: string; // 既定で見える短ラベル。省略＝ⓘ アイコンのみ（傍に文脈がある時＝評価観点など）
  summary: string; // ホバーで広がる一行（収まらなければ流れる）
  dialogTitle: string; // 全文ダイアログのタイトル
  children: React.ReactNode; // 全文ダイアログ本文（定義・目的・粒度 等）
};

// 溢れ幅から移動距離/尺を算出し .is-marquee を付ける（≒45px/秒）。抑制時は流さない。
function applyMarquee(band: HTMLElement, vpWidth: number): void {
  const text = band.querySelector<HTMLElement>(".screen-purpose__text");
  band.classList.remove("is-marquee");
  band.style.removeProperty("--sp-dist");
  band.style.removeProperty("--sp-dur");
  if (!text || reduceMotion()) return;
  const over = text.scrollWidth - vpWidth;
  if (over > 8) {
    band.classList.add("is-marquee");
    band.style.setProperty("--sp-dist", `${-over}px`);
    band.style.setProperty("--sp-dur", `${Math.max(4, Math.round(over / 45))}s`);
  }
}

// フローティング配置＝在来フローを動かさず、ホスト（[data-sp-host] or 親）の右端までに収める（折返さず・見切れさせず）。
function place(band: HTMLElement): number {
  const host = (band.closest("[data-sp-host]") as HTMLElement | null) ?? band.parentElement ?? band;
  const b = band.getBoundingClientRect();
  const h = host.getBoundingClientRect();
  const rightRoom = Math.floor(h.right - b.right - 16);
  const cap = Math.max(140, Math.min(460, rightRoom));
  band.style.setProperty("--sp-vp", `${cap}px`);
  return cap;
}

export function ScreenPurpose({ label, summary, dialogTitle, children }: Props) {
  const bandRef = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const band = bandRef.current;
    if (!band) return;
    const expand = () => {
      if (timer.current) clearTimeout(timer.current);
      applyMarquee(band, Math.max(60, place(band) - 70)); // 即・想定 vp 幅で流し始め
      if (reduceMotion()) return;
      timer.current = setTimeout(() => {
        const vp = band.querySelector<HTMLElement>(".screen-purpose__vp");
        applyMarquee(band, vp?.clientWidth || place(band) - 70); // 展開しきったら実幅で補正
      }, 240);
    };
    const collapse = () => {
      if (timer.current) clearTimeout(timer.current);
      band.classList.remove("is-marquee");
    };
    band.addEventListener("mouseenter", expand);
    band.addEventListener("focusin", expand);
    band.addEventListener("mouseleave", collapse);
    band.addEventListener("focusout", collapse);
    return () => {
      band.removeEventListener("mouseenter", expand);
      band.removeEventListener("focusin", expand);
      band.removeEventListener("mouseleave", collapse);
      band.removeEventListener("focusout", collapse);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return (
    <>
      <button
        ref={bandRef}
        type="button"
        className={`screen-purpose${label ? "" : " screen-purpose--icon-only"}`}
        aria-haspopup="dialog"
        aria-label={`${label ?? dialogTitle}（ホバーで説明・クリックで全文）`}
        title={`${label ?? dialogTitle}（クリックで全文）`}
        onClick={() => setOpen(true)}
      >
        <span className="screen-purpose__icon" aria-hidden="true">ⓘ</span>
        {label && <span className="screen-purpose__label">{label}</span>}
        <span className="screen-purpose__pop">
          <span className="screen-purpose__vp"><span className="screen-purpose__text">{summary}</span></span>
          <span className="screen-purpose__more" aria-hidden="true">全文</span>
        </span>
      </button>
      {open && (
        <Modal open={open} onClose={() => setOpen(false)} title={dialogTitle} size="md" draggable={false} maximizable={false}>
          <ModalBody>{children}</ModalBody>
          <ModalFooter>
            <Button variant="primary" onClick={() => setOpen(false)}>閉じる</Button>
          </ModalFooter>
        </Modal>
      )}
    </>
  );
}
