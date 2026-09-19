"use client";

// SC-50「この情報からクエストを作成」＝機会特定→行動の動線（軽量デモ）。正＝mocks/SC-50。
// 実装では SC-11 クエスト作成の本フォームを開き、保存時にサーバーが info_link を作成する（API C の from_info_id）。
// デモはこの情報に関連リンク（クエスト・関連・origin=manual）を追加して結び付きを示す。
import { useState } from "react";

import { Field, useSnackbar } from "@/components/ui";
import { getInfoItem, linkQuestFromInfo } from "../api";
import "../info-input.css";

export function QuestFromInfoPanel({ infoId, onCancel, onDone }: { infoId: string; onCancel: () => void; onDone: () => void }) {
  const info = getInfoItem(infoId);
  const snack = useSnackbar();
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState(info?.summary ?? "");
  const [category, setCategory] = useState("");
  const [due, setDue] = useState("");
  const [nameErr, setNameErr] = useState<string | null>(null);

  if (!info) {
    return <div className="modal__body"><p className="muted">対象の情報が見つかりません。</p></div>;
  }

  const create = () => {
    const n = name.trim();
    if (!n) { setNameErr("クエスト件名を入力してください"); return; }
    linkQuestFromInfo(infoId, n); // デモ＝この情報へ関連リンク（クエスト・関連）を追加（実装はサーバーが from_info_id で作成）
    snack({ type: "success", title: `クエスト「${n}」を作成しました（デモ）`, msg: "この情報を関連リンク（関連）として紐づけました。実装では SC-11 の本フォーム＋API C から作成します。" });
    onDone();
  };

  return (
    <>
      <div className="modal__body">
        <details className="disclosure disclosure--ref" open style={{ marginBottom: "var(--space-3)" }}>
          <summary><span>🧭 元情報：<strong>{info.title}</strong></span></summary>
          <div className="disclosure__body">
            <div className="rt-view" dangerouslySetInnerHTML={{ __html: info.body_html }} />
            <div className="hint" style={{ marginTop: 8 }}>作成するクエストにこの情報が<strong>関連リンク（関連）</strong>として自動で紐づきます（<code>info_link</code>・origin=manual・API C の <code>from_info_id</code>）。</div>
          </div>
        </details>

        <Field id="qfi-name" label="クエスト件名" required error={nameErr}>
          <input className="input" id="qfi-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="例: 生成AIの社内活用を推進する" />
        </Field>
        <Field id="qfi-purpose" label="目的・テーマ" hint="元情報の要約から下書きしています（編集可）。" className="dialog-section">
          <textarea className="input" id="qfi-purpose" rows={3} value={purpose} onChange={(e) => setPurpose(e.target.value)} />
        </Field>
        <Field id="qfi-cat" label="カテゴリー" className="dialog-section">
          <input className="input" id="qfi-cat" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="例: 業務改善 / 新規事業" />
        </Field>
        <Field id="qfi-due" label="締切" className="dialog-section">
          <input className="input" id="qfi-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
        <div className="field-note">デモです。実装では <strong>SC-11 クエスト作成の本フォーム</strong>（参加部署・パーティー・6権限 等）を開き、保存時にサーバーが info_link を作成します（API C＝from_info_id）。</div>
      </div>
      <div className="modal__footer">
        <button className="btn btn-outline" type="button" onClick={onCancel}>キャンセル</button>
        <button className="btn btn-primary" type="button" onClick={create}>クエストを作成</button>
      </div>
    </>
  );
}
