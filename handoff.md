# handoff.md（セッション申し送り・全文上書き運用）

> 読者＝このセッションの記憶が無い次回の自分。会話ログは参照不可。**本ファイルだけで再開できる状態**を目指す。
> 各種正本＝`CLAUDE.md`（規約参照元）／`doc/実装計画.md`（実装順）／`impl/README.md`（実装現況）／`doc/フェーズ毎ルール/`。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: 2026-09-26
- ブランチ: **`feature/chat-thread-independence`**（`origin` push 済・**PR #2 オープン中**＝ https://github.com/t-umekawa-sc/sc-ideaquest-G2/pull/2 ）。`main` 未マージ。
- 最新コミット: `5c299aa feat(eval-history): 変更履歴 Phase 4`。作業ツリー clean。
- DB マイグレーション head＝**`0040_evaluation_revisions`**（全会社DB acme/acme2 適用済）。
- 稼働中: backend/frontend/db/worker/mail-worker/redis/minio/mailhog Up（healthz 200・frontend 307）。**0040＋変更履歴フル機能でビルド済**。

## 2. このセッションでやったこと（PR #2・上から新しい順）
### (A) 変更履歴の標準装備（Phase 0〜4・全エンティティ完了）
> 正本＝**設計ドラフト [doc/設計ドラフト/変更履歴標準.md](doc/設計ドラフト/変更履歴標準.md)**（Phase 0〜4 完了・実装状況を反映済）。目的＝ISO 56001 の反復更新で「当時の判断材料と判断結果」を追う。
- **共通機構**: backend＝`impl/backend/app/tenant/_shared/revisions.py`（`FieldSpec` 駆動の差分エンジン＝`text_diff_segments`/`changed_fields`/`diff_fields`/cursor）。frontend＝`impl/frontend/src/components/ui/RevisionTimeline.tsx`（`variant: "idea"`＝概要パネルのリンクUI／`"info"`＝折り畳みUI）。**新エンティティは FieldSpec と loadDiff を渡すだけ**。
- **2系統**: ①内容の版（per-entity `*_revisions` テーブル・JSONB `changes` スナップ・`UNIQUE(entity_id, revision)`・無変更は版なし）②意思決定ログ（`*_decision_log`・追記型・status/decision 遷移）。
- **Phase 0**（`fb17242`）＝アイデア(`idea_revisions`)/情報(`info_item_revisions`)を共通機構へ寄せた（挙動不変・152 passed）。
- **Phase 1**（`3155a65`・migration **0037**）＝コンセプト `concept_revisions`＋`concept_decision_log`（decision/status）＋**判断材料スナップ**（投票/評価/前提の検証状況を各版/ログに凍結）。UI＝SC-61「🕘 更新履歴」モーダル＋総合判定パネルに判定履歴。P-TC-250〜256。
- **Phase 2**（`d6a3206`・migration **0038**）＝振り返り `quest_outcome_revisions`。UI＝SC-12 結果タブの振り返りに「🕘 更新履歴」折り畳み（結果レスポンスに `outcome_revisions` 埋込）。C-TC-296〜298。
- **Phase 3**（`2d47203`・migration **0039**）＝クエスト定義 `quest_revisions`＋`quest_decision_log`（status 遷移）。定義項目＝title/purpose/color/deadline/categories（参加部署/権限は別意味＝含めない）。UI＝SC-12 ヘッダー「🕘 更新履歴」モーダル（定義版＋ステータス履歴）。C-TC-299〜302。
- **Phase 4**（`5c299aa`・migration **0040**）＝評価 `evaluation_revisions`＋`concept_evaluation_revisions`（アイデア/コンセプト両評価）。**版は「確定(submit)」起点**＝初回確定=初版・確定ごと・下書き/無変更は版なし。UI＝SC-25/SC-62 に「🕘 確定履歴」折り畳み（me 評価に `revisions` 埋込）。F-TC-210〜212・P-TC-456〜458。
- **履歴FKの ondelete（重要）**: 0037/0038 は既定 RESTRICT（コンセプト/振り返りテスト teardown に revision/log 削除を追加）。**0039/0040 は ON DELETE CASCADE**（quests/evaluations は物理削除するテスト teardown が多数＝親削除で履歴も消える。本番は soft delete/非削除で不発火＝監査保持と両立）。

### (B) チャット中核の完全独立化＋コンセプトチャット フル機能パリティ
- `2cd8a28`（migration **0035**）＝チャット中核を **`chat_thread`（owner_type/owner_id ポリモーフィック）** で完全独立化。`chat_messages`/`chat_reads`/`reactions` は `thread_id` ただ一つ。門番は `chat/application._resolve_host`（owner_type 分岐）。**新ホスト追加は thread 1本持つだけ＝中核無改修**。正本＝データモデル §5.14b。メモリ [[chat-thread-independence]]。
- `4e3bdf0`＝コンセプト議論チャットをアイデアと**完全同一**に（共有 `IdeaChatView` を source 抽象 `features/chat/source.ts`＝`ideaSource`/`conceptScopeSource` で駆動）。reaction/魔法/メンション/引用/ピン/添付/未読/リアルタイム同一。

### (C) ブラウザ受入で出た指摘の修正
- `b3f0a0c`（migration **0036**）＝コンセプトのグループ議論ルームが**1個しか作れない**バグ（0033 の `uq_concept_chat_scopes_kind` が group を潰す）→ group を一意対象から除外。P-TC-507。
- `eafa90e`＝**ダイアログ・フッターの「キャンセル/閉じる」を左端に統一**（デザイン標準 §4.1・`.dialog-close-left`）。多数の入力フォーム＋ConfirmDialog を統一。
- `99837fc`＝SC-61 に**投票/評価/総合判定の住み分けⓘ**、SC-62 コンセプト評価ダイアログに**クエスト＋コンセプト文脈**（アイデア評価 SC-25 と同型）。

