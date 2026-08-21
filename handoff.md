# handoff.md — ideaquest 開発引き継ぎ

> 読者＝「このセッションの記憶が一切ない次回の自分」。会話ログは参照不可。**このファイルだけで再開できる**ように書く。
> ルール＝毎回全文上書き（履歴は git）／確認した事実のみ・未確認は「未確認」と明記／コードの塊は貼らずファイルパス+関数名で示す。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: **2026-08-22 JST**
- ブランチ: **main**（作業も main に直接コミット）。**push は都度ユーザー承認制**。本 handoff コミット後に push する（ユーザー指示）。
- 本 handoff コミット前の最新＝**`5ef3e99` docs(design) §4.7 確定**。
- 未 push の並び（新しい順・本 handoff 前で 6 本＝すべてローカル先行）:
  1. `5ef3e99` docs(design): 入力検証エラー UI 標準 §4.7 を確定
  2. `d581e5f` fix(SC-91/92): モーダルのフォーカス喪失／会社一覧のページ保持／操作を RowMenu 化
  3. `8387f95` docs(design): 入力検証エラー UI 標準を改定（§4.7）＋spec-first ルール
  4. `72461f2` feat(C/SC-10): クエスト一覧フロント接続
  5. `22a8c20` feat(C/SC-10): クエスト一覧 backend（初のテナントルータ）
  6. `3886b32` feat(C/data): クエスト・パーティー・権限のテナントDB基盤
- その前＝`693863c`（前回 handoff・push 済み境界）。再開時は `git status -sb` と `git log origin/main..HEAD` で確認。

## 2. ゴール（プロジェクト概要）
- **ideaquest** = 社内アイデア創出のゲーミフィケーション型マルチテナント SaaS（XP/コイン/レベル/魔法/ランキング）。
- 構成＝Next.js(App Router) フロント ＋ FastAPI(4層) バック ＋ PostgreSQL/Redis/MinIO/MailHog/Docker。設計は完了済み。
- 現フェーズ＝画面移植は完了、**backend 接続を 1画面単位ループ**（フロー規約 §1.1・各画面で受入ゲート）で実施中。**実装順の正本＝[`doc/実装計画.md`](doc/実装計画.md)**。現在フェーズ2「クエスト管理（C ドメイン）」を進行中。

## 3. 今回やったこと（変更ファイルと理由）
本セッションは (A) フェーズ2 C ドメイン着手（データ基盤→SC-10 接続）と、(B) ユーザーの手動検証で出た横断/画面指摘への対応（入力検証 UI 標準の確定＋SC-91/92 バグ修正）を並行実施。最後に (C) SC-11 の設計精読まで。

### 3-A. C ドメイン データ基盤（`3886b32`）
- 会社DB に **quests / quest_categories / quest_members / quest_member_permissions** を追加（データモデル §5.6〜§5.9・API設計 C.1〜C.3）。
- `impl/backend/app/tenant/quests/orm.py`＝4 ORM（enum は §5.3 同方針で String・論理削除トゥームストーン）。
- `impl/backend/migrations/company/versions/0009_company_quests.py`＝テーブル＋部分ユニーク index（quest_members は `UNIQUE(quest_id,user_id) WHERE removed_at IS NULL`）。`migrations/company/env.py` に quests ORM 登録。**company migration head＝`0009_company_quests`**（前は `0008_company_users_bg_image`）。revision id は 32字以内。
- `impl/backend/app/tenant/quests/repository.py`＝create/get/`list_quests_for_user`（可視性 A/B）・カテゴリ置換・パーティー（既定権限自動付与・トゥームストーン再利用・権限置換・件数・候補グループ・N+1 回避の一括取得）。呼び出し側 Tx に相乗（自身で commit しない＝quest_group と同方針）。
- **可視性(A)の要点**＝`list_quests_for_user` は「非draft × 所属グループ内 × 自分がパーティー参加中（`quest_members` 有効行を EXISTS で per-quest 強制）」＋(B)「自分の下書き」。当初グループ絞りだけでパーティー門番が抜けていたのを実装中に修正（C.0）。
- test＝`impl/backend/tests/quests/test_repository.py`（C-TC-001〜009・002b＝10件）。red-green＝可視性の draft 分岐と add_member のトゥームストーン再利用を一時無効化して該当 TC が fail する red を目視→復元して green。

