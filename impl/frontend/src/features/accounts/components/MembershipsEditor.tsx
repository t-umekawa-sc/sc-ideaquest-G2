"use client";

// 所属エディタ（B.2/B.3）＝グループ選択（複数選択コンボ・選んでも開いたまま）＋選択済みグループごとの役割セグメント（member/admin）。
// `admin` 指定＝QG管理者の任命（system_admin＋会社アカウント管理者が可・B.2.1）。表示/UX のみ、判定はサーバー。
// グループ追加は `.multiselect`（候補が開いたまま複数追加できる＝native select だと選択で閉じるため差し替え）。
import { Multiselect, type MultiselectOption } from "@/components/ui";
import type { Membership, QuestGroup } from "../types";

export function MembershipsEditor({
  value,
  groups,
  onChange,
  readOnly = false,
}: {
  value: Membership[];
  groups: QuestGroup[];
  onChange: (v: Membership[]) => void;
  // 読み取り専用（編集画面で現在の所属を編集不可表示する用途・B.3）。役割/削除/追加の操作は出さない。
  readOnly?: boolean;
}) {
  const nameOf = (id: string) => groups.find((g) => g.group_id === id)?.name ?? id;

  if (readOnly) {
    return (
      <div>
        {value.length > 0 ? (
          <div className="mrows">
            {value.map((m) => (
              <div className="mrow is-readonly" key={m.group_id}>
                <span className="mrow__name">{nameOf(m.group_id)}</span>
                <span className="badge badge-muted">{m.role === "admin" ? "管理者" : "メンバー"}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="mrow-empty">現在、所属しているクエストグループはありません。</div>
        )}
      </div>
    );
  }

  // グループ選択＝複数選択コンボ（選んでも開いたまま複数追加可）。選択集合の変更で memberships を再構成（既存の役割は保持）。
  const options: MultiselectOption[] = groups.map((g) => ({ value: g.group_id, label: g.name }));
  const selectedIds = value.map((m) => m.group_id);
  const onSelectIds = (ids: string[]) => {
    onChange(ids.map((id) => value.find((m) => m.group_id === id) ?? { group_id: id, role: "member" }));
  };

  return (
    <div>
      <Multiselect
        options={options}
        value={selectedIds}
        onChange={onSelectIds}
        placeholder="グループを検索して追加…（選択後も開いたまま）"
        ariaLabel="所属グループを追加"
        emptyText="追加できるグループがありません"
      />
      {value.length > 0 ? (
        // 選択済みグループごとの役割（メンバー/管理者）。削除はコンボのチップ✕でも可。
        <div className="mrows" style={{ marginTop: "var(--space-2)" }}>
          {value.map((m, i) => (
            <div className="mrow" key={m.group_id}>
              <span className="mrow__name">{nameOf(m.group_id)}</span>
              <div className="seg" role="group" aria-label={`${nameOf(m.group_id)} の役割`}>
                {(["member", "admin"] as const).map((role) => (
                  <button
                    key={role}
                    type="button"
                    className="seg__btn"
                    aria-pressed={m.role === role}
                    onClick={() => {
                      const next = [...value];
                      next[i] = { ...m, role };
                      onChange(next);
                    }}
                  >
                    {role === "member" ? "メンバー" : "管理者"}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="mrow__remove"
                aria-label={`${nameOf(m.group_id)} を削除`}
                onClick={() => onChange(value.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="mrow-empty" style={{ marginTop: "var(--space-2)" }}>所属グループはまだありません。上のコンボから選択してください。</div>
      )}
    </div>
  );
}
