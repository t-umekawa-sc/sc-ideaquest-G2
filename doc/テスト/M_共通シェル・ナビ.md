# M. 共通シェル・グローバルナビ テストパターン

> 認証後の全画面で共有する app-shell（共通ヘッダー＋グローバルナビ）の振る舞いを追跡する。設計正本＝デザイン標準 §4.1（アプリシェル/共通ヘッダー・グローバルナビ）／画面遷移図 §4（グローバルナビへの集約・2026-09-10）。TC-ID＝`M-TC-xxx`。frontend e2e は `impl/frontend/e2e/**` で走査対象。

## 1. 目的列（テスト規約 §1.2）

| 目的 | 説明 |
|---|---|
| 導線集約 | 分散していた行き先（ホームタイル・GameNav）をグローバルナビ（☰→ドロワー）へ集約し、業務群＋ゲーム群から各画面へ遷移できる |
| ピン留め | 📌でドロワーを常設サイドバー化（本文右シフト）し、端末（localStorage）に記憶して再訪でも維持 |
| アクセシビリティ/抑制 | Esc/背面で閉じる・フォーカストラップ・reduce-motion でスライドを無効化 |

## 2. テストパターン（レビュー#1 グローバルナビ・SC 横断）

### 2-A. グローバルナビ（ドロワー／📌ピン留め・デザイン標準 §4.1・画面遷移図 §4）

> ヘッダー左の `☰`（`.appnav-burger`）で左ドロワー `.appnav`（`#appnav-drawer`・オーバーレイ）を開く。業務群（🏠ホーム/📜クエスト/🔔通知）＋ゲーム群（🛒ショップ/🧍きせかえ/✦魔法・スキル/🏅実績/🏆ランキング）。項目クリックで遷移し閉じる。📌（`.appnav-pin`・広い画面のみ）で常設サイドバー化＝`html.iq-nav-pinned`（本文 `main.container` を右シフト）・localStorage `iq_nav_pinned` に記憶（再訪維持）・再度押すと解除。Esc/背面クリックで閉じる（オーバーレイ時）。reduce-motion で `.appnav`/`.appnav-backdrop` の transition を無効化。ゲーム群の表示条件（ゲームモード＝レビュー#2）は **2-B（M-TC-005〜）** で担保。対象＝`impl/frontend/e2e/sc-99-appnav.spec.ts`。

| ID | 種別 | 目的/対象 | 前提 | 対象セレクタ | 期待 | 根拠 |
|---|---|---|---|---|---|---|
| M-TC-001 | e2e(front) | ☰でドロワーが開き項目が出る／Esc・背面で閉じる | ログイン後どの画面でも | `.appnav-burger`／`.appnav-root.is-open`／`#appnav-drawer` 内の `[role=menuitem]` | ☰で `.appnav-root.is-open`＝1・業務群（ホーム/クエスト/通知）＋ゲーム群（ショップ/魔法・スキル 等）が出る／Esc・背面クリックで `.appnav-root.is-open`＝0 | デザイン標準 §4.1／レビュー#1 |
| M-TC-002 | e2e(front) | 項目クリックで遷移し閉じる | ドロワーを開いた状態 | `#appnav-drawer` の「ショップ」項目／URL | クリックで `/shop` へ遷移し、`.appnav-root.is-open`＝0（閉じる） | デザイン標準 §4.1／レビュー#1 |
| M-TC-003 | e2e(front) | 📌ピンで常設サイドバー化＝本文右シフト＋窓は横スクロールしない＋ピン中は☰非表示＋localStorage で再訪維持＋解除 | 広い画面（≥1024px・既定 viewport） | `.appnav-pin`／`html.iq-nav-pinned`／`.appnav-burger`／`document.documentElement` の scrollWidth／localStorage `iq_nav_pinned` | 📌で `html.iq-nav-pinned` が立つ（本文シフト）・**ウィンドウ全体の横スクロールは出ない**（`scrollWidth ≤ clientWidth`＝ヘッダー右の余白崩れ防止）・**ドック中はヘッダーの☰（`.appnav-burger`）が非表示**（ドック時☰は no-op＝ピン解除は📌）・**リロード後も維持**（localStorage=1）／もう一度 📌 で解除すると☰が再表示（外れ・localStorage=0） | デザイン標準 §4.1／レビュー#1 |
| M-TC-004 | e2e(front) | reduce-motion でドロワー/背面のスライドが無効 | `page.emulateMedia({reducedMotion:"reduce"})` | `.appnav`／`.appnav-backdrop` の computed `transitionDuration` | reduce では両者の `transitionDuration` が **`0s`**（`@media prefers-reduced-motion`）＝スライド/フェード無効・ナビ機能自体は正常 | デザイン標準 §4.9／レビュー#1 |