### 3-B. SC-10 一覧 backend（`22a8c20`）
- **初のテナントプレーンルータ**＝`impl/backend/app/tenant/quests/router.py`（`GET /quests`・`GET /quest-groups`・prefix `/api/v1`）。`impl/backend/app/main.py` に配線。認可＝`Depends(require_me)`（認証済み active 一般ユーザー・C はロールを問わずパーティー/権限で門番）。
- `impl/backend/app/tenant/quests/application.py`＝会社DB 動的解決（company_id はセッション由来・§1.5）→テナントユーザー解決→可視性満たす一覧を DTO 化。カーソル §1.8（me と同方式の不透明カーソル `_encode_cursor`/`_decode_cursor`）。status enum 検証・不正カーソルは 422。
- `impl/backend/app/tenant/quests/schemas.py`＝`QuestCardDTO`/`QuestOwnerDTO`/`QuestGroupRefDTO`/`QuestListResponse`/`QuestGroupDTO`/**`QuestGroupsResponse`**/**`QuestCursorPageInfo`**。署名URL で返す（キー直返し禁止・§3.2）。
- test＝`impl/backend/tests/quests/test_api.py`（C-TC-101〜105＝5件）。

### 3-C. SC-10 一覧 フロント接続（`72461f2`）
- `impl/frontend/src/features/quests/api.ts`＝`listQuests`/`listQuestGroups`（apiFetch・生成型）。
- `impl/frontend/src/features/quests/components/QuestListView.tsx`＝デモ配列をやめ**マウント時フェッチ→DTO をビュー型へマッピング**（status enum→ラベル・color→アクセント・deadline 整形/締切近接・member_count/idea_count・my_state→バッジ・カテゴリ/グループの絞込候補は取得データから動的生成）。ローディング/エラー表示追加。**client DataTable のまま**（カーソル「もっと見る」は SC-10 §9 TBD＝当面 limit=100 の1ページ）。
- `impl/frontend/src/lib/api/schema.d.ts` 再生成。**衝突修正**＝C の schema 名が既存 B(admin `QuestGroupListResponse`)/K(me `CursorPageInfo`) と衝突し openapi-typescript が両方を完全修飾名に落として既存機能（accounts/qgadmin/questgroups の api.ts）の型を壊したため、C 側を **`QuestGroupsResponse`/`QuestCursorPageInfo`** に一意化（§5 に再掲）。

### 3-D. 入力検証エラー UI 標準の確定＋spec-first ルール（`8387f95`＋`5ef3e99`）
- ユーザー検証由来の横断指摘。`doc/画面設計/デザイン標準.md` **§4.7 新設**（旧 §4「2026-08-02・インラインのみ・最初のエラーへフォーカス」を上書き）。新標準＝**インライン中心（枠赤 `aria-invalid`＋`.field__error`）＋上部サマリ `.form-summary` 併用／検証は送信時＋blur／エラー項目へのフォーカス移動はしない／i18n（ja/en）**。**ステータス＝確定（ユーザーが `mocks/style-guide.html`「4b.」を確認・承認）**。
- サンプル＝`doc/画面設計/mocks/style-guide.html`「4b.」（インライン＋赤枠＋上部サマリ＋blur デモ）。`mocks/shared.css` に `.form-summary` 追加。`mocks/shared.js` のバリデーションヘルパ コメント更新。
- `doc/画面設計/デザイン標準.md` §4.5⑨ に「URL 同期のページ復元は client/server 両モードで同一挙動（会社一覧のページが戻らないのは違反＝バグ）」を明記。
- `doc/規約/フロントエンド実装フロー規約.md` **§7.1「spec-first」新設**＝検証/レビュー由来の指摘は「正の md」に先に反映（振り分け表付き）／既存仕様が規定済みの純粋バグは仕様追記不要／大きな横断標準は style-guide 見本先行。

