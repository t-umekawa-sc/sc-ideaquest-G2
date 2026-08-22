# handoff.md — ideaquest 開発引き継ぎ

> 読者＝「このセッションの記憶が一切ない次回の自分」。会話ログは参照不可。**このファイルだけで再開できる**ように書く。
> ルール＝毎回全文上書き（履歴は git）／確認した事実のみ・未確認は「未確認」と明記／コードの塊は貼らずファイルパス+関数名で示す。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: **2026-08-22 JST**
- ブランチ: **main**（作業も main に直接コミット）。**push は都度ユーザー承認制**。
- **全コミット push 済み（未 push＝0・`main...origin/main` 同期）**。最新＝`13e9798`。
- 直近の主なコミット（新しい順・抜粋）:
  - `13e9798` feat(ui §14): impl スナックバーに重なり UI を反映（その他N件→展開スクロール＋トグル緑ゲージ）
  - `1f153ba` feat(ui §14): 編集ダイアログ/会社詳細編集の完了後に成功スナックバー
  - `212ffca` fix(ui §15): 一覧の副作用アクション（削除/無効化/PW再設定/除外）をカスタム確認ダイアログ化
  - `a8a59c8`/`1f95d3f`/`303cdcc` fix(ui/RowMenu): カード複製の誤遷移根治（body へ portal）＋ヘッダーメニュー閉じ
  - `6c38335`/`bcb56ce` chore(test): TC-ID トレーサビリティ検査スクリプト＋pre-commit＋手順ゲート
  - `6f1bb07` docs(test): C テストパターン md＋e2e TC-ID＋red台帳
  - `5e53d3a` feat(D/data): アイデアのテナントDB基盤（ORM/migration 0010/repository）＋D md
  - （mock §14 の段階コミット `17749d4`/`3120ecd`/`391a08a`/`8df1c4d`）
- 再開時は `git status -sb` と `git log --oneline -20` で確認。

## 2. ゴール（プロジェクト概要）
- **ideaquest** = 社内アイデア創出のゲーミフィケーション型マルチテナント SaaS（XP/コイン/レベル/魔法/ランキング）。
- 構成＝Next.js(App Router) フロント ＋ FastAPI(4層) バック ＋ PostgreSQL/Redis/MinIO/MailHog/Docker。設計は完了済み。
- 現フェーズ＝**backend を 1画面単位ループで接続**（各画面で受入ゲート）。実装順の正本＝[`doc/実装計画.md`](doc/実装計画.md)。**C（クエスト）＝SC-10/11/12 接続完了、D（アイデア）＝データ基盤まで着手**。
- **CLAUDE.md に「各種規約」＋「設計の正本」参照節**あり（パス参照のみ・自動全文ロードはしない）。

## 3. 到達点（ドメイン別）
### 3-A. C（クエスト）＝SC-10/11/12 を backend＋frontend で接続完了（D/E/F/G/J 依存部分を除く）
- backend EP（`impl/backend/app/tenant/quests/`）＝C.1〜C.5 ほぼ網羅（一覧/詳細/作成/編集/公開/削除/前進遷移/アイコン2段/パーティー粒度/候補）。ドメイン関数（`_validate_publishable`/`_apply_party_diff`/`_normalize_categories`/`_authorize_edit`/`_build_detail`/完了凍結）。通知(H)・F.4 コインは no-op フック＋TODO。
- frontend＝SC-10 一覧／SC-11 作成・編集（`QuestForm` 両対応・アイコン2段・編集ルート）／SC-12 詳細（ヘッダー/概要/パーティー＋遷移＋削除）。§4.7 入力検証の共通部品（`FormSummary`＋`lib/forms/validation`）。「複製」（`lib/forms/duplicate.ts`）。

### 3-B. D（アイデア）＝データ基盤（`5e53d3a`）
- `impl/backend/app/tenant/ideas/orm.py`＝Idea/IdeaStakeholder/Attachment/Vote/IdeaRevision/Follow（§5.10〜§5.14・§5.23）。enum は String・トゥームストーン・changes は jsonb 版スナップショット。
- `impl/backend/migrations/company/versions/0010_company_ideas.py`＝6テーブル＋index/部分ユニーク/CHECK。**company head 0009→0010**。env.py 登録済み。※`attachments.chat_message_id` は E 未作成のため現状 FK なし／PGroonga 索引は J で追加。
- `impl/backend/app/tenant/ideas/repository.py`＝create/get/list(可視性=公開+自分の下書き)/stakeholders 置換/vote upsert(1人1票)+集計/revision/attachment/follow(冪等)。
- test＝`tests/ideas/test_repository.py`（D-TC-001〜012・12 passed）。red-green＝可視性/投票一意/フォロー冪等のガードを一時破壊し red 目視→復元（red台帳 D 節）。
- **application/router（作成/編集/公開/添付/版/投票/フォローの API）は未実装＝次スライス**。