### 2-B. ゲームモード出し分け（レビュー#2・デザイン標準 §4.11）

> 実効ゲームモード（`GET /me` の `game_mode.effective`＝`accounts.game_mode_override ?? companies.game_mode_default`）が **OFF** のとき、ゲーム層UIを丸ごと非表示にする。対象＝グローバルナビのゲーム群・ヘッダーの Lv/コイン/SP/円環（`.lvring`）・ダッシュボードのヒーロー/週間ランキング・ゲーム系通知・チャット魔法UI。**アバター画像は残す**（本人識別）。通知は backend 生成据え置きで**表示側フィルタ**（§4.11）。**ゲームのロジック（XP/コイン付与）は据え置き＝表示のみ**。実効値の切替は e2e ではログインユーザーの `game_mode_override`（`PATCH /me`）で作り、終了時に `null`（会社設定に従う）へ復元する（seed ユーザー共用）。ゲームモード ON は既定＝既存 M-TC-001/002 でゲーム群が出ることを既に担保。対象＝`impl/frontend/e2e/sc-99-gamemode.spec.ts`（M-TC-005〜008＝ナビ/ヘッダー/ヒーロー/通知を1テスト・M-TC-009＝チャット魔法を1テスト）。

| ID | 種別 | 目的/対象 | 前提 | 対象セレクタ | 期待 | 根拠 |
|---|---|---|---|---|---|---|
| M-TC-005 | e2e(front) | game OFF でナビのゲーム群が消え業務群のみ | 実効ゲームモード OFF（個人 `game_mode_override=false`）でログイン→☰ | `#appnav-drawer` の業務群/ゲーム群項目 | 業務群（ホーム/クエスト/通知）は出るが**ゲーム群（ショップ/きせかえ/魔法・スキル/実績/ランキング）が非表示**（ON に戻すと再表示＝既定は M-TC-001） | デザイン標準 §4.11／#2 |
| M-TC-006 | e2e(front) | game OFF でヘッダーの残高/円環が消える・アバターは残る | 実効 OFF でログイン | ヘッダーの Lv/コイン/SP チップ・`.lvring`／アバター画像 | ゲーム系（Lv/コイン/SP/`.lvring`）は**非表示**、**アバター画像は表示のまま**（本人識別） | デザイン標準 §4.11／#2 |
| M-TC-007 | e2e(front) | game OFF でダッシュボードのヒーロー/週間ランキングが消える | 実効 OFF でログイン→`/` | ダッシュボードのヒーローパネル／週間ランキング | 両者**非表示**（業務パネル＝下書き/フォロー/未投票 等は残る） | デザイン標準 §4.11／#2 |
| M-TC-008 | e2e(front) | game OFF で SC-02 の種別セレクトからゲーム系タブ（実績/魔法）が消える（UI） | 実効 OFF でログイン→`/notifications` | 種別セレクトの選択肢 | 種別セレクトに**「実績」「魔法」が出ない**（業務系は残る）。※一覧の**行・未読数・一括既読・ベル数**のゲーム系除外は backend が担保＝**H-TC-110〜112（api）** で検証（フロントはタブ表示のみ） | デザイン標準 §4.11／#2 |
| M-TC-009 | e2e(front) | game OFF でチャット魔法キャストUIが非表示（使用無効） | 実効 OFF でアイデアチャットを開き、メッセージの＋リアクションでピッカーを開く | リアクションピッカー（`.reaction-picker`）の「魔法」セクション（`.rp__spell`）／通常絵文字（`.rp__emoji`）／チャット本文 | ピッカーに**「魔法」ラベル/魔法ボタン（`.rp__spell`）が出ない**（＝新規キャスト不可）・**通常リアクションとチャット本文は残る**。※既存メッセージの永続 `.spell-fx` 装飾のベストエフォート非表示は follow-up（本 TC 範囲外） | デザイン標準 §4.11／#2 |
