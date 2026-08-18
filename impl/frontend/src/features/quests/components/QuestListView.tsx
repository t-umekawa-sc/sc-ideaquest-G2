"use client";

// SC-10 クエスト一覧＝「所属グループ内で作られ、かつ自分がパーティー参加中」のクエスト（B/クエストドメイン）。
// レイアウト/コピーの正＝doc/画面設計/mocks/SC-10_クエスト一覧.html（DoD＝モック一致）。
// 一覧操作は DataTable（client モード）に委譲＝検索/絞込(状態/カテゴリー/グループ)/ソート/表示切替/CSV/ピン。
// カードは cardRaw で専用クエストカード（アクセント左帯＋クエストアイコン・SC-01/SC-12 と一貫）を完全制御。
// フロントエンド実装フロー規約＝画面モック先行（デモデータ）。下書きは本人だけに表示（グレー）。
import Link from "next/link";
import { useRouter } from "next/navigation";

import { DataTable } from "@/components/ui";
import type { DataTableColumn } from "@/components/ui";
// quest-card / page-head / idea-title / deadline は design-system.css の共有クラス（追加インポート不要）。

type Quest = {
  id: string; title: string; theme: string; cat: string; status: string; group: string;
  owner: string; char: string; accent: string; deadline: string; dl: number; soon: boolean;
  party: number; ideas: number; my: string; order: number; draft?: boolean;
};

const QUESTS: Quest[] = [
  { id: "1", title: "配送ルート最適化", theme: "配送コストとCO2削減の両立", cat: "業務改善", status: "評価中", group: "プロダクト開発部", owner: "山", char: "配", accent: "#0D9488", deadline: "2026/12/20", dl: 20261220, soon: true, party: 6, ideas: 8, my: "未投稿", order: 6 },
  { id: "2", title: "社内ナレッジ検索AI", theme: "問い合わせ対応の工数を半減", cat: "新規事業", status: "選定", group: "プロダクト開発部", owner: "鈴", char: "社", accent: "#7C3AED", deadline: "2026/12/24", dl: 20261224, soon: false, party: 4, ideas: 12, my: "投稿済み", order: 5 },
  { id: "3", title: "経費精算の自動化", theme: "締め作業のムダをなくす", cat: "コスト削減", status: "募集中", group: "全社改善プロジェクト", owner: "田", char: "経", accent: "#EA580C", deadline: "2027/01/10", dl: 20270110, soon: false, party: 5, ideas: 3, my: "投稿済み", order: 4 },
  { id: "4", title: "顧客サポートの品質向上", theme: "一次回答の速度と満足度を上げる", cat: "顧客体験", status: "進行中", group: "全社改善プロジェクト", owner: "伊", char: "顧", accent: "#2563EB", deadline: "2026/12/28", dl: 20261228, soon: false, party: 7, ideas: 15, my: "未投稿", order: 3 },
  { id: "5", title: "社内イベント活性化", theme: "部署横断の交流を増やす", cat: "業務改善", status: "完了", group: "プロダクト開発部", owner: "佐", char: "社", accent: "#DB2777", deadline: "2026/11/30", dl: 20261130, soon: false, party: 5, ideas: 9, my: "投稿済み", order: 2 },
  { id: "6", title: "オフィス省エネ", theme: "電力コストと環境負荷を下げる", cat: "コスト削減", status: "募集中", group: "全社改善プロジェクト", owner: "山", char: "オ", accent: "#059669", deadline: "2027/01/20", dl: 20270120, soon: false, party: 3, ideas: 1, my: "未投稿", order: 1 },
  { id: "7", title: "来客受付のデジタル化（下書き）", theme: "受付の無人化と来客体験の向上", cat: "業務改善", status: "下書き", group: "プロダクト開発部", owner: "あ", char: "来", accent: "#64748B", deadline: "—", dl: 99999999, soon: false, party: 0, ideas: 0, my: "下書き", order: 7, draft: true },
];

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

