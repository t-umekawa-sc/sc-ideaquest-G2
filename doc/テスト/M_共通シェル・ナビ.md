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

> ヘッダー左の `☰`（`.appnav-burger`）で左ドロワー `.appnav`（`#appnav-drawer`・オーバーレイ）を開く。業務群（🏠ホーム/📜クエスト/🔔通知）＋ゲーム群（🛒ショップ/🧍きせかえ/✦魔法・スキル/🏅実績/🏆ランキング）。項目クリックで遷移し閉じる。📌（`.appnav-pin`・広い画面のみ）で常設サイドバー化＝`html.iq-nav-pinned`（本文 `main.container` を右シフト）・localStorage `iq_nav_pinned` に記憶（再訪維持）・再度押すと解除。Esc/背面クリックで閉じる（オーバーレイ時）。reduce-motion で `.appnav`/`.appnav-backdrop` の transition を無効化。ゲーム群の表示条件（ゲームモード＝レビュー#2）は #2 実装時に別 TC。対象＝`impl/frontend/e2e/sc-99-appnav.spec.ts`。

| ID | 種別 | 目的/対象 | 前提 | 対象セレクタ | 期待 | 根拠 |
|---|---|---|---|---|---|---|
| M-TC-001 | e2e(front) | ☰でドロワーが開き項目が出る／Esc・背面で閉じる | ログイン後どの画面でも | `.appnav-burger`／`.appnav-root.is-open`／`#appnav-drawer` 内の `[role=menuitem]` | ☰で `.appnav-root.is-open`＝1・業務群（ホーム/クエスト/通知）＋ゲーム群（ショップ/魔法・スキル 等）が出る／Esc・背面クリックで `.appnav-root.is-open`＝0 | デザイン標準 §4.1／レビュー#1 |
| M-TC-002 | e2e(front) | 項目クリックで遷移し閉じる | ドロワーを開いた状態 | `#appnav-drawer` の「ショップ」項目／URL | クリックで `/shop` へ遷移し、`.appnav-root.is-open`＝0（閉じる） | デザイン標準 §4.1／レビュー#1 |
| M-TC-003 | e2e(front) | 📌ピンで常設サイドバー化＝本文右シフト＋窓は横スクロールしない＋localStorage で再訪維持＋解除 | 広い画面（≥1024px・既定 viewport） | `.appnav-pin`／`html.iq-nav-pinned`／`document.documentElement` の scrollWidth／localStorage `iq_nav_pinned` | 📌で `html.iq-nav-pinned` が立つ（本文シフト）・**ウィンドウ全体の横スクロールは出ない**（`scrollWidth ≤ clientWidth`＝ヘッダー右の余白崩れ防止）・**リロード後も維持**（localStorage=1）／もう一度 📌 で解除（外れ・localStorage=0） | デザイン標準 §4.1／レビュー#1 |
| M-TC-004 | e2e(front) | reduce-motion でドロワー/背面のスライドが無効 | `page.emulateMedia({reducedMotion:"reduce"})` | `.appnav`／`.appnav-backdrop` の computed `transitionDuration` | reduce では両者の `transitionDuration` が **`0s`**（`@media prefers-reduced-motion`）＝スライド/フェード無効・ナビ機能自体は正常 | デザイン標準 §4.9／レビュー#1 |
