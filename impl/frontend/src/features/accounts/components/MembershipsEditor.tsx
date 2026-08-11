"use client";

// 所属エディタ（B.2/B.3）＝選択済みグループを行表示＋役割セグメント（member/admin）＋削除、末尾に追加プルダウン。
// `admin` 指定＝QG管理者の任命（system_admin＋会社アカウント管理者が可・B.2.1）。表示/UX のみ、判定はサーバー。
import type { Membership, QuestGroup } from "../types";

export function MembershipsEditor({
  value,
  groups,
  onChange,
}: {
  value: Membership[];
  groups: QuestGroup[];
  onChange: (v: Membership[]) => void;
}) {
  const used = new Set(value.map((m) => m.group_id));
  const rest = groups.filter((g) => !used.has(g.group_id));
  const nameOf = (id: string) => groups.find((g) => g.group_id === id)?.name ?? id;

  return (
    <div>
      {value.map((m, i) => (
        <div key={m.group_id} style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", marginBlock: "var(--space-1)" }}>
          <span style={{ minWidth: "8rem" }}>{nameOf(m.group_id)}</span>
          <select
            className="input"
            aria-label={`${nameOf(m.group_id)} の役割`}
            value={m.role}
            onChange={(e) => {
              const next = [...value];
              next[i] = { ...m, role: e.target.value as Membership["role"] };
              onChange(next);
            }}
          >
            <option value="member">メンバー</option>
            <option value="admin">管理者</option>
          </select>
          <button type="button" aria-label={`${nameOf(m.group_id)} を削除`} onClick={() => onChange(value.filter((_, j) => j !== i))}>
            ✕
          </button>
        </div>
      ))}
      <select
        className="input"
        aria-label="所属グループを追加"
        value=""
        disabled={rest.length === 0}
        onChange={(e) => {
          if (e.target.value) onChange([...value, { group_id: e.target.value, role: "member" }]);
        }}
      >
        <option value="">{rest.length === 0 ? "追加できるグループがありません" : "＋グループを追加…"}</option>
        {rest.map((g) => (
          <option key={g.group_id} value={g.group_id}>{g.name}</option>
        ))}
      </select>
    </div>
  );
}