### 3-E. SC-91/92 バグ修正（`d581e5f`・ユーザー検証指摘 3 件）
- **#3 Modal フォーカス喪失**（SC-92 グループ作成ダイアログでコード入力後、名前入力でフォーカスがコードへ飛ぶ）: `impl/frontend/src/components/ui/Modal.tsx` の初期フォーカス effect が `[open, onClose]` 依存＝呼び出し側インライン `onClose` が毎レンダ別関数→入力毎に effect 再実行→先頭フィールドへ再フォーカス。**初期フォーカス/スクロールロック/復帰を `[open]` のみに、Esc/トラップの keydown は `onCloseRef` 経由の最新参照に分離**。全モーダル共通の改善。
- **#7 会社一覧のページ保持**（SC-91・server モードで一覧→詳細→戻るで page が 1 に戻る）: `impl/frontend/src/components/ui/DataTable.tsx` の範囲外クランプ effect が、初回クエリ前 `srv=null→total=0→pages=1` の段階で URL 復元の `page=2` を潰していた。**`srvLoaded` 完了前はクランプしないガード**を追加（§4.5⑨）。
- **#8 会社一覧の操作を RowMenu 化**（SC-91 カードで「管理する →」が会社名に被る）: `impl/frontend/src/features/companies/components/CompanyList.tsx` の `_actions` を `<Link>` から **⋯ RowMenu「管理する」**（router.push）に置換。行内リンクで会社詳細へ遷移していた e2e（`sc-92b`/`sc-92b2`/`sc-92c`）を**行クリック（先頭セル＝onRowClick 主アクション §4.5⑪）**に更新。
- test＝`impl/frontend/e2e/sc-92c-quest-groups.spec.ts` に **B-TC-117**（作成ダイアログのフォーカス保持）追加。red→green 観測済み（旧版で `#g_name` が "計" 1文字＋非フォーカス→修正後フォーカス保持）。

### 3-F. SC-11 設計精読（コミット無し・未着手）
- SC-11 画面仕様（`doc/画面設計/screens/SC-11_クエスト作成編集.md`）・API（C.2/C.3/C.4）・現行モック（`impl/frontend/src/features/quests/components/QuestForm.tsx`＝226行・`QuestCreateModal.tsx`・`QuestCreatePanel.tsx`）・ルート（`/quests/new` フルページ＋`@modal/(.)quests/new` intercept）を精読。**実装は未着手＝下記 §7 の論点 1〜4 のユーザー確認待ちで停止**。

## 4. 現在の状態（動く / 壊れている / テスト）
### 4-1. backend
- 登録ルータ＝**auth / admin / me / quests（新）** の4つ（`impl/backend/app/main.py`）。quests は `GET /quests`・`GET /quest-groups` のみ（読み取り）。
- **未実装ドメイン**＝C の作成/編集/公開/パーティー粒度EP/候補EP/アイコンEP（次フェーズ・§7）／D アイデア／E チャット／F 評価／G 残り／H 通知／I 集約／J 検索／L WS。API 設計は全ドメイン確定（`doc/API設計/{A..L}_*.md`）。
- **pytest＝236 passed**（既存 221＋repository 10＋api 5・本セッションでフル実行確認）。既知フレーク＝`test_a_tc_040` が pytest-randomly のランダム順で稀に IndexError（単独/別シードで green・既存）。

### 4-2. frontend
- backend 接続済み＝認証 SC-00／プロフィール SC-03/K／管理 SC-90/91/92/93／**SC-10 クエスト一覧（新）**。
- **SC-10＝code-complete だが受入ゲート未実施**＝実データ表示の確認は**未確認**（ACME-01 の一般ユーザーが参加中のクエストが 0 件のため、実際に一覧にカードが出るかは未検証。動作確認にはクエストを1件 seed する必要あり・§7）。
- 入力検証 §4.7＝**標準は確定・impl 共通部品と既存フォームへの適用は未実施**（SC-11 実装時に用意＝§7）。
- SC-91/92 の 3 修正は稼働 frontend に反映済み（再ビルド済み）。
- デモ fixtures（未接続）＝SC-02/11/12/21/22/24/25/30/31/32/40/41、SC-01 の各パネル。

### 4-3. テスト
- **frontend e2e（本セッションで green 確認・各 spec 単独＋FLUSHALL）**＝`sc-92c`(2＝B-TC-116/117) ／ `sc-91-companies`(8) ／ `sc-92b-accounts`(2) ／ `sc-92b2-account-edit`(1) ／ `sc-92-company-detail`(2)。**Modal 修正・DataTable ページ保持・RowMenu 化・行クリック遷移に回帰なし**。
- **frontend tsc（`npx tsc --noEmit`）＝既知2件のみ**＝`Snackbar.tsx:57`・`ShopView.tsx:98`（今回変更と無関係のデモ画面）。本セッションの全変更はクリーン。
- **未実施＝SC-10 の e2e**（実データ seed が要る）と #7 ページ保持の専用 e2e（perPage=5 で page 2 を出すには会社 6 件以上の seed が要り、当面は修正の根拠＋回帰＋手動確認で担保）。

