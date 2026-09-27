# handoff（引き継ぎメモ）

> 読者＝このセッションの記憶が無い次回の自分。会話ログは参照不可。本ファイルだけで再開できるように書く。全文上書き運用（履歴は git）。
> 各種正本＝`CLAUDE.md`（規約参照元）／`doc/実装計画.md`（実装順）／`impl/README.md`（実装現況）。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: 2026-09-27 21:36 JST
- ブランチ: `main`（作業ツリー clean・push 済み）
- 最新コミット: `99c9e256 fix(info): 「この情報からクエストを作成」の下書きラベル・§4.7エラー表示・作成後遷移を是正`
- このセッションの主なコミット（新しい順）: `99c9e256`／`7c2183d9`（開発メンバー実ディレクトリ結線＋参加グループ永続）／`5e127561`（プロジェクト全ダイアログを URL付きモーダル化）／`b24667bd`／`8ea2220f`（前提・コンセプトの採否）／`f511e6d7`（一覧アクションメニュー統一）／`7f267399`（最近の議論）／`d70720db`（プロジェクト編集/複製/削除）／`47f55d97`（情報参照モード）／`9adaa335`（情報リンク対象にコンセプト/前提）

## 2. ゴール
社内イノベーション支援アプリ（ideaquest）。ISO 56001 の①機会→②③コンセプト→④⑤ソリューション開発（プロジェクト/タスク管理）までを、ゲーム感のある UI で一気通貫に回す。現在の主戦場は **FR-43 ソリューション開発（プロジェクト＝Qドメイン）** と、その周辺（情報インプット→クエスト/コンセプト/前提の連携）。

## 3. 今回やったこと（変更ファイルと理由）
すべて `impl/` 配下。ユーザー指摘への対応が中心。

### プロジェクト（Qドメイン）ダイアログを URL 付きモーダルへ全面統一（`5e127561`）
- 理由: ローカル state モーダルで URL が変わらず、クエストの標準（Parallel＋Intercept・§112）と不統一という指摘。
- フォームを content 化（Modal シェルは RouteModal/Panel が付与）: `impl/frontend/src/features/projects/components/` の `ProjectForm.tsx`・`TaskForm.tsx`・`ProjectMembersForm.tsx`（新規）・`ProjectDeploymentForm.tsx`（新規）。
- ラッパ新規（同 `components/`）: `ProjectFormModal/ProjectFormPanel`・`ProjectMembersModal/ProjectMembersPanel`・`ProjectDeploymentModal/ProjectDeploymentPanel`・`TaskFormModal/TaskFormPanel`。barrel＝`features/projects/index.ts`。
- ルート新規（intercept＋フルページの1対）: `impl/frontend/src/app/(app)/@modal/(.)projects/…` と `impl/frontend/src/app/(app)/projects/…` に `new`／`[projectId]/edit`／`[projectId]/members`／`[projectId]/deployment`／`[projectId]/tasks/new`（`?parent`/`?dup`）／`[projectId]/tasks/[taskId]/edit`。
- トリガをリンク/遷移へ: `ProjectListView.tsx`（＋作成→`/projects/new`、行メニュー編集→`/projects/{id}/edit`）・`ProjectDetailView.tsx`（各ボタン `router.push`）・`ConceptDetailView.tsx`（開発を始める→`/projects/new?concept=…`）。跨ルート更新は `PROJECTS_CHANGED_EVENT`（`features/projects/api.ts` で定義、一覧/詳細が listen）。
- 副次修正: `TaskForm` の保存が `setTimeout` のモックだったのを実 API（`createTask`/`patchTask`）に。

### 開発メンバー候補を実会社ディレクトリに結線＋参加グループ永続（`7c2183d9`）
- 理由: 候補がデモ配列（仮ID `u-dev1` 等）で実ユーザー追加が 422／参加グループが未永続、という残課題。
- frontend: `ProjectPartyPicker.tsx` を実 API（`@/features/quests/api` の `listCompanyGroupDirectory`／`listQuestGroupCandidates` を再利用）に置換。`ProjectForm.tsx`・`ProjectMembersForm.tsx` が会社グループ directory を取得（参加グループ選択肢＋候補スコープ）、作成者 user_id で候補除外。
- backend: migration `impl/backend/migrations/company/versions/0043_project_groups.py`（`project_group_links`）＋`solutions/orm.py` に `ProjectGroupLink`＋`solutions/repository.py` に group link CRUD＋`solutions/application.py` の `can_access_project` を「参加グループ現所属者も可」に拡張＋create/patch が `group_ids` を受理し `_detail` が返す。`solutions/schemas.py`・`solutions/router.py` も `group_ids` を透過。

