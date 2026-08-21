"use client";

// SC-10 クエスト一覧＝「所属グループ内で作られ、かつ自分がパーティー参加中」のクエスト（B/クエストドメイン）。
// レイアウト/コピーの正＝doc/画面設計/mocks/SC-10_クエスト一覧.html（DoD＝モック一致）。
// backend 接続（C.1 GET /quests・C.4 GET /quest-groups）＝マウント時フェッチ→ビュー型へマッピング。
// 一覧操作は DataTable（client モード）に委譲＝検索/絞込(状態/カテゴリー/グループ)/ソート/表示切替/CSV/ピン。
// カードは cardRaw で専用クエストカード（アクセント左帯＋クエストアイコン・SC-01/SC-12 と一貫）を完全制御。
// 参照制限（所属グループ×パーティー参加中／自分の下書き）はサーバー強制（FR-15）。下書きは本人だけに表示（グレー）。
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { DataTable } from "@/components/ui";
import type { DataTableColumn } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import { listQuests, type QuestCard } from "../api";
// quest-card / page-head / idea-title / deadline は design-system.css の共有クラス（追加インポート不要）。

type Quest = {
  id: string; title: string; theme: string; cat: string; cats: string[]; status: string; group: string;
  owner: string; char: string; accent: string; iconUrl: string | null; deadline: string; dl: number;
  soon: boolean; party: number; ideas: number; my: string; order: number; draft?: boolean;
};

// quest_status（enum・§3）→ 画面ラベル。"選定" は enum でなく evaluating〜completed の選定行為の呼称（C.5）。
const STATUS_LABEL: Record<string, string> = {
  draft: "下書き", recruiting: "募集中", in_progress: "進行中", evaluating: "評価中", completed: "完了",
};

function statusBadge(s: string): string {
  if (s === "完了" || s === "下書き") return "badge badge-muted";
  if (s === "選定") return "badge badge-success";
  return "badge";
}
function myBadge(m: string): string {
  if (m === "未投稿") return "badge badge-danger";
  if (m === "投稿済み") return "badge badge-success";
  return "badge badge-muted";
}
// 下書きは本人だけに見え、クリックで SC-11 編集モーダル。公開クエストは SC-12 詳細。
function questHref(x: Quest): string {
  return x.draft ? "/quests/new" : `/quests/${x.id}`;
}

// 締切文字列（YYYY-MM-DD）→ 表示（YYYY/MM/DD）・ソート用数値・締切近接（14日以内）。
function parseDeadline(d: string | null | undefined): { deadline: string; dl: number; soon: boolean } {
  if (!d) return { deadline: "—", dl: 99999999, soon: false };
  const [y, m, day] = d.split("-").map((n) => Number(n));
  const dl = y * 10000 + m * 100 + day;
  const target = new Date(y, m - 1, day).getTime();
  const days = (target - Date.now()) / 86400000;
  return { deadline: `${y}/${String(m).padStart(2, "0")}/${String(day).padStart(2, "0")}`, dl, soon: days >= 0 && days <= 14 };
}

// backend DTO（C.1）→ 一覧ビュー型。theme/purpose は一覧DTOに無い（検索は件名/カテゴリー）。
// my_state は draft/member（未投稿/投稿済みはドメイン D 実装後・現状 member=未投稿の暫定表示）。
function toQuest(c: QuestCard, index: number, total: number): Quest {
  const dl = parseDeadline(c.deadline);
  const status = STATUS_LABEL[c.status] ?? c.status;
  const draft = c.my_state === "draft";
  return {
    id: c.id, title: c.title, theme: "", cat: c.categories[0] ?? "", cats: c.categories,
    status, group: c.quest_group.name, owner: (c.owner.display_name || "?").slice(0, 1),
    char: (c.title || "?").slice(0, 1), accent: c.color, iconUrl: c.icon_image_url ?? null,
    deadline: dl.deadline, dl: dl.dl, soon: dl.soon, party: c.member_count, ideas: c.idea_count,
    my: draft ? "下書き" : "未投稿", order: total - index, draft,
  };
}

function QuestIcon({ q }: { q: Quest }) {
  return (
    <span className="quest-icon sm" style={{ ["--accent" as string]: q.accent } as React.CSSProperties}>
      {q.iconUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- 署名URL（unoptimized・§5）
        <img className="quest-icon__img" src={q.iconUrl} alt="" />
      ) : (
        <>
          <span className="quest-icon__char">{q.char}</span>
          <span className="quest-icon__owner placeholder">{q.owner}</span>
        </>
      )}
    </span>
  );
}

const STATUS_OPTIONS: [string, string][] = [["下書き", "下書き"], ["募集中", "募集中"], ["進行中", "進行中"], ["評価中", "評価中"], ["完了", "完了"]];
const MY_OPTIONS: [string, string][] = [["未投稿", "未投稿"], ["投稿済み", "投稿済み"], ["下書き", "下書き"]];

