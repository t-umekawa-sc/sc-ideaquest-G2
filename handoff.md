# handoff.md（セッション引き継ぎ・全文上書き運用）

> 読者＝このセッションの記憶が無い次回の自分。会話ログは参照不可。**本ファイルだけで再開できる**ことを目標に書く。
> 履歴は git に任せる。事実のみ・未確認は「未確認」と明記・コードは貼らずファイル/関数で示す。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: **2026-09-20 21:57 JST**
- ブランチ: **main**（この handoff 更新をコミット＆push した直後の想定＝作業ツリー clean）
- 機能の最新コミット: **`2cc7137`** `refactor(info front): 編集導線を詳細インライン編集に一本化＋fixtures 全撤去`。この上に本 handoff 更新コミットが tip として載る（`git log --oneline -3` で確認）。
- 本セッションのコミット列（古→新）: `022ab1b`(画像再ホスト) → `6cd4ae5`(参考資料) → `179d6d9`(アーカイブ) → `cf20de0`(続報登録UI) → `80f87b7`(この情報からクエスト作成) → `837a993`(raw物理削除) → `c8e139e`(curator付与EP+管理UI) → `f2c947b`(反証通知) → `2cc7137`(編集導線一本化)
- コミット方針: ユーザーが「コミットして/プッシュして」と言うまでコミットしない。1スライス=1コミット。コミット末尾に `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。

## 2. プロジェクトのゴール
社内アイデア創出のゲーミフィケーション Web アプリ **IdeaQuest**（マルチテナント＝会社ごとに会社DB）。バック=FastAPI 4層（schemas/repository/application/router）、フロント=Next.js App Router（feature 構成）。設計の正本は `doc/` 配下（要件 FR-xx・データモデル・API設計 A..N・画面 SC-xx）。実装は `impl/`。**直近フォーカス＝FR-41 情報インプット（外部WEB情報を手動貼付→属性→アイデア/クエストへ動的リンク＋反証で揺さぶる）＝差別化の核**。

## 3. 今回やったこと（変更ファイルと理由）
FR-41 情報インプットの **Phase C 残り＋Phase D 全部＋後片付け**を実装。ドメイン=`app/tenant/info/`。

- **貼付画像の MinIO 再ホスト**（§12-4）: `info/application.py::rehost_image`、`info/router.py POST /info-items/images`。理由=外部 img src を持ち込まない（自社ホスト署名URL に置換）。frontend=`features/info-input/api.ts::uploadInfoImageApi`＋`components/InfoFormPanel.tsx`（🖼️ボタン＋onPaste ハンドラ）。
- **参考資料 添付**（§5.33・migration `0030_info_attachments`）: ORM `info/orm.py::InfoAttachment`、repo `list/count/get/add/remove_attachment`＋`delete_info_item`（cascade）、app `add_attachments`/`remove_attachment`、router `POST/DELETE /info-items/{id}/attachments`。作成者のみ・拡張子/サイズ/マジックバイト検証（`app/infra/storage.py::validate_attachment_upload`）。詳細 DTO に `attachments[]`。frontend=`api.ts::addAttachmentsApi/deleteAttachmentApi`＋`InfoDetailView.tsx`（参考資料セクション）＋`InfoFormPanel.tsx`（登録後に添付 POST）。
- **アーカイブ/解除**: app `archive_info_item`/`unarchive_info_item`（curator のみ）、repo `status_counts` に `archived` 追加、schema `InfoStatusFacets.archived`、router `POST /info-items/{id}/archive`・`/unarchive`。frontend=一覧に「アーカイブ」状態タブ＋行⋯メニュー＋詳細の curator ブロック（フッターは「閉じる/保存」に維持＝SC-50 §8）。
- **続報登録UI**: `InfoFormPanel.tsx` の親プレビューを fixtures→実 API（`fetchInfoDetail`）へ。`InfoDetailView.tsx` 🧵続報スレッドに「＋続報を登録」（スレッド根に紐づけ）。backend `POST /info-items {parent_info_id}` は既存（親の未棄却リンクを origin=auto で複製）。
- **この情報からクエスト作成（逆リンク）**: `quests/schemas.py::QuestCreateRequest.from_info_id` 追加、`quests/application.py::create_quest` が同UoWで info_link（quests/related/manual）を自動生成（不在は422）。frontend=`info-input/api.ts::createQuestFromInfo`＋`components/QuestFromInfoPanel.tsx`（実API化・下書き作成→`/quests/{id}`遷移）。
- **raw 物理削除**: app `delete_info_item`（登録者本人・raw のみ・curated は409 invalid_state・続報ありは409 has_follow_ups・従属行削除＋MinIO 除去）、router `DELETE /info-items/{id}`。frontend=行⋯メニューを実API化（`api.ts::deleteInfoItemApi`）。
- **情報判定権限（info_curator）付与/剥奪**（N.5）: repo `list/grant/revoke_curator`、app `list/grant/revoke_info_curator`（account_id→会社DB user 解決・会社外404・二重付与409）、router `GET/POST /info-curators`・`DELETE /info-curators/{account_id}`（`Depends(require_company_account_admin)`）。frontend=`features/accounts/components/InfoCuratorSection.tsx`（SC-93 `/admin/accounts` に配置）＋`accounts/api.ts` に list/grant/revoke。
- **反証→揺さぶり通知**（§N.6・通知のみ MVP）: `notifications/catalog.py` に型 `info_refuting_raised`、`info/application.py::_notify_refuting`（post-commit dispatch）を `add_link`（refuting起票）と `change_link_kind`（related/supporting→refuting 遷移）にフック。宛先解決 repo helper=`ideas/repository.py::voter_ids`、`quests/repository.py::admin_user_ids`。frontend 変更なし（既存 H 基盤で generic 表示・href は ref_idea_id/ref_quest_id で既存ルーティング）。
- **編集導線の一本化＋fixtures 撤去**: `/info-items/[infoId]/edit` ルート（フル＋intercept）削除。`InfoFormModal.tsx`/`InfoFormPanel.tsx` を新規/続報専用に簡素化（`mode` prop 廃止）。行⋯「内容・属性を編集」→詳細へ遷移。`info-input/api.ts` のインメモリ fixtures（store＋get/update/create/archive/delete/linkQuestFromInfo/listInfoItems/followUps/rootOf/isCurated）を全撤去（`emit`/`InfoInput` は存置）。理由=編集は詳細インライン編集(PATCH)に統一済で fixtures が死にコード化。
- docs 追随: `doc/API設計/N_情報インプット.md`（N.1/N.2/N.3/N.5/N.6）、`doc/データモデル.md §5.33`、`doc/テスト/N_情報インプット.md`（N-TC-125〜139）、`impl/README.md`（SC-50 行=🟩）、OpenAPI 型 `impl/frontend/src/lib/api/schema.d.ts` 再生成。

## 4. 現在の状態
- **FR-41 情報インプット＝Phase A〜D 完了・fixtures 残渣ゼロ・全経路 実API結線**。一覧/詳細/登録/続報/内容編集(版履歴)/キュレーション/関連リンク(追加·種別·棄却)/貼付画像再ホスト/参考資料/アーカイブ/この情報からクエスト作成/raw物理削除/curator付与/反証通知 が動作（backend＋frontend）。
- **テスト通過（本セッションで実行し確認したもの）**: `docker compose run --rm backend pytest tests/info` = **55 passed**。回帰確認=`tests/notifications`＋`tests/ideas`=105 passed、`tests/quests`=115 passed。frontend=`npm run build` 通過・`npx vitest run src/features/info-input/`=7 passed。`python3 scripts/check_tc_traceability.py`=✅ 697件。
- **未確認**: backend の**全**テストスイート（info/notifications/ideas/quests 以外）は本セッションで未実行。frontend の**全** vitest（info-input 以外）は未実行。**Playwright e2e は本セッションで未実行**。**情報インプットのブラウザ実機受入（ユーザーの動作確認ゲート）は未実施**。
- **壊れているもの**: 認識している範囲では無し。
- 稼働コンテナ（`docker compose ps`で確認済）: backend/db/redis/mailhog/minio/frontend/worker/mail-worker が Up。backend は本セッションで複数回 `--build` 再ビルド済（最新コードを反映）。

## 5. 詰まっている点（試して失敗した手と理由）
- **Edit ツールがテンプレートリテラル/特殊文字を含む行を一致できない**: `` `${x.name}` `` や全角 `✕` を含む old_string が「not found」になった。**回避=`perl -0777 -i -pe` で置換**（`InfoFormPanel.tsx` の attach 一覧修正で使用）。次回も特殊文字行の編集は perl/sed を先に検討。
- **テスト seed の FK 違反**: `tests/info/test_api.py::_seed_quest_idea_vote` で User→Quest→Idea→Vote を1回の flush でまとめたら `ideas_quest_id_fkey` 違反。**回避=各段で `ts.flush()` を刻む**（依存順に確定）。
- **管理者 seed の所在**: `company_account_admin` は `bootstrap.py` の `_SEEDS`（user@acme・mfa@acme2 のみ）には**無い**が、`scripts/seed_demo.py` 由来で **`kanri@acme.example` が DB volume に永続実在**（`docker compose exec backend python` で確認済）。過去に「管理者 seed 無し」と誤認しかけた＝実在する。

## 6. 決定事項と根拠（不採用案も）
- **反証通知の宛先＝成果物の作成者/所有者＋評価者(投票者)＋クエスト管理者**、**要再評価は通知のみ(MVP)**。理由=ユーザー選択。不採用=成果物側に「要再評価フラグ/評価リセット」を今回入れる案→アイデア/評価ドメイン改修が重く、コンセプト段の設計（§3.5）と併せて後回し。
- **info-curators EP の識別子＝`account_id`**（N.5 の当初 `user_id` を実装で更新）。理由=会社アカウント管理画面は account 中心。サーバーが `account_id→会社DB user` に解決。
- **編集は詳細のインライン編集(PATCH)に一本化**（登録フォームは新規/続報専用）。理由=二重導線と fixtures を排除。不採用=SC-11 相当のフル編集フォーム流用→重複。
- **この情報からクエスト作成＝軽量パネルで下書き作成→SC-11 で仕上げ**。理由=クエスト作成フォーム(参加部署/パーティー/権限)をこの動線で完結させると重い。`from_info_id` で逆リンクだけ確実に張る。
- **フッターは「閉じる/保存する」に限定**（アーカイブ等は本文/⋯メニュー）＝SC-50 §8・ユーザーの明示ルール。
- **参考資料/画像は自社 MinIO 再ホスト**＝外部参照(トラッキング/referer)を持ち込まない（§N.7/§12-4）。

## 7. 次にやること（優先順・具体的に）
1. **情報インプットの実機受入**（未実施の受入ゲート）＝`http://localhost:3000/info-items` を `user@acme.example`（一般）と `kanri@acme.example`（curator/管理者）でブラウザ確認。特に: 登録フォームの画像 paste 再ホスト・参考資料 D&D・詳細インライン編集(内容/属性/リンク)・アーカイブ/解除タブ・続報登録・この情報からクエスト作成・raw削除・`/admin/accounts` の `InfoCuratorSection`・反証リンクで通知ベル。不具合は再現テスト同梱で修正（テスト規約 §5.3・メモリ defect-regression-test-policy）。
2. **メモリ `internal-review-remaining-items`（社内レビュー未実施2件）**: ①評価ダイアログにクエスト情報を追加、②クエスト最終結果の機能実装。着手前に該当 SC/API 設計を確認。
3. **要再評価フラグ/リセット**（反証の続き・§3.5）＝成果物(アイデア/評価)側とコンセプト段の設計判断が要るので、コンセプト機能設計と併走で。
4. **コンセプト機能の設計**（メモリ `concept-feature-design-split`・`fr39-iso-mapping-superseded`）＝FR-39 の真の②③段。
5. **実装順の正本 `doc/実装計画.md`** を確認し、上記と突き合わせて次ドメインを決める。

