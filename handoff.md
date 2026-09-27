# handoff.md（セッション申し送り・全文上書き運用）

> 読者＝このセッションの記憶が無い次回の自分。会話ログは参照不可。**本ファイルだけで再開できる状態**を目指す。
> 各種正本＝`CLAUDE.md`（規約参照元）／`doc/実装計画.md`（実装順）／`impl/README.md`（実装現況）／`doc/フェーズ毎ルール/`。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: 2026-09-27
- ブランチ: **`main`**（`origin/main` と同期＝0/0）。今セッションで **feature/chat-thread-independence を main へマージ＋push 済み**（`689ff0e2..6bcfff9f`）。PR #2 は既に GitHub 上でマージ済みだった（origin/main に feature 未取り込みの差分は無かった＝クリーンマージ）。
- 最新コミット: `6bcfff9f Merge feature/chat-thread-independence into main`（直前＝`3f8866de fix(forms/concept): 実績検証ダイアログ等を§4.7へ是正・検証履歴に複製/赤削除・全文検索対象ⓘ`）。作業ツリー **clean**。
- feature/chat-thread-independence は残置（`3f8866de`・main に取り込み済）。不要なら削除可。
- DB マイグレーション head＝**`0040_evaluation_revisions`**（acme 適用済・確認済）。今セッションで migration 追加は**無し**。
- 稼働（確認済）: backend/frontend/db/worker/mail-worker/redis/minio/mailhog すべて running。**healthz=200・frontend=307**。frontend は今セッション変更を反映するため **`up -d --build frontend` 済み**。

## 2. このプロジェクトのゴール
社内アイデア創出をゲーム感覚で回す多テナント SaaS（ISO 56001 準拠）。クエスト→アイデア→**コンセプト（②③段＝創造・検証）**→結果 の流れで、投票/評価/議論/前提検証を通じて勝ち残りコンセプトを選定する。次段＝**ソリューション開発（④⑤＝プロジェクト/タスク管理）**は設計ドラフトのみ（未着手）。

## 3. 今回やったこと（受入指摘対応＝2026-09-27・全て frontend＋規約/テスト doc・backend 無変更）
> 正＝`doc/画面設計/デザイン標準.md` §4.7／`doc/規約/フロントエンド実装フロー規約.md` §2.1b／`doc/画面設計/screens/SC-61_コンセプト詳細.md` §4.4。コミット＝`3f8866de`。

- **実績（検証）入力ダイアログを §4.7 標準へ是正**（`impl/frontend/src/features/concepts/components/ConceptDetailView.tsx`）: スナックバー1本＋「手法・実施日・規模は必須」まとめ表示 → `Field error`／`FormSummary`／`useFormErrorNotice`／`FormFooterError` の**フィールド単位**表示に。検証ロジックを純関数 `impl/frontend/src/features/concepts/validation.ts`（`validateValidationInput`）へ切り出し。**回帰＝`validation.test.ts`（P-TC-259・vitest）**。理由＝入力済み項目も未入力に見え、どこが足りないか分からなかった（受入指摘）。
- **全ダイアログの §4.7 監査＋是正**（Explore＋自分で裏取り）: **InfoFormPanel**（`impl/frontend/src/features/info-input/components/InfoFormPanel.tsx`）＝3チャネル欠落→§4.7化（FormSummary＋notify＋FormFooterError・一般エラーは formError へ分離）。**AccountFormPanel／CompanyCreateForm**＝独自 `.form-error` div→標準 `FormSummary` へ正規化。準拠済（IdeaForm/ConceptForm/QuestForm/評価系）・対象外（確認/表示専用/ピッカー）は問題無し。
- **検証履歴の行アクション拡張**（`impl/frontend/src/features/concepts/components/AssumptionCard.tsx`＋`ConceptDetailView.tsx`）: `編集｜複製｜削除` に**複製**を追加（`openDuplicateValidation`＝実績入力を「追加モード」で値プリフィル起動＝別レコード新規作成・デザイン標準 §4.5 複製標準）。**削除は `btn-outline btn-danger`（赤）**（UI標準）。
- **クエスト全文検索の「対象」に ⓘ**（`impl/frontend/src/features/quests/components/QuestDetailView.tsx`）: `ScreenPurpose`（§4.13・ⓘのみ）で対象別の検索列を明示＝アイデア＝タイトル/本文/価値/補足、チャット＝メッセージ本文、添付＝ファイル名、すべて＝3種横断（**backend `search/repository.py` の PGroonga 対象列と一致**）。
- **再発防止の規約補強**: `doc/規約/フロントエンド実装フロー規約.md` §2.1b 新設（入力フォームは §4.7 4部品必須・snackbar1本/生input禁止・レビュー観点）／`doc/画面設計/デザイン標準.md` §4.7 に「適用チェックリスト（新規/変更フォーム）」追記。

## 4. 現在の状態（検証結果）
- **frontend**: `npm run build` ✅（型/lint 通過）。**vitest ✅ 208 passed**（32 files・P-TC-259 含む）。
- **backend**: 本セッション無変更。セッション冒頭でフル pytest **816 passed** を確認済み（quests+concipts の再現も 205 passed）。
- **TC-ID traceability**: ✅ **841 件**すべて md 記載（今回追加＝P-TC-259）。
- **壊れているもの**: 認識範囲では無し。
- **ブラウザ受入（実データ）**: §4.7表示・複製/赤削除・全文検索ⓘ の**最終目視はユーザーが逐次確認中**（自動ゲートは緑・実データは seed に無いためユーザーのブラウザで確認）。