export function QuestListView() {
  const router = useRouter();
  const [quests, setQuests] = useState<Quest[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await listQuests({ limit: 100 });
        if (!alive) return;
        const rows = (res?.data ?? []).map((c, i, arr) => toQuest(c, i, arr.length));
        setQuests(rows);
      } catch (err) {
        if (!alive) return;
        setLoadError(err instanceof ApiError && err.status === 401
          ? "セッションが切れています。再ログインしてください。"
          : "クエスト一覧の取得に失敗しました。");
      }
    })();
    return () => { alive = false; };
  }, []);

  // 絞り込み候補（カテゴリー/グループ）は取得データから動的生成＝実データに一致（SC-11 の候補 API は後続）。
  const catOptions = useMemo<[string, string][]>(() => {
    const set = new Set<string>();
    for (const q of quests ?? []) for (const c of q.cats) set.add(c);
    return [...set].map((c) => [c, c]);
  }, [quests]);
  const groupOptions = useMemo<[string, string][]>(() => {
    const set = new Set<string>();
    for (const q of quests ?? []) set.add(q.group);
    return [...set].map((g) => [g, g]);
  }, [quests]);

  const columns: DataTableColumn<Quest>[] = [
    {
      key: "title", label: "クエスト", locked: true, width: 300, sortable: true, filter: { type: "text" },
      sortVal: (x) => x.title, searchVal: (x) => `${x.title} ${x.cats.join(" ")}`, csvVal: (x) => x.title,
      render: (x) => (
        <span className="row-center" style={{ gap: "var(--space-2)" }}>
          <QuestIcon q={x} /><span className="idea-title">{x.title}</span>
        </span>
      ),
    },
    { key: "cat", label: "カテゴリー", width: 130, sortable: true, filter: { type: "enum", options: catOptions }, sortVal: (x) => x.cat, filterVal: (x) => x.cat, render: (x) => <span className="badge badge-muted">{x.cat}</span> },
    { key: "status", label: "ステータス", width: 120, sortable: true, filter: { type: "enum", options: STATUS_OPTIONS }, sortVal: (x) => x.status, filterVal: (x) => x.status, render: (x) => <span className={statusBadge(x.status)}>{x.status}</span> },
    { key: "group", label: "グループ", width: 170, hiddenDefault: true, sortable: true, filter: { type: "enum", options: groupOptions }, sortVal: (x) => x.group, filterVal: (x) => x.group, csvVal: (x) => x.group, render: (x) => x.group },
    { key: "deadline", label: "締切", width: 120, sortable: true, sortVal: (x) => x.dl, filter: { type: "text" }, filterVal: (x) => x.deadline, csvVal: (x) => x.deadline, render: (x) => <span className={x.soon ? "deadline soon" : "deadline"}>{x.deadline}</span> },
    { key: "party", label: "👥", width: 80, align: "num", sortable: true, filter: { type: "number" }, sortVal: (x) => x.party, filterVal: (x) => x.party, render: (x) => x.party },
    { key: "ideas", label: "💡", width: 80, align: "num", sortable: true, filter: { type: "number" }, sortVal: (x) => x.ideas, filterVal: (x) => x.ideas, render: (x) => x.ideas },
    { key: "my", label: "あなた", width: 110, sortable: true, filter: { type: "enum", options: MY_OPTIONS }, sortVal: (x) => x.my, filterVal: (x) => x.my, render: (x) => <span className={myBadge(x.my)}>{x.my}</span> },
  ];

  return (
    <section aria-label="クエスト一覧">
      <Link className="backlink" href="/">← ダッシュボードへ戻る</Link>
      <div className="page-head">
        <h1>クエスト一覧</h1>
        {/* 作成は SC-11（モーダル）。現状は quests/new へ（後日 URL モーダル化）。 */}
        <Link href="/quests/new" className="btn btn-primary">＋ クエストを作成</Link>
      </div>
      <p className="muted text-sm" style={{ marginBottom: "var(--space-4)" }}>
        「所属グループ内で作られ、かつ自分がパーティー参加中」のクエストを表示します。
      </p>

      {loadError ? (
        <p className="form-error" role="alert">{loadError}</p>
      ) : quests === null ? (
        <p className="muted">読み込み中…</p>
      ) : (
        <DataTable<Quest>
          storageKey="sc10-quests"
          data={quests}
          columns={columns}
          rowId={(x) => x.id}
          unit="件"
          perPage={12}
          perPageOptions={[12, 24, 48]}
          maxPins={5}
          defaultView="card"
          searchFields="件名・カテゴリー"
          exportName="クエスト一覧"
          emptyText="該当するクエストがありません。条件を変えてお試しください。"
          onRowClick={(x) => router.push(questHref(x))}
          cardRaw={(x) => (
            <Link className="card card-accent quest-card" href={questHref(x)} style={{ ["--accent" as string]: x.accent } as React.CSSProperties}>
              <div className="between">
                <span className="row-center" style={{ gap: "var(--space-2)", minWidth: 0 }}>
                  <QuestIcon q={x} /><span className="card-title">{x.title}</span>
                </span>
                <span className={statusBadge(x.status)}>{x.status}</span>
              </div>
              <div className="quest-card__meta">
                {x.cat ? <span className="badge badge-muted">{x.cat}</span> : null}
                <span className={x.soon ? "deadline soon" : "deadline"}>⏳ 締切 {x.deadline}</span>
              </div>
              <div className="quest-card__stats">
                <span>👥 {x.party}</span>
                <span>💡 {x.ideas}</span>
                <span className={myBadge(x.my)}>{x.my}</span>
              </div>
            </Link>
          )}
        />
      )}

      <p className="muted text-xs" style={{ marginTop: "var(--space-6)" }}>
        作成した下書きのクエストは、本人だけに一覧表示されます（下書きバッジ・グレー表示）。
      </p>
    </section>
  );
}