## 8. 再開に必要な環境情報
- **リポジトリ直下**=`/home/t-umekawa/sc-ideaquest-G2`。compose ファイル=**`impl/compose.yaml`**（`docker-compose.yml` は無い）。全 docker コマンドは **cwd=`impl/`** で実行。
- **起動**: `cd impl && docker compose up -d`（コード変更を backend に反映するには **`docker compose up -d --build backend`**＝backend はソースをベイクしボリューム無・メモリ `backend-no-source-mount`）。frontend も docker（3000）で常駐。
- **ポート**: frontend 3000 / backend 8000（`/api/v1`・health=`/api/v1/health`）/ db 5432 / redis 6379 / minio 9000(API)・9001(console) / mailhog 1025・8025。
- **backend テスト**: `cd impl && docker compose run --rm backend pytest tests/info -q`（cwd は暗黙 `/app`）。**未コミットのテストだけ**を反映して回すには `-v "$(pwd)/backend/tests:/app/tests"` をマウント（app 本体の変更は再ビルドが必要）。
- **frontend 検証**: `cd impl/frontend && npm run build`（**必須ゲート**＝Next lint 含む・メモリ frontend-build-gate-eslint）／`npx vitest run <path>`／`npm run codegen`（OpenAPI 型再生成＝backend:8000 稼働が前提）。
- **TC トレーサビリティ**: `cd <repo root> && python3 scripts/check_tc_traceability.py`（コミット前に ✅ を確認）。
- **ログイン（確認済）**: `user@acme.example` / 会社 `ACME-01` / `Passw0rd!`＝一般。`kanri@acme.example` / `ACME-01` / `Passw0rd!`＝company_account_admin（curator 付与/管理画面用）。`admin@ops`（会社 OPS）＝system_admin（メモリ記載・本セッションでは未再確認）。
- **DB 直接操作**（seed 後始末等）: `docker compose exec -T backend python -c "..."`。会社 ACME の会社DB識別子=`ideaquest_company_acme`。テナントセッション=`app.db.tenant.get_tenant_session(db_identifier)`、管理DB=`app.db.control.control_session`。
- **migration**（会社DB）: `impl/backend/migrations/company/versions/`＝情報インプット関連は `0028_info_input`／`0029_info_revisions`／`0030_info_attachments`。起動時 `scripts/bootstrap.py` が全会社DBへ migrate＋非本番 seed。

---
### 自己チェック（本ファイルだけで再開できるか）
- 起動/テスト/ログイン/ポート/DB操作=記載済。compose ファイル名の罠(`compose.yaml`)も明記。
- FR-41 の全機能と対応ファイル/関数=記載済。次アクションはファイル/画面レベルまで具体化。
- 未確認事項（全スイート/e2e/実機受入）を明記＝過信を防止。
- 設計正本の在処（`doc/`・CLAUDE.md 経由）とメモリ参照キーを明記。