### 前提・コンセプトの情報詳細に「この情報の扱い」（採否）（`8ea2220f`）
- 理由: 前提から情報詳細を開いても採否セクションが出ない指摘。加えてコンセプトは `can_dispose=true` を返すのに設定EPが無い潜在バグ。
- backend: `concepts/application.py` に `set_concept_link_disposition`／`set_assumption_link_disposition`、`concepts/router.py` に `PATCH /concepts/{id}/related-info/{link_id}`・`PATCH /assumptions/{id}/related-info/{link_id}`。read の `can_dispose` を作成者/quest管理者で返す。
- frontend: `info-input/components/InfoDetailView.tsx` の採否セクションを assumptions/concepts でも表示（`disposeContext=refContext`）。

### 「この情報からクエストを作成」ダイアログの是正（`99c9e256`）
- 理由: 実態は下書き起票なのにボタンが「クエストを作成」／エラー表示が §4.7 非準拠／作成後に情報一覧へ戻ってしまう。
- `info-input/components/QuestFromInfoPanel.tsx`: ボタン「下書きを作成」／§4.7（FormSummary＋Field error＋useFormErrorNotice＋FormFooterError）／`onDone(to)` で作成した下書きへ単一遷移。
- `info-input/components/QuestFromInfoModal.tsx`: `close(to)`／`onClosed` で単一遷移（intercept・standalone 両対応）。二重遷移（`router.back` と `setTimeout(router.push)` の競合）を解消。

### その他（前半コミット）
- 一覧のアクションメニュー拡充＋並び順統一（`f511e6d7`）: 統一順＝詳細を開く→💬チャット→クイック/状態→編集→複製→削除。クエスト/アイデア/コンセプト/前提/プロジェクト各一覧。編集ボタンUIを右上 `btn-outline` に統一。
- プロジェクト詳細「🕒 最近の議論」（`7f267399`）: `GET /projects/{id}/recent-chats`（`chat_repo.task_threads_with_activity`）。概要パネル右に配置。
- プロジェクト編集/複製/削除＋ソフト削除（`d70720db`／migration `0042_project_soft_delete.py`）。
- 情報リンク対象にコンセプト/検証プール（前提）追加（`9adaa335`）。

## 4. 現在の状態
- 動いている（今セッションで Playwright スクショ実機確認済み）:
  - プロジェクト作成/編集/メンバー/導入/タスクの各ダイアログが URL を変える（intercept＝モーダル、直アクセス＝フルページ）。作成→`/projects/{id}` へ単一遷移。
  - 開発メンバー候補に実 seed ユーザーが並ぶ（デモ配列は撤去）。参加グループ選択肢は会社グループ directory。
  - 「この情報からクエストを作成」: ボタン「下書きを作成」／§4.7 エラー表示／作成後 `/quests/{新下書きid}` へ遷移。
- テスト通過状況（今セッションで実行したもののみ・確認済み）:
  - `pytest tests/solutions` = 18 passed（api 15＝Q-TC-113 含む／chat 3）。
  - `pytest tests/concepts tests/info` = 145 passed（採否 P-TC-261/262 含む）。
  - `npm run build`（frontend 本番ビルド）= 成功（複数回）。
  - `python3 scripts/check_tc_traceability.py` = 前半で ✅。以後に追加した TC も md 記載済みだが、最新の再実行は未確認。
- 壊れているもの: 確認した範囲では無し。
- 未確認: **backend フル pytest** と **Playwright e2e スイート** は今セッション未実行。設計doc（データモデル/API設計 Q/SC-70/71/72/impl/README）への今回変更の反映は未実施＝未確認。

## 5. 詰まっている点（試して失敗した/注意）
- 「この情報からクエストを作成」の作成後遷移: 旧実装は `onDone()`（＝`router.back`）＋`setTimeout(router.push('/quests/{id}'))` の二重遷移で、閉じアニメの `router.back` が後発火し情報一覧へ戻る競合が起きていた。→ `RouteModal.close(to)`／standalone は `nextHref` を `onClosed` で消費する単一遷移に統一して解消。**ただしユーザー報告 Step B（「下書きをクエスト一覧から開くと from-info ダイアログが出る」）は今回未再現・未確認**。root cause（履歴汚染）は消えた想定だが、実機で下書きを開く動線の確認が必要。
- Playwright スクショで要素クリックが modal backdrop に奪われ Timeout する事例が複数。検証スクリプトは try/catch で部分結果を JSON 出力する形にすると安定（`impl/frontend/tmp_shots/*.mjs`。tmp_shots は git 追跡外）。
- 検証で作った下書きクエスト/プロジェクトは `deleted_at`（quests/projects）で soft-delete して片付けた。projects の `deleted_at` は 0042 で追加。**info_items は `deleted_at` 列が無い（`archived_at`）** ので DB 手当て時に注意。