### 4-4. 稼働状態
- **本セッションで backend/frontend を再ビルド済み・全サービス起動中**（`--profile workers`）。ホスト/Docker 再起動で全 exit したら §8 で再起動。

## 5. 詰まっている点（試して失敗した / 注意）
- **frontend はソース焼き込み（ボリューム未マウント）**＝`impl/frontend/Dockerfile` は `COPY . .`＋`next dev`。**ホストのソース編集・e2e spec は稼働コンテナに自動反映されない**＝`up -d --build frontend` で再ビルドが必要（ユーザーが今触っている画面も旧版のまま）。**backend も焼き込み**（`up -d --build backend`）。
- **OpenAPI schema 名の衝突に注意**＝FastAPI/Pydantic で**同名クラス**が2ドメインにあると openapi-typescript が両者を完全修飾名（`app__tenant__...`）にリネームし、既存機能の `components["schemas"]["Xxx"]` 参照を壊す。C ドメインは `QuestGroupsResponse`/`QuestCursorPageInfo` に一意化して回避済み。**新規 schema は既存と名前衝突しないか確認**。
- **codegen 後の型崩れは frontend tsc で検知**＝`docker compose exec -T frontend npx tsc --noEmit`（既知2件以外が出たら衝突/破壊を疑う）。
- **e2e の OPS ログイン レート制限フレーク**＝複数 spec を連続実行するとログイン制限で fail する（本セッションでも sc-92b2 が連続実行で fail→単独で green）。**1ファイルずつ＋各前に `redis-cli FLUSHALL`**。
- **Bash の cwd は継続するが env は継続しない**＝backend テストの `-v "$PWD/backend:/app"` は **cwd=`impl` が前提**。別コマンドで `cd /home/t-umekawa/sc-ideaquest-G2` すると `$PWD/backend` が存在せず bootstrap が `No module named 'scripts'` で落ちる。テスト実行前に `cd .../impl`。
- **frontend 再ビルドで Playwright chromium/依存が消える**＝毎回 `install-deps chromium`(root)＋`install chromium`。`docker compose cp` した使い捨て spec は再ビルドで消える。
- **MinIO 署名URL は e2e（コンテナ内ブラウザ）では実ロード不可**＝img の `src` 属性検証のみ（既存 `sc-03-images` 同方針）。実ロード可否はホストから `curl`。
- **MinIO 署名URL の docker ホスト問題**＝backend は内部 `minio:9000`、ブラウザは公開 `localhost:9000`。`storage.py` は2クライアント（`_ops`/`_url`）分離・両方に `region=` 明示（`presigned_get_object` が region 未指定だと 500）。
- **Alembic revision id は 32字以内**（`alembic_version` が varchar(32)）。会社DB migration＝`migrations/company/versions/`（head `0009_company_quests`）、管理DB＝`migrations/control/versions/`（head は要確認・前回 `0010_accounts_pending_email`）。
- **CSS 二重定義**＝`.btn-outline` は `design-system.css` と `components.css` の両方にあり import 順で後者勝ち。usermenu も二重定義。
- **next/image は `images.unoptimized:true`**＝素の img 描画のため署名URL の remote host 許可不要。
- **DataTable URL 同期のループ回避**＝書き戻し effect の依存に `searchParams` を入れない（基点は `window.location.search`）。

## 6. 決定事項と根拠
- **入力検証エラー UI 標準（§4.7・確定 2026-08-22・ユーザー承認）**＝インライン中心（枠赤＋`.field__error`）＋上部サマリ `.form-summary` 併用／送信時＋blur／**フォーカス自動移動はしない**（旧「最初のエラーへフォーカス」を撤回）／i18n（ja/en）。**採用しなかった案**＝「インラインのみ」「サマリのみ」「フォーカス移動あり」。impl の i18n 機構は**未整備**（現状 ja 直書き）＝SC-11 実装に合わせ導入（§7）。
- **spec-first（フロー規約 §7.1）**＝検証由来の指摘は正の md（横断UI=デザイン標準／画面固有=screens／動線=画面遷移図／API=API設計／用語=§4.6）に先に反映。**既存仕様が規定済みの純粋バグは仕様追記不要**（例＝#7 はデザイン標準 §4.5⑨ が既にページ復元を規定＝バグ修正であって仕様追記でない）。
- **SC-10 の暫定値**＝`idea_count` はドメイン D 未実装のため 0、`my_state` は draft/member（未投稿/投稿済みは D 実装後に精緻化）。カーソル「もっと見る」は §9 TBD で当面 limit=100 の client DataTable。
- **Modal フォーカスは `[open]` のみで再実行**（onClose は ref 経由）＝インライン onClose の identity 変化で再フォーカスさせない。
- **schema 名は C 専用の一意名**（`QuestGroupsResponse`/`QuestCursorPageInfo`）＝既存 B/K との衝突回避（§5）。
- **実装順＝アカウント登録→クエスト管理→アイデア→評価→その他**（`doc/実装計画.md`）。C が D/E/F/フィードの門番。アップロードは後回しにしない（MinIO 共通基盤流用）。