## 3. 現在の状態
- **テスト**: backend pytest **全ドメイン 812 passed**（フル実行）。**TC-ID traceability ✅（836件）**。frontend `npm run build` 通過（codegen 反映）。
- **壊れているもの**: 認識範囲では無し。

## 4. 詰まっている点 / 未実施
- **ブラウザ受入（実データ）が未完**＝PR #2 マージ前の残作業。テスト垢 `user@acme.example`（ACME-01/`Passw0rd!`）は**コンセプト実データを持たない**（`seed_demo.py` はアイデア＋チャットのみ）。→ **実データ環境 or ユーザー自身のブラウザ**で:
  1. チャット（アイデア回帰＋コンセプト フル機能パリティ）。
  2. 変更履歴（各詳細の「🕘 更新履歴」＝アイデア/コンセプト/クエスト/振り返り/評価/情報）。
  3. ダイアログのキャンセル左寄せ・SC-61 ⓘ・SC-62 文脈。
- **DB 汚染に注意**: フル pytest を acme に繰り返すとテスト残骸が seed 垢のダッシュボードに混じり `test_i_tc_161_recent_chats` を落とすことがある（掃除で復旧・コード起因ではない）。**pytest 実行中に frontend/backend の再ビルドを走らせない**（コンテナ再起動が交絡）。

## 5. 決定事項と根拠
- **チャットは完全独立（案X＝chat_thread）**（ユーザー明示＝二度と分離しない）。owner_id はホストのリンク表 PK。詳細＝[[chat-thread-independence]]。
- **変更履歴は 2系統×per-entityテーブル＋共通ロジック/UI**（テーブルは各エンティティ固有＝chat_thread の一般化とは逆・履歴は他ホストから再利用しない付属物）。UI＝概要パネルあり→リンク／なし→折り畳み（ユーザー決定）。
- **評価の版は確定(submit)起点**（ユーザー確定＝初回確定=初版・確定ごと・下書き/無変更は版なし・ア/コ両評価）。
- **ダイアログのキャンセルは左端**（設計標準 §4.1・決定 2026-09-18 に合わせて統一）。

## 6. 次にやること（優先順）
1. **PR #2 のブラウザ受入**（§4・実データ）→ 問題なければ `main` へマージ。PR #2 は 12 コミット（チャット独立化→パリティ→受入修正→変更履歴 Phase 0〜4）。
2. **軽微フォローアップ（任意）**:
   - コンセプト/振り返り/クエスト/評価の**更新通知**（変更履歴標準 §3.5・現状アイデア版のみ `idea_updated` 通知・他は未）。
   - コンセプトチャットのスライスA簡素EP（`concepts/router` の `/messages`）は frontend 未使用＝整理可（P-TC-503/504/505 が使用中）。
   - API設計 E の `/concept-chat-scopes/*` 経路追記（データモデル/P は反映済）。
3. **変更履歴を将来もう1エンティティに足す時**: `<entity>_revisions`（＋必要なら `_decision_log`）を作り、`app/tenant/_shared/revisions.py` の `FieldSpec` と `RevisionTimeline`（variant）を渡すだけ。履歴FKは物理削除するテストがあるなら CASCADE。

## 7. 再開に必要な環境情報
- **起動**: `cd impl && docker compose up -d`。frontend/backend は**ソースをベイク（volumes 無）**＝反映は `docker compose up -d --build frontend`（or backend）。**migration/seed 追加後は `--build backend`**（entrypoint bootstrap が DB作成/migrate(head)/seed を毎起動・冪等）。**workers は profiles**＝`docker compose up -d worker mail-worker`。
- **backend テスト**: `cd impl && docker compose run --rm -v "$(pwd)/backend:/app" backend python -m pytest tests/<domain> -q`（`-v` で未コミット反映・**cwd は必ず impl**＝`$(pwd)/backend` のマウントが効く。impl/backend で打つと二重 backend で空マウントになり bootstrap が `scripts` 見つからず失敗する）。**pytest 前に `docker compose stop worker mail-worker`**→終わったら start。
- **migration の再適用（ondelete 変更など未コミット migration の作り直し）**: `cd impl && docker compose run --rm --entrypoint python -e PYTHONPATH=/app -v "$(pwd)/backend:/app" -T backend -c "..."` で `alembic command.downgrade/upgrade`（`python -c` は cwd を sys.path に入れないため PYTHONPATH=/app 必須・entrypoint bootstrap を避けるため --entrypoint python）。
- **frontend 検証**: `cd impl/frontend && npm run build`（必須ゲート）。**backend の API 型を変えたら `cd impl/frontend && npm run codegen`**。
- **DB 直接確認**: `docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d ideaquest_company_acme -tAc "SELECT version_num FROM alembic_version"'`（head=`0040_evaluation_revisions`）。
- **TC トレーサビリティ**: リポジトリ root で `python3 scripts/check_tc_traceability.py`（✅ 確認）。
- **ログイン（テスト垢）**: 会社コード `ACME-01`／`user@acme.example`（他 user2/user3/kanri@acme.example）／`Passw0rd!`。**コンセプト/アイデア実データは無い**。
- **PR 操作**: `gh` CLI は**未インストール**。PR は GitHub API（`~/.git-credentials` のトークンで curl/python）で作成した。

---
（自己チェック済み: 本ファイルだけで「PR #2 の受入→マージ」または「更新通知の追加／別エンティティへの変更履歴追加」から再開可能。未確認＝ブラウザ受入は明記した。）