## 6. 決定事項と根拠
- 新規ダイアログは **URL 付きモーダル（RouteModal＋Intercept＋フルページfallback）が標準**。ローカル state モーダル禁止（URLが変わらず共有/リロード/戻るが壊れる）。参照実装＝クエスト（`QuestForm`＋`QuestCreateModal`/`QuestCreatePanel`＋`@modal/(.)quests/…`）。
- 参加グループ（アクセス条件）は **quest_groups を流用**（専用グループを作らず会社の部署グループを指す＝ディレクトリ一元化）。
- プロジェクト複製は **コンセプト非依存で複製**（1コンセプト1プロジェクトのユニーク制約回避）。由来コンセプトは引き継がない。
- ソフト削除採用（`projects.deleted_at`）。コンセプト1:1の部分ユニークは「未削除のみ」に限定（削除後に同コンセプトから再起票可）。
- 前提（assumptions）にも採否（disposition）を導入＝ユーザー要望（当初「前提は採否無し」で実装したが覆した）。
- 「この情報からクエストを作成」は**下書き起票のまま**（軽量起票→SC-11 で仕上げ）。ボタン文言だけ実態に合わせた。

## 7. 次にやること（優先順・具体的に）
1. **QuestFromInfo Step B の実機確認**（未再現）: クエスト一覧で from-info 作成の下書きを開く→編集/公開の動線を確認。関係ファイル＝`impl/frontend/src/features/quests/components/QuestListView.tsx` の `questHref`（draft→`/quests/{id}/edit`）、`QuestForm` 編集モード。異常が出たら再現手順を控えて修正。
2. **設計doc同期**（今回未実施）: `doc/データモデル.md`（`project_group_links`／`projects.deleted_at`）・`doc/API設計/Q_ソリューション開発.md`（DELETE/recent-chats/参加グループ・採否EP）・`doc/画面設計/screens/SC-70/71/72`（URL付きモーダル化・アクションメニュー・最近の議論）・`impl/README.md`（現況）へ反映。
3. **回帰**: 着手前に backend フル pytest（`pytest -q`・ワーカ停止）と Playwright e2e を通す。今セッション未実行。
4. **プロジェクト複製で参加グループも引き継ぐ**: `ProjectListView.tsx` の `duplicate()` は現在 members のみコピー。`getProject` の `group_ids` も `createProject` に渡す。
5. **候補ページング**: `ProjectPartyPicker.tsx` は候補先頭 `PAGE=50` 件のみ（cursor 未実装）。`listQuestGroupCandidates` の `page_info.cursor` で「もっと見る」を追加。
6. **他ドメインのモック監査（未網羅）**: 前半の Explore 監査は projects 中心。ダッシュボード等に残る `試作`/`接続時に` コメントを grep で洗い出し実装 or 明示。
7. **長期未着手**: `spec_decisions`（仕様投票・FR-43 Phase2）。器（テーブル/ORM）はあるが UI/API 未実装。

## 8. 再開に必要な環境情報
- 作業ディレクトリ: リポジトリ直下。実装は `impl/`（`impl/backend`＝FastAPI＋SQLAlchemy＋Alembic、`impl/frontend`＝Next.js）。
- フル起動（workers 込み）: `cd impl && docker compose up -d --build`
- フロント変更の反映: `cd impl && docker compose up -d --build frontend`（フロントはビルドをベイク＝コンテナ再ビルドしないと反映されない）
- バックエンド変更＋マイグレーション: `cd impl && docker compose up -d --build backend && docker compose exec -T backend python -m scripts.bootstrap`（全テナントDBへ alembic upgrade head。company 側 head＝`0043_project_groups`）
- pytest（規約: ワーカ停止・cwd=impl）: `cd impl && docker compose stop worker mail-worker && docker compose exec -T backend pytest tests/solutions -q`（対象を絞る）。フルは `pytest -q`。
- フロント検証ゲート（必須）: `cd impl/frontend && npm run build`（tsc/lint を兼ねる。内部遷移は `<Link>`）。OpenAPI 型再生成＝`npm run codegen`（backend が :8000 で起動している必要）。
- TC トレーサビリティ: リポジトリ直下で `python3 scripts/check_tc_traceability.py`
- ポート: frontend `http://localhost:3000`／backend `http://localhost:8000`（`openapi.json` は codegen が参照）。
- ログイン（seed・ACME）: 会社コード `ACME-01`／ID `user@acme.example`／PW `Passw0rd!`。管理者 seed＝`kanri@acme`（company_account_admin）・`admin@ops`（system_admin）いずれも `Passw0rd!`。
- DB 直接確認: `docker compose exec -T db psql -U ideaquest -d ideaquest_company_acme -c "…"`（会社DB＝`ideaquest_company_acme`／control＝`ideaquest_control`）。