## 7. 次にやること（優先順・具体的に）
1. **SC-11 実装の前に、精読で挙げた論点 4 件をユーザーに確認**（本セッション最後に提示済み・私の推奨で合意なら着手）:
   - **論点1**: 編集導線ルート未整備＝現状 `/quests/new` のみ。SC-11 を編集に使うには `/quests/{id}/edit`（＋`@modal/(.)quests/[id]/edit`）を追加。**推奨＝追加**。
   - **論点2**: クエストアイコンのアップロード方式＝会社アバターと同じ**専用 multipart EP（`PUT/DELETE /quests/{id}/icon-image`）＋「作成→アイコン PUT」2段**（K.4 流儀・`impl/backend/app/infra/storage.py` の `validate_image_upload` 流用）。**推奨＝これ**。
   - **論点3**: publish の参加通知（ドメイン H）未実装＝**通知は H まで no-op**、publish は内容適用＋strict＋`draft→recruiting` までを実装。**推奨＝no-op で進める**。
   - **論点4**: 下書きの members 空許容（C.7 TBD）＝**MVP は許容**（公開時 strict で担保）。**推奨＝許容**。
2. **SC-11 backend 実装**（`impl/backend/app/tenant/quests/` に追記・1画面ループ）:
   - `application.py`＝`create_quest`/`update_quest`/`publish_quest`＋ドメイン関数 **`apply_party_diff`**（候補制限・`owner` 付与は作成者のみ・作成者保護・既定権限）と **`validate_publishable`**（`title`/`color`/`categories≥1`/`quest_group_id`）を共有。カテゴリ正規化（トリム＋大小/全半角・`is_custom`）。Idempotency-Key（§1.9）。現在 status で検証分岐（draft=緩い/公開中=strict/completed=409）。
   - `router.py`＝`POST /quests`・`PATCH /quests/{id}`・`POST /quests/{id}/publish`・`GET /quest-groups/{id}/members`（候補・`exclude_user_ids`・C.4）・アイコン EP（論点2）。変更系は Origin/CSRF（`verify_origin`/`verify_csrf`）。
   - `schemas.py`＝作成/編集/公開のリクエスト DTO・候補レスポンス（**一意名**に注意）。
   - repository は既存（add/remove/set/list/replace_categories）を流用。必要なら候補一覧に `exclude` 対応の関数を追加。
   - test＝`tests/quests/` に C-TC（作成・可視性・候補除外・owner 付与制限・作成者保護・publish strict・状態機械 409）を red-green で。
3. **SC-11 frontend 接続**（`QuestForm.tsx` を接続・1画面ループ）:
   - グループ＝`GET /quest-groups`、候補＝`GET /quest-groups/{id}/members?exclude_user_ids=[選択済＋本人]`（グループ変更で入替）。権限キー写像（`manage/eval/vote/idea/comment`→`quest_admin/evaluator/vote/idea_create/comment`＋`owner`）。status（下書き/作成）・publish（編集時の公開）。
   - **§4.7 の impl 共通部品を用意**＝`components/ui/Field` に `aria-invalid` 付与／サーバー `errors[]`→`{field:msg}` 変換ヘルパ／`.form-summary`（`design-system.css`）／i18n カタログ（ja/en）。
   - クエストアイコン 2段（論点2）。編集ルート（論点1）。e2e（`sc-11-quest-create-modal.spec.ts` を実接続に更新）。
   - **受入ゲート（ユーザー動作確認）で必ず止める**。
