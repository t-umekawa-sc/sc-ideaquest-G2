"use client";

// SC-50「この情報からクエストを作成」＝機会特定→行動の動線（実 API・C.2 from_info_id）。正＝mocks/SC-50。
// 下書きクエストを作成し、サーバーが info_link（関連・manual）を自動生成する。作成後は新クエストへ遷移し、
// 参加部署・パーティー・6権限・カラー・公開は SC-11（クエスト編集）で仕上げる（本パネルは軽量な起票）。
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Field, useSnackbar } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import { createQuestFromInfo, fetchInfoDetail } from "../api";
import type { InfoDetail } from "../types";
import "../info-input.css";

const DEFAULT_COLOR = "#0D9488"; // SC-11 と同じ既定色（カラーはクエスト編集で変更可）

export function QuestFromInfoPanel({ infoId, onCancel, onDone }: { infoId: string; onCancel: () => void; onDone: () => void }) {
  const router = useRouter();
  const snack = useSnackbar();
  const [info, setInfo] = useState<InfoDetail | undefined>(undefined);
  const [state, setState] = useState<"loading" | "ok" | "notfound">("loading");
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [category, setCategory] = useState("");
  const [due, setDue] = useState("");
  const [nameErr, setNameErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    setState("loading");
    fetchInfoDetail(infoId, ac.signal)
      .then((d) => { if (d) { setInfo(d); setPurpose(d.summary ?? ""); setState("ok"); } else { setState("notfound"); } })
      .catch(() => setState("notfound"));
    return () => ac.abort();
  }, [infoId]);

  if (state === "loading") return <div className="modal__body"><p className="muted">読み込み中…</p></div>;
  if (state === "notfound" || !info) return <div className="modal__body"><p className="muted">対象の情報が見つかりません。</p></div>;

  const create = async () => {
    const n = name.trim();
    if (!n) { setNameErr("クエスト件名を入力してください"); return; }
    setNameErr(null);
    setSaving(true);
    try {
      // カテゴリは自由入力を区切って配列化（任意）。カラーは既定（SC-11 で変更可）。
      const categories = category.split(/[、,\/／]/).map((s) => s.trim()).filter(Boolean);
      const created = await createQuestFromInfo({
        title: n, color: DEFAULT_COLOR, purpose: purpose.trim() || null, categories, deadline: due || null, from_info_id: infoId,
      });
      snack({ type: "success", title: `クエスト「${n}」を下書き作成しました`, msg: "この情報を関連リンク（関連）として紐づけました。参加部署・パーティー・公開はクエスト編集で仕上げてください。" });
      onDone();
      setTimeout(() => router.push(`/quests/${created.id}`), 0); // 作成した下書きへ遷移＝SC-11 で本設定
    } catch (e) {
      if (e instanceof ApiError) {
        const errs = (e.body as { errors?: { field?: string }[] } | null)?.errors ?? [];
        if (errs.some((x) => x.field === "title")) setNameErr("クエスト件名を確認してください");
        else setNameErr("クエストを作成できませんでした。時間をおいて再度お試しください。");
      } else {
        setNameErr("クエストを作成できませんでした。時間をおいて再度お試しください。");
      }
      setSaving(false);
    }
  };

  return (
    <>
      <div className="modal__body">
        <details className="disclosure disclosure--ref" open style={{ marginBottom: "var(--space-3)" }}>
          <summary><span>🧭 元情報：<strong>{info.title}</strong></span></summary>
          <div className="disclosure__body">
            <div className="rt-view" dangerouslySetInnerHTML={{ __html: info.body_html ?? "" }} />
            <div className="hint" style={{ marginTop: 8 }}>作成するクエストにこの情報が<strong>関連リンク（関連）</strong>として自動で紐づきます（<code>info_link</code>・origin=manual・C.2 の <code>from_info_id</code>）。</div>
          </div>
        </details>

        <Field id="qfi-name" label="クエスト件名" required error={nameErr}>
          <input className="input" id="qfi-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="例: 生成AIの社内活用を推進する" />
        </Field>
        <Field id="qfi-purpose" label="目的・テーマ" hint="元情報の要約から下書きしています（編集可）。">
          <textarea className="input" id="qfi-purpose" rows={3} value={purpose} onChange={(e) => setPurpose(e.target.value)} />
        </Field>
        <Field id="qfi-cat" label="カテゴリー（任意・「/」区切りで複数）">
          <input className="input" id="qfi-cat" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="例: 業務改善 / 新規事業" />
        </Field>
        <Field id="qfi-due" label="締切（任意）">
          <input className="input" id="qfi-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
        <div className="field-note">下書きクエストとして作成します。<strong>参加部署・パーティー・6権限・カラー・公開</strong>は、作成後のクエスト編集（SC-11）で設定してください。</div>
      </div>
      <div className="modal__footer">
        <button className="btn btn-outline" type="button" onClick={onCancel} disabled={saving}>キャンセル</button>
        <button className="btn btn-primary" type="button" onClick={create} disabled={saving}>{saving ? "作成中…" : "クエストを作成"}</button>
      </div>
    </>
  );
}
