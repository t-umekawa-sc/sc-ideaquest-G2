"use client";

// 共通ヘッダーのユーザーメニュー内「背景画像を変更／リセット」（K.4・FR-30・全認証画面に反映）。
// 変更＝PUT /me/background-image（multipart）、リセット＝DELETE。成功後 router.refresh() で全画面の背景に反映。
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { useSnackbar } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import { deleteBackgroundImage, setBackgroundImage } from "../api";

export function BackgroundImageMenuItem({ hasBackground }: { hasBackground: boolean }) {
  const router = useRouter();
  const snack = useSnackbar();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (inputRef.current) inputRef.current.value = "";
    if (!file) return;
    setBusy(true);
    try {
      await setBackgroundImage(file);
      router.refresh();
      snack({ type: "success", title: "背景画像を設定しました" });
    } catch (err) {
      snack({
        type: "error",
        title: "背景画像を設定できませんでした",
        msg: err instanceof ApiError && err.status === 422
          ? "形式またはサイズをご確認ください（PNG/JPEG/WebP/GIF・5MB まで）。" : "時間をおいて再試行してください。",
      });
    } finally {
      setBusy(false);
    }
  }

  async function onReset() {
    setBusy(true);
    try {
      await deleteBackgroundImage();
      router.refresh();
      snack({ type: "success", title: "背景画像をリセットしました" });
    } catch {
      snack({ type: "error", title: "リセットに失敗しました" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <li role="none">
        <button type="button" role="menuitem" disabled={busy} onClick={() => inputRef.current?.click()}>
          🖼 背景画像を変更
        </button>
      </li>
      {hasBackground && (
        <li role="none">
          <button type="button" role="menuitem" disabled={busy} onClick={onReset}>背景画像をリセット</button>
        </li>
      )}
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={onPick} />
    </>
  );
}