### 3-C. 横断UI・テスト運用の整備（本セッション）
- **RowMenu をリストごと `document.body` へ portal（`a8a59c8`）**＝カード形式で ⋯メニューの余白クリックがカードの onRowClick（詳細）へ誤遷移する不具合を根治。回帰 e2e＝B-TC-161。
- **§15 カスタム確認ダイアログ（`212ffca`）**＝一覧の副作用アクション（削除/無効化/再有効化/PW再設定/グループ除外）を `window.confirm/alert` から `useConfirm`（破壊系は danger）＋成功は `useSnackbar` に統一（chat は E 未接続で未対応）。
- **§14 スナックバー重なり UI（`29d9a86`→mock 段階→`13e9798`）**＝同時表示は最新3件、超過は「▽ その他 N件」（標準と同じ緑ゲージ＝最後に消える隠れ通知の残り）に畳み、クリックで全件を縦スクロール展開（潰れず・折りたたみ中もカウント継続）。impl・mock 両方に実装。
- **完了スナックバー（`1f153ba`）**＝会社作成/アカウント発行・更新/クエスト作成・保存・公開/QG 作成・改称/会社詳細の各更新（設定/カラー/アイコン）で成功通知。
- **TC-ID トレーサビリティ検査（`bcb56ce`/`6c38335`）**＝`scripts/check_tc_traceability.py`（テストコードの `X-TC-###` が `doc/テスト/*.md` に在るか照合・code-only は exit 1）＋ `.pre-commit-config.yaml`＋テスト規約 §5 ゲート＋CLAUDE.md 想起。C/D のテストパターン md も新規作成（`6f1bb07`/`5e53d3a`）。

## 4. 現在の状態（動く / 壊れている / テスト）
### 4-1. backend
- 登録ルータ＝auth / admin / me / quests。**company migration head＝`0010_company_ideas`**。
- **未実装**＝D の API（application/router）／E チャット／F 評価／G ランキング・フィード・XP/コイン確定／H 通知（`quest_party_invited` は spec 登録済み・C 側 no-op）／J 全文検索／L WS。
- **pytest＝281 passed**（従来 269＋D repository 12）。※full 269 と ideas 12 を各々 green 確認（合算実行は未・個別は緑）。既知フレーク＝`test_a_tc_040`（pytest-randomly 順で稀に IndexError・単独 green）。

### 4-2. frontend
- 接続済み＝SC-00／SC-03,K／SC-10／SC-11（作成・編集）／SC-12（詳細＋遷移＋削除）／SC-90/91/92/93。「複製」＝SC-91/93/92(QG)。
- **frontend tsc＝既知2件のみ**＝`Snackbar.tsx`（`useRef` 無引数の型指摘・行番号は加筆でずれる）・`ShopView.tsx:98`（デモ）。C/D/横断UI の変更はクリーン。
- 未接続（デモ）＝SC-01 各パネル/SC-02/SC-12 のアイデア・検索・ランキングタブ/SC-21/22/24/25/30/31/32/40/41。

### 4-3. テスト
- **e2e（green 確認済み）**＝`sc-11-quest-create-modal`（C-TC-201〜204）／`sc-12-quest-detail`（C-TC-205/206）／`sc-91-companies`（B-TC-…＋**B-TC-161＝カード複製の回帰**）。**1ファイルずつ＋`redis-cli FLUSHALL`**、frontend 再ビルド毎に Playwright 再インストール、spec は `docker compose cp` でコンテナへ。
- **テストパターン md**＝`doc/テスト/{A,B,C,D,K}_*.md`＋`red確認台帳.md`。**コミット前に `python3 scripts/check_tc_traceability.py` ✅ を確認**（現状 code 275 件すべて md 記載）。

### 4-4. 稼働状態 / dev seed
- **本セッションで backend/frontend 再ビルド済み・全サービス起動中**（`--profile workers`）。
- **dev seed（検証用・削除可）**＝ACME-01 に **クエストグループ「デモグループ」(code `DEMO`)** ＋一般 `user@acme.example`（表示名「テスト 太郎」）所属。手動追加テナント **SYSCON**（`db_sc`・**active 化済み**）。会社追加/有効化の手順は **README.md「検証用の会社・ユーザーを追加する」**。

