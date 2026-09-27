"use client";

// SC-50「この情報からクエストを作成」＝機会特定→行動の動線（実 API・C.2 from_info_id）。正＝mocks/SC-50。
// 下書きクエストを作成し、サーバーが info_link（関連・manual）を自動生成する。作成後は新クエストへ遷移し、
// 参加部署・パーティー・6権限・カラー・公開は SC-11（クエスト編集）で仕上げる（本パネルは軽量な起票）。
import { useEffect, useState } from "react";

import { Field, FormFooterError, FormSummary, useFormErrorNotice, useSnackbar } from "@/components/ui";
import type { FieldErrors } from "@/lib/forms/validation";
import { ApiError } from "@/lib/api/client";
import { createQuestFromInfo, fetchInfoDetail } from "../api";
import type { InfoDetail } from "../types";
import "../info-input.css";

const DEFAULT_COLOR = "#0D9488"; // SC-11 と同じ既定色（カラーはクエスト編集で変更可）

// onDone は成功時の閉じ＝to を渡すと（RouteModal/standalone とも）その URL へ単一遷移する（作成した下書きへ）。
export function QuestFromInfoPanel({ infoId, onCancel, onDone }: { infoId: string; onCancel: () => void; onDone: (to?: string) => void }) {
  const snack = useSnackbar();
  const { summaryRef, notify } = useFormErrorNotice();
  const [info, setInfo] = useState<InfoDetail | undefined>(undefined);
  const [state, setState] = useState<"loading" | "ok" | "notfound">("loading");
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [category, setCategory] = useState("");
  const [due, setDue] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
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
    // §4.7＝送信時に全項目検証→Field 枠＋上部サマリ＋自動消滅トースト（単発 return しない）。
    const fe: FieldErrors = {};
    if (!n) fe.title = "クエスト件名を入力してください。";
    setErrors(fe);
    const list = Object.values(fe).filter(Boolean);
    if (list.length) { notify(list); return; }
    setSaving(true);
    try {
      // カテゴリは自由入力を区切って配列化（任意）。カラーは既定（SC-11 で変更可）。
      const categories = category.split(/[、,\/／]/).map((s) => s.trim()).filter(Boolean);
      const created = await createQuestFromInfo({
        title: n, color: DEFAULT_COLOR, purpose: purpose.trim() || null, categories, deadline: due || null, from_info_id: infoId,
      });
      snack({ type: "success", title: `クエスト「${n}」を下書き作成しました`, msg: "この情報を関連リンク（関連）として紐づけました。参加部署・パーティー・公開はクエスト編集で仕上げてください。" });
      onDone(`/quests/${created.id}`); // 作成した下書きへ単一遷移＝SC-11 で本設定（close(to) 経由）
    } catch (e) {
      setSaving(false);
      let fieldMsg = "クエストを作成できませんでした。時間をおいて再度お試しください。";
      if (e instanceof ApiError) {
        const errs = (e.body as { errors?: { field?: string }[] } | null)?.errors ?? [];
        if (errs.some((x) => x.field === "title")) fieldMsg = "クエスト件名を確認してください。";
      }
      setErrors({ title: fieldMsg });
      notify([fieldMsg]);
    }
  };

  return (
    <>
      <div className="modal__body">
        <FormSummary title="入力内容をご確認ください" errors={Object.values(errors).filter(Boolean)} innerRef={summaryRef} />
        <details className="disclosure disclosure--ref" open style={{ marginBottom: "var(--space-3)" }}>
          <summary><span>🧭 元情報：<strong>{info.title}</strong></span></summary>
          <div className="disclosure__body">
            <div className="rt-view" dangerouslySetInnerHTML={{ __html: info.body_html ?? "" }} />
            <div className="hint" style={{ marginTop: 8 }}>作成するクエストにこの情報が<strong>関連リンク（関連）</strong>として自動で紐づきます（<code>info_link</code>・origin=manual・C.2 の <code>from_info_id</code>）。</div>
          </div>
        </details>

        <Field id="qfi-name" label="クエスト件名" required error={errors.title}>
          <input className="input" id="qfi-name" value={name} onChange={(e) => { setName(e.target.value); setErrors((x) => ({ ...x, title: "" })); }} placeholder="例: 生成AIの社内活用を推進する" />
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
        <button className="btn btn-outline dialog-close-left" type="button" onClick={onCancel} disabled={saving}>キャンセル</button>
        <FormFooterError show={Object.values(errors).some(Boolean)} />
        <button className="btn btn-primary" type="button" onClick={create} disabled={saving}>{saving ? "作成中…" : "下書きを作成"}</button>
      </div>
    </>
  );
}