4. **SC-10 の受入ゲート**＝ACME-01 の一般ユーザーが参加中のクエストを1件 seed（または SC-11 実装後に作成）→ 一覧に出ることをユーザーが確認。
5. **その後 SC-12 詳細/パーティータブ/状態遷移**（C.1 詳細・C.3 粒度EP・C.5 transition）。時系列フィード（SC-12→SC-01）は C 周回で。
6. **（保留・継続）セッション最初にユーザーが手動でログイン疎通確認（system_admin→会社作成→active化→アカウント発行→初回PW→ログイン）をしていた**。会社の `active` 化手順は**未確認**（`companies.status` 更新方法＝要調査。suspended だと一般ユーザーのテナント API は 503・§1.5）。完了可否は未確認。
7. **（折衷・随時）既存フォームを §4.7 標準へ順次是正**（先頭1件のみ表示・サマリ無し・`aria-invalid` 未付与のもの）。

## 8. 再開に必要な環境情報
- 作業ディレクトリ: `/home/t-umekawa/sc-ideaquest-G2`。compose は `impl/compose.yaml`。**コマンドは絶対パス `-f /home/t-umekawa/sc-ideaquest-G2/impl/compose.yaml` 推奨**。
- **フルスタック起動**＝`docker compose -f impl/compose.yaml --profile workers up -d --build`。ポート＝frontend :3000／backend :8000（`/healthz`）／db :5432／redis :6379／minio :9000(API)/:9001(コンソール)／mailhog UI :8025。**e2e は `--profile workers` 必須**。
- **backend コード反映**＝`up -d --build backend worker mail-worker`。**frontend コード反映**＝`up -d --build frontend`（焼き込み＝マウントされない）。
- **backend テスト**（cwd=`impl`）＝`cd /home/t-umekawa/sc-ideaquest-G2/impl && docker compose -f /home/t-umekawa/sc-ideaquest-G2/impl/compose.yaml run --rm -T -v "$PWD/backend:/app" backend pytest tests/ -q`（マウント即反映・bootstrap が migration 適用・MinIO は Fake・**redis 起動が前提**）。※`--no-deps` を付けると redis 未起動で全 ERROR になるので付けない。db 起動直後は `pg_isready` を待つ。
- **openapi 型再生成**（backend 再ビルド後）＝`docker compose -f impl/compose.yaml exec -T -e OPENAPI_URL=http://backend:8000/openapi.json frontend npm run codegen` → `docker compose -f impl/compose.yaml cp frontend:/app/src/lib/api/schema.d.ts /home/t-umekawa/sc-ideaquest-G2/impl/frontend/src/lib/api/schema.d.ts`（cp 先は絶対パス＝cwd=impl だと `impl/impl/...` になり失敗する）。
- **frontend 型チェック**＝`docker compose -f impl/compose.yaml exec -T frontend npx tsc --noEmit`（既知2件は §4-3）。
- **frontend e2e**（Docker）＝(1)`exec -T -u root frontend npx playwright install-deps chromium`（再ビルド毎）(2)`exec -T frontend npx playwright install chromium` (3)`exec -T redis redis-cli FLUSHALL`（各 spec 前）(4)`exec -T frontend npx playwright test e2e/<spec> --workers=1 --reporter=line`。**1ファイルずつ**（連続 OPS ログインのレート制限フレーク回避）。
- **dev ログイン（seed・PW 全て `Passw0rd!`）**＝system_admin `OPS`/`admin@ops.example`／一般 `ACME-01`/`user@acme.example`(MFA OFF)・`ACME-02`/`mfa@acme2.example`(MFA ON)。MailHog＝`http://localhost:8025`。
- **MinIO env（dev 既定）**＝`MINIO_ACCESS_KEY=ideaquest`/`MINIO_SECRET_KEY=ideaquest-secret`/`MINIO_BUCKET=ideaquest`。バケットは `MinioStorage._ensure_bucket()` が初回作成。コンソール `http://localhost:9001`。
- 規約＝`CLAUDE.md` から辿る。**実装順の正＝`doc/実装計画.md`**。デザインの正＝`doc/画面設計/mocks/*.html`（style-guide.html §4b 入力検証・§16 ツールチップ）＋`screens/*.md`＋`デザイン標準.md`（§4.5⑨ 一覧状態 URL 同期・§4.7 入力検証）。API 設計＝`doc/API設計/{A..L}_*.md`＋`README.md`（§1.8.1 DataTable 契約）。データモデル＝`doc/データモデル.md`（クエスト §5.6〜§5.9・enum §3）。フロー規約＝`doc/規約/フロントエンド実装フロー規約.md`（§1.1 1画面ループ・§7.1 spec-first）。
- 一時ファイル運用＝使い捨て spec/png は `/tmp`・コンテナ `/app/e2e` に作り、コミット前に削除。