## 5. 詰まっている点（試して失敗した / 注意）
- **frontend/backend/e2e はソース焼き込み**＝`up -d --build frontend`／`up -d --build backend worker mail-worker` で再ビルド。e2e spec は `docker compose cp <spec> frontend:/app/e2e/`。
- **backend テスト/red-green の cwd 罠**＝`run --rm -T -v "$PWD/backend:/app" backend pytest ...` は **cwd=`impl` 前提**。`cd .../ideas` 等に移ると `$PWD/backend` が消えて bootstrap が `No module named 'scripts'` で落ちる。**必ず `cd /home/t-umekawa/sc-ideaquest-G2/impl`**。cp 先も絶対パス。
- **red-green（後追い）**＝`cp <file> /tmp/x.bak`→ガード一時破壊→red 目視→`cp /tmp/x.bak <file>`→`grep -c RED-DEMO`＝0。証跡は `red確認台帳.md` へ。
- **テスト追加は必ず md 先行**＝手順は テスト規約 §5・CLAUDE.md。コミット前に `python3 scripts/check_tc_traceability.py`。pre-commit は各端末で `pre-commit install`（README 参照・.git/hooks は共有されない）。
- **RowMenu は body へ portal 済み**＝カード/行の中に置いてもメニュークリックが親へ伝播しない。カード形式の一覧で新規に RowMenu を使う場合はこの前提でよい。
- **impl 共通部品の型注意**＝`useConfirm` の本文は **`msg`**（`message` ではない）。`QuestIcon` props＝`name/color/imageUrl/size`。`.seg`＝`.seg__btn`＋`aria-pressed`。所属行＝`.mrow`。スナックバー重なり＝`.snackbar-more`/`.snackbar-more__timer`/`.snackbar-stack.is-expanded`/`.snackbar.is-collapsed-hidden`。
- **テナント検証の前提**＝一般ユーザーはグループ所属が無いとクエスト作成不可＆一覧空。会社 suspended はテナント API 503。**会社 active 化は手動**（`UPDATE companies SET status='active' ...`・control DB `ideaquest_control`）／会社DB 作成は `docker compose exec backend python -m scripts.bootstrap`（冪等）。
- **OpenAPI schema 名衝突**＝新規 schema は既存と名前衝突しないか確認（C/D は `Quest*`/`Idea*` 等で一意化）。codegen 後は frontend tsc で検知。
- **Alembic revision id は 32字以内**。会社DB head＝`0010_company_ideas`。管理DB head は要確認（前回 `0010_accounts_pending_email`）。

## 6. 決定事項と根拠
- **§14 スナックバー重なり UI（確定 2026-08-22）**＝同時表示は最新3件。超過は「▽ その他 N件」に畳み、標準と同じ緑ゲージ＝**折りたたみ中で最後に消える（残り最長）隠れ通知の残り時間**で減る。クリックで全件を**縦スクロール展開**（`.is-expanded`・`max-height:60vh`・各バーは `flex:0 0 auto` で潰れない）。**折りたたみ中もカウント継続**（隠す項目は display:none にせずオフスクリーン退避）。展開/折りたたみでタイマーは止めない。
- **§15 確認ダイアログ**＝副作用アクション（編集ダイアログを開かないもの）は `window.confirm/alert` 禁止＝`useConfirm`（破壊系 danger）＋完了は `useSnackbar`。
- **完了スナックバー**＝実際に状態を変えた成功のみ通知（no-op では出さない・§14）。
- **RowMenu portal**＝カード/行の中でも誤遷移しないよう body へ portal（`a8a59c8`）。
- **テスト運用**＝md 先行（§5.2）＋TC-ID トレーサビリティ検査を DoD ゲート化＋pre-commit（`bcb56ce`/`6c38335`）。CI（GitHub Actions）連携は未（提案のみ）。
- （C の既存決定）SC-11/12 論点1〜4・状態遷移前進のみ・論理削除・可視性・カテゴリ is_custom TBD・色は hex 形式検証のみ。会社プロビジョニングは MVP 手動（§8-⑫）。