function QuestIcon({ q }: { q: Quest }) {
  return (
    <span className="quest-icon sm" style={{ ["--accent" as string]: q.accent } as React.CSSProperties}>
      <span className="quest-icon__char">{q.char}</span>
      <span className="quest-icon__owner placeholder">{q.owner}</span>
    </span>
  );
}

const CAT_OPTIONS: [string, string][] = [["業務改善", "業務改善"], ["新規事業", "新規事業"], ["コスト削減", "コスト削減"], ["顧客体験", "顧客体験"]];
const STATUS_OPTIONS: [string, string][] = [["下書き", "下書き"], ["募集中", "募集中"], ["進行中", "進行中"], ["評価中", "評価中"], ["選定", "選定"], ["完了", "完了"]];
const GROUP_OPTIONS: [string, string][] = [["プロダクト開発部", "プロダクト開発部"], ["全社改善プロジェクト", "全社改善プロジェクト"]];
const MY_OPTIONS: [string, string][] = [["未投稿", "未投稿"], ["投稿済み", "投稿済み"], ["下書き", "下書き"]];

export function QuestListView() {
  const router = useRouter();

  const columns: DataTableColumn<Quest>[] = [
    {
      key: "title", label: "クエスト", locked: true, width: 300, sortable: true, filter: { type: "text" },
      sortVal: (x) => x.title, searchVal: (x) => `${x.title} ${x.theme} ${x.cat}`, csvVal: (x) => x.title,
      render: (x) => (
        <span className="row-center" style={{ gap: "var(--space-2)" }}>
          <QuestIcon q={x} /><span className="idea-title">{x.title}</span>
        </span>
      ),
    },
    { key: "cat", label: "カテゴリー", width: 130, sortable: true, filter: { type: "enum", options: CAT_OPTIONS }, sortVal: (x) => x.cat, filterVal: (x) => x.cat, render: (x) => <span className="badge badge-muted">{x.cat}</span> },
    { key: "status", label: "ステータス", width: 120, sortable: true, filter: { type: "enum", options: STATUS_OPTIONS }, sortVal: (x) => x.status, filterVal: (x) => x.status, render: (x) => <span className={statusBadge(x.status)}>{x.status}</span> },
    { key: "group", label: "グループ", width: 170, hiddenDefault: true, sortable: true, filter: { type: "enum", options: GROUP_OPTIONS }, sortVal: (x) => x.group, filterVal: (x) => x.group, csvVal: (x) => x.group, render: (x) => x.group },
    { key: "deadline", label: "締切", width: 120, sortable: true, sortVal: (x) => x.dl, filter: { type: "text" }, filterVal: (x) => x.deadline, csvVal: (x) => x.deadline, render: (x) => <span className={x.soon ? "deadline soon" : "deadline"}>{x.deadline}</span> },
    { key: "party", label: "👥", width: 80, align: "num", sortable: true, filter: { type: "number" }, sortVal: (x) => x.party, filterVal: (x) => x.party, render: (x) => x.party },
    { key: "ideas", label: "💡", width: 80, align: "num", sortable: true, filter: { type: "number" }, sortVal: (x) => x.ideas, filterVal: (x) => x.ideas, render: (x) => x.ideas },
    { key: "my", label: "あなた", width: 110, sortable: true, filter: { type: "enum", options: MY_OPTIONS }, sortVal: (x) => x.my, filterVal: (x) => x.my, render: (x) => <span className={myBadge(x.my)}>{x.my}</span> },
  ];

  // 既定＝新着順（order 降順）。
  const data = [...QUESTS].sort((a, b) => b.order - a.order);

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

      <DataTable<Quest>
        storageKey="sc10-quests"
        data={data}
        columns={columns}
        rowId={(x) => x.id}
        unit="件"
        perPage={12}
        perPageOptions={[12, 24, 48]}
        maxPins={5}
        defaultView="card"
        searchFields="件名・テーマ・カテゴリー"
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
              <span className="badge badge-muted">{x.cat}</span>
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

      <p className="muted text-xs" style={{ marginTop: "var(--space-6)" }}>
        作成した下書きのクエストは、本人だけに一覧表示されます（下書きバッジ・グレー表示）。
      </p>
    </section>
  );
}