## 5. 詰まっている点 / 注意
- **§4.7 の適用漏れ再発防止は規約側で担保済み**（§2.1b＋§4.7チェックリスト＋メモリ）。今後フォームを足す時は 4部品を必ず使う。
- **frontend はソースをベイク（volumes 無）**＝変更反映に `docker compose up -d --build frontend`（or backend）が要る。
- **backend の API 型を変えたら `npm run codegen`**（`http://localhost:8000/openapi.json`）。

## 6. 決定事項と根拠
- **入力フォームの検証表示は §4.7 の4部品が唯一の正**（Field error＋FormSummary＋useFormErrorNotice＋FormFooterError）。スナックバー1本のみ／まとめ「必須」1メッセージ／生 `<input>`＋手書き検証は**不可**（受入指摘で明文化）。
- **実績（検証）の複製**＝登録（追加）ダイアログを「追加モード」で値プリフィル起動（既存を下敷きに新規・複製専用ダイアログは作らない・§4.5）。
- **削除ボタンは赤（`btn-danger`）が UI 標準**。
- **マージは main へ直接 push**（`gh` 未インストール・PR は GitHub API 経由。今回は既マージ済み PR #2 の後追い差分をクリーンマージ）。

## 7. 次にやること（優先順）
1. **ブラウザ実データ受入の残**（ユーザー）＝§4.7表示（実績/情報/アカウント/会社フォームで欠落項目だけ赤くなるか・スクロール時のフッターヒント/トースト）・検証履歴の複製/赤削除・全文検索ⓘ の目視。問題あれば都度修正（不具合認定は再現テスト同梱＝メモリ [[defect-regression-test-policy]]）。
2. **ソリューション開発機能（ISO ④⑤＝プロジェクト/タスク管理）の実装着手**＝設計ドラフト `doc/設計ドラフト/ソリューション開発機能_設計.md`（162行・**未精読**）を着手前に精読。タスク単位チャットは chat_thread 再利用・開発XP分離（メモリ [[fr43-solution-development]]）。
3. **反証波及の通知（P.7）**＝`concepts/application.add_validation` の `verdict=refuted` で `mark_links_stale_for_assumption` は動くが、**作成者＋評価者への通知（H）は未結線**（follow-up コメント有り）。
4. 軽微：コンセプト/クエスト/振り返り/評価の**更新通知**（変更履歴標準 §3.5・現状アイデア版のみ）。
5. 掃除：不要なら `feature/chat-thread-independence` を削除（main に取り込み済）。

## 8. 再開に必要な環境情報
- **起動**: `cd impl && docker compose up -d`。frontend/backend は**ソースをベイク（volumes 無）**＝反映は `docker compose up -d --build frontend`（or backend）。**workers は常時起動運用**（`docker compose up -d worker mail-worker`／`docker compose ps` で確認）。
- **frontend 検証**: `cd impl/frontend && npm run build`（必須ゲート・Next lint 含む）＋ `npx vitest run`。API 型変更時 `npm run codegen`。
- **backend テスト**: `cd impl && docker compose stop worker mail-worker` → `docker compose run --rm -v "$(pwd)/backend:/app" -T backend python -m pytest -q`（**`-v` で未コミット反映・cwd は必ず impl**）→ 終わったら `docker compose start worker mail-worker`。
- **TC トレーサビリティ**: リポジトリ root で `python3 scripts/check_tc_traceability.py`（✅・md 未記載検出）。TC 追加は先に `doc/テスト/<ドメイン>_*.md` に行を書く。フロント `*.test.ts(x)` も対象。
- **DB head 確認**: `cd impl && docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d ideaquest_company_acme -tAc "SELECT version_num FROM alembic_version"'`（=`0040_evaluation_revisions`）。
- **ログイン（テスト垢）**: 会社コード `ACME-01`／`user@acme.example`（owner/作成者）／`Passw0rd!`。管理者 seed＝`kanri@acme.example`（company_account_admin）・`admin@ops`（system_admin）。**seed にコンセプト実データは無い**（`seed_demo.py` はアイデア＋チャットのみ）＝コンセプト受入は自分で作成 or ユーザーのブラウザ。
- **ポート**: frontend 3000／backend 8000／mailhog 8025／minio 9000-9001。
- **Playwright（UI 目視デバッグ）**: `cd impl/frontend && npx playwright test e2e/<spec> --project=chromium`（setup が storageState を作る）。一時スクショ spec は撮ったら削除。
- **PR 操作**: `gh` は**未インストール**。GitHub API（`~/.git-credentials` のトークンで curl/python）で操作する。main は今回同期済み。

---
（自己チェック済み: 本ファイルだけで「ブラウザ実データ受入の残」または「ソリューション開発機能の実装着手」から再開可能。未確認事項＝ブラウザ実データ受入の全網羅・ソリューション開発ドラフトの中身、は明記した。main は origin と同期済み。）