## 7. 次にやること（優先順・具体的に）
1. **D（アイデア）application/router を実装**（1画面ループ）＝`POST /quests/{id}/ideas`（作成・SC-21）／`GET /quests/{id}/ideas`（一覧・SC-12 アイデアタブ）／`GET /ideas/{id}`（詳細・SC-22）／`PATCH`/`publish`/`DELETE`／添付（multipart・MinIO・`validate_image_upload` 流用）／版（自動記録・diff）／投票／フォロー。公開時の `chat_groups` 作成（E 依存＝当面 no-op か最小作成）・投稿 XP+50（G 依存＝activities へ・no-op フック）。テストは **`doc/テスト/D_アイデア.md` に TC 行を先に追加**してから（§5.2）。
2. **D frontend 接続**＝SC-21 アイデア登録編集（`QuestForm` と同様に §4.7 部品流用）→ SC-12 アイデアタブ実接続 → SC-22 詳細。受入ゲートで停止。
3. **SC-11/SC-12 の受入ゲート**（ユーザー動作確認）＝作成/編集/公開／詳細・遷移・削除／スナックバー・確認ダイアログ。
4. **（折衷）既存フォームを §4.7 へ順次是正**（`.form-error` 旧式）。
5. **（任意）CI（GitHub Actions）** に tsc＋traceability＋pytest の軽量ゲート（private 無料枠 2000分/月で可）。

## 8. 再開に必要な環境情報
- 作業ディレクトリ: `/home/t-umekawa/sc-ideaquest-G2`。compose は `impl/compose.yaml`。**コマンドは絶対パス `-f /home/t-umekawa/sc-ideaquest-G2/impl/compose.yaml` 推奨**。
- **フルスタック起動**＝`docker compose -f impl/compose.yaml --profile workers up -d --build`。ポート＝frontend :3000／backend :8000（`/healthz`）／db :5432／redis :6379／minio :9000/:9001／mailhog :8025。**e2e は `--profile workers` 必須**。
- **backend 反映**＝`up -d --build backend worker mail-worker`。**frontend 反映**＝`up -d --build frontend`。
- **backend テスト**（cwd=`impl`）＝`cd /home/t-umekawa/sc-ideaquest-G2/impl && docker compose -f /home/t-umekawa/sc-ideaquest-G2/impl/compose.yaml run --rm -T -v "$PWD/backend:/app" backend pytest tests/ -q`。範囲＝`pytest tests/ideas -q`／`tests/quests -q`。
- **openapi 型再生成**（backend 再ビルド後）＝`docker compose -f impl/compose.yaml exec -T -e OPENAPI_URL=http://backend:8000/openapi.json frontend npm run codegen` → `docker compose -f impl/compose.yaml cp frontend:/app/src/lib/api/schema.d.ts /home/t-umekawa/sc-ideaquest-G2/impl/frontend/src/lib/api/schema.d.ts`（cp 先は絶対パス）。
- **frontend 型チェック**＝`docker compose -f impl/compose.yaml exec -T frontend npx tsc --noEmit`（既知2件は §4-2）。
- **frontend e2e**＝(1)`exec -T -u root frontend npx playwright install-deps chromium`（再ビルド毎）(2)`exec -T frontend npx playwright install chromium`(3)`cp <spec> frontend:/app/e2e/`(4)`exec -T redis redis-cli FLUSHALL`(5)`exec -T frontend npx playwright test e2e/<spec> --workers=1 --reporter=line`。**1ファイルずつ**。
- **TC-ID 検査**＝`python3 scripts/check_tc_traceability.py`（`--list` で一覧）。**pre-commit 有効化**＝各端末で `pip install pre-commit && pre-commit install`（README）。
- **会社DB 作成/有効化（手動）**＝`docker compose exec backend python -m scripts.bootstrap`→`docker compose exec db psql -U ideaquest -d ideaquest_control -c "UPDATE companies SET status='active' WHERE company_code='<CODE>';"`。詳細は README。
- **dev ログイン（PW 全て `Passw0rd!`）**＝system_admin `OPS`/`admin@ops.example`／一般 `ACME-01`/`user@acme.example`(MFA OFF・「テスト 太郎」・デモグループ所属)・`ACME-02`/`mfa@acme2.example`(MFA ON)。手動追加＝`SYSCON`/`t-umekawa`(active・初回PW は MailHog)。MailHog＝`http://localhost:8025`。
- 規約＝`CLAUDE.md`（各種規約＋設計の正本）。デザインの正＝`doc/画面設計/mocks/*.html`（`style-guide.html`：§4b 入力検証・§4c 編集不可・§9 複製・§14 スナックバー・§15 確認）＋`screens/*.md`＋`デザイン標準.md`。API 設計＝`doc/API設計/{A..L}_*.md`＋`README.md`。データモデル＝`doc/データモデル.md`。テスト＝`doc/テスト/*.md`＋`scripts/check_tc_traceability.py`。会社追加手順＝ルート `README.md`。
- 一時ファイル運用＝使い捨て spec/png は `/tmp`・コンテナ `/app/e2e` に作り、コミット前に削除。
