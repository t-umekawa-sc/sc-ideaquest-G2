"use client";

// 購入成立の演出（SC-30・ゲーム感 #12）＝受入済みモック（style-guide.html §17M）を移植。
// ① ShopPayFx＝右上（財布）から ◆ コインが価格へ降りて吸い込まれ、価格が price→0 と減って支払い完了（座標固定オーバーレイ・価格矩形に重ねる）。
// ② ItemCelebrateFx＝支払い完了後の祝福＋お礼＝紙吹雪＋「〈アイテム名〉を手に入れた」（カード矩形に重ねる）。
// いずれも純視覚（aria-hidden・pointer-events none）。生成/破棄は親が管理（reduce-motion 時は親が生成しない）。
import { useEffect, useRef, useState } from "react";

import { PAY_MS, payValues } from "../shopFx";

export type GetRect = { top: number; left: number; width: number; height: number };

// ① 支払い＝価格矩形に重ね、右上から降る ◆ コインが吸い込まれ、数字が price→0 と減る。0 到達後に onDone。
export function ShopPayFx({ rect, price, onDone }: { rect: GetRect; price: number; onDone: () => void }) {
  const [val, setVal] = useState(price);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  useEffect(() => {
    const seq = payValues(price);
    let i = 0;
    const iv = setInterval(() => {
      setVal(seq[i]);
      i += 1;
      if (i >= seq.length) {
        clearInterval(iv);
        setTimeout(() => onDoneRef.current(), 280);
      }
    }, PAY_MS / seq.length);
    return () => clearInterval(iv);
  }, [price]);
  return (
    <div className="item-get" style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }} aria-hidden>
      {[0, 1, 2, 3, 4, 5].map((k) => (
        <span key={k} className={`item-get__rain item-get__rain--${k}`}>◆</span>
      ))}
      <span className={`item-get__pay${val <= 0 ? " is-paid" : ""}`}>◆ {val}</span>
    </div>
  );
}

// ② 祝福＋お礼＝カード矩形に重ね、紙吹雪＋金地ピル「🎉 〈アイテム名〉を手に入れた」。
export function ItemCelebrateFx({ rect, name }: { rect: GetRect; name: string }) {
  return (
    <div className="item-get" style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }} aria-hidden>
      <span className="item-get__spark item-get__spark--0">✨</span>
      <span className="item-get__spark item-get__spark--1">✦</span>
      <span className="item-get__spark item-get__spark--2">✨</span>
      <span className="item-get__spark item-get__spark--3">✦</span>
      <span className="item-get__confetti item-get__confetti--0">🎉</span>
      <span className="item-get__confetti item-get__confetti--1">🎊</span>
      <span className="item-get__confetti item-get__confetti--2">✨</span>
      <span className="item-get__confetti item-get__confetti--3">✦</span>
      <span className="item-get__thanks">🎉 {name}を手に入れた</span>
    </div>
  );
}
