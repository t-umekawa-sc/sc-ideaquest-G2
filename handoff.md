# handoff — ideaquest 開発引き継ぎ

> 読者＝「このセッションの記憶が無い次回の自分」。会話ログは参照不可。本ファイルだけで再開できるよう全文を上書きする（履歴は git）。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: **2026-08-23**（時刻は概算・セッション終了時）。
- ブランチ: `main`（作業ツリーはクリーン＝未コミットなし）。
- 最新コミット: **`f479889`** `feat(D/SC-21): アイデア登録・編集フォームを backend に接続`。
- 本セッションの追加コミット（新しい順）: `f479889`（D/SC-21 フロント接続）／`73f8981`（§4.7 スクロール検証エラー）／`66e0f94`（auth §13 loading）／`d76e5d4`（§13 loading＋使い分け定義）。すべて push 済み（origin/main = f479889）。

## 2. ゴール
社内向けアイデア創出ゲーミフィケーション型マルチテナント SaaS「ideaquest」。フロント＝Next.js App Router、バック＝FastAPI 4層、DB＝PostgreSQL/Redis/MinIO/MailHog/Docker。開発は**1画面単位で backend 接続ループ**（各画面でユーザー受入ゲート）。実装順＝アカウント→クエスト(C)→アイデア(D)→評価→その他。正本＝[`doc/実装計画.md`](doc/実装計画.md)。

## 3. 今回やったこと（変更ファイルと理由）
### 3-A. §13 処理中プログレスの適用と使い分け定義（`d76e5d4`・`66e0f94`）
- 理由＝「フォーム POST 中はデザイン標準の処理中プログレスを出す」要望。4種プログレスの**使い分けが未定義**だったので先に定義。
- [`doc/画面設計/デザイン標準.md`](doc/画面設計/デザイン標準.md) §13 に使い分けを追記＝(1) ボタン内スピナー＝フォーム POST/PATCH/DELETE 押下の**既定** (2) パネルオーバーレイ＝パネル全体の再取得 (3) 確定バー＝計測可能な長時間処理 (4) コインスピナー＝インラインの短い待ち。
- `impl/frontend/src/components/ui/Button.tsx`＝`loading` プロップ追加（`.is-loading`＋`.iq-dot-spin`＋自動 disabled＋aria-busy）。
- 適用＝会社作成/アカウント発行編集/QG 作成編集/会社DB準備/クエスト作成編集（`QuestForm` は `pendingKind` で押下ボタンだけ spin）＋**認証系4画面**（`LoginForm`/`MfaForm`/`PasswordSetupForm`/`PasswordResetRequestForm`）。

### 3-B. §4.7 スクロールするダイアログの検証エラー可視化（`73f8981`）
- 理由＝ユーザー指摘「縦スクロールするモーダルで上部サマリ/インライン枠が画面外に隠れ、送信しても無反応に見える」（スクショ＝アカウント発行モーダル）。
- 決定＝**3チャネル併用**（デザイン標準.md §4.7 に追記・確定）。(1) 送信失敗時に上部サマリへ `scrollIntoView`（**フォーカスは奪わない**）(2) 常時見えるフッターに簡潔なエラー行 (3) **自動消滅しない**エラースナックバー（`duration:0`＝✕クローズのみ）。
- 新規部品＝`impl/frontend/src/components/ui/useFormErrorNotice.ts`（`summaryRef`＋`notify(summary)`）／`impl/frontend/src/components/ui/FormFooterError.tsx`（`show` で足元ヒント）。`FormSummary.tsx` に `innerRef` 追加。`Snackbar.tsx` は `duration<=0` を sticky として扱う（タイマー張らない・timer ゲージ非表示）。CSS `.form-footer-error`＝`design-system.css`。
- 適用フォーム＝`QuestForm`／`AccountFormPanel`／`CompanyCreateForm`／`QuestGroupSection`（作成・編集）／`IdeaForm`。

### 3-C. D／SC-21 アイデア登録・編集のフロント接続（`f479889`）
- 理由＝実装順で C 完了後の D フロント接続。backend の D API は前セッションで実装済み（`1b09773`）。
- `impl/frontend/src/features/ideas/api.ts`（新規）＝`listIdeas`/`getIdea`/`createIdea`/`updateIdea`/`publishIdea`/`deleteIdea`＋`IDEAS_CHANGED_EVENT`。型は生成 OpenAPI（`Idea*`）から。
- `impl/frontend/src/features/ideas/components/IdeaForm.tsx`＝デモ→接続版に**全面改稿**。作成＝投稿(status=published)／下書き保存(draft)、編集＝マウント時 `getIdea` プリフィル→`updateIdea`。§4.7 検証＋§13 loading（`pendingKind`）。投稿先クエスト文脈は `getQuest` で取得。利害関係者は `{label,is_custom}` で送信（候補外＝is_custom=true）。
- ルート伝播＝`app/(app)/@modal/(.)quests/[questId]/ideas/new/page.tsx`・`IdeaCreateModal.tsx`・`IdeaCreatePanel.tsx` に `questId` を渡す。`IdeaDetailView.tsx` の編集モーダルは `ideaId` を渡して**編集だけ実 API 接続**（詳細本体はデモのまま）。`ideas/index.ts` から旧 `IdeaInitial` 型 export を削除。

## 4. 現在の状態（動く / 壊れ / テスト）
### 4-1. frontend
- **tsc＝既知2件のみ**（本セッションで確認）＝`components/ui/Snackbar.tsx:122`（`useRef` 無引数の型指摘）・`features/shop/components/ShopView.tsx:98`（デモ）。今回の変更はクリーン。
- 再ビルド済み・起動中（`impl-frontend` Up）。**ただし SC-21 と §4.7 の実挙動はブラウザ/e2e で未検証＝受入ゲート未実施**（コンパイル＋ビルド成功まで）。
- 接続済み画面＝SC-00／SC-03,K／SC-10／SC-11／SC-12（クエスト詳細本体＝ヘッダ/概要/パーティー/遷移/削除）／SC-90/91/92/93／**SC-21（アイデア登録・編集フォーム）NEW**。
- まだデモ＝**SC-12 のアイデアタブ**（`QuestDetailView` 内 IDEAS 配列）／**SC-22 アイデア詳細の本体**（`IdeaDetailView` の fixtures＝投票/評価/チャット/履歴）。SC-01/02/24/25/30/31/32/40/41。

### 4-2. backend
- 登録ルータ＝auth / admin / me / quests / **ideas**。company migration head＝`0010_company_ideas`。
- D API＝6 EP のみ（`impl/backend/app/tenant/ideas/router.py`）＝`GET /quests/{id}/ideas`・`GET /ideas/{id}`・`POST /quests/{id}/ideas`(201)・`PATCH /ideas/{id}`・`POST /ideas/{id}/publish`・`DELETE /ideas/{id}`(204)。**添付/投票/フォローの EP は未実装**（repository には関数あり・router 未公開）。
- 検証エラーの field 名＝`_validate_publishable`（application.py）が `title`/`value`/`body`。publish/patch は strict、draft は loose。
- **backend は本セッションで変更なし**。pytest は**本セッション未実行＝未確認**。前回記録＝repository 12（D-TC-001〜012）green・API 実装コミット `1b09773` に `tests/ideas/test_api.py`（D-TC-101〜118）を含む（合計本数は再計していない）。

### 4-3. テスト
- 本セッションはテストコード追加なし（フロント接続のみ）。TC-ID トレーサビリティ検査（`scripts/check_tc_traceability.py`）は本セッション未実行だが、コード側 TC-ID を増やしていないので前回 ✅ のまま想定（要再確認）。
- e2e＝前回まで `sc-11-quest-create-modal`/`sc-12-quest-detail`/`sc-91-companies`(B-TC-161 カード複製回帰) が green。**D（アイデア）の e2e は未作成**。

## 5. 詰まっている点（試した/注意）
- **検証エラーのスクロール先 ref**＝初回エラーはサマリ要素が**まだ DOM に無い**（state 更新は非同期）ため `scrollIntoView` が効かない。→ `useFormErrorNotice` 内で `requestAnimationFrame` 後にスクロールして解決済み。
- **sticky スナックバー**＝`duration:0` で自動消滅しない実装にした。`Snackbar.tsx` の「その他N件」ゲージは残り時間最長の隠れ通知で減るロジックのため、sticky(dur=0) が隠れ枠に来た場合のゲージ計算はエッジ（実害小・未対処）。
- **添付アップロード**＝backend EP 未実装のため `IdeaForm` の添付 UI は**送信しない**（画面に「保存は準備中」注記を出してサイレント欠落を回避）。接続には multipart/MinIO の EP 追加が先。
- **backend テスト/red-green の cwd 罠**（重要・再発）＝`run --rm -T -v "$PWD/backend:/app" backend pytest ...` は **cwd=`impl` 前提**。`cd .../ideas` 等へ移ると `$PWD/backend` が消え bootstrap が `No module named 'scripts'` で落ちる。**必ず `cd /home/t-umekawa/sc-ideaquest-G2/impl`**。
- **frontend/backend/e2e はソース焼き込み**＝`up -d --build frontend`／`up -d --build backend worker mail-worker`。e2e spec は `docker compose cp <spec> frontend:/app/e2e/`。
- **impl 共通部品の型注意**＝`useConfirm` 本文は `msg`（`message` 不可）。`QuestIcon` は `@/components/layout`（`name/color/imageUrl/size`）。`RowMenu` は body へ portal 済み。`useSnackbar()` は `SnackOptions`（`type/title/msg/duration/...`・`duration:0`=sticky）。

## 6. 決定事項と根拠
- **§4.7 は「3チャネル併用」に確定（2026-08-23）**。ユーザー提案の「エラースナックバーのみ」も検討したが不採用＝スナックバーは一過性/全体通知で、検証エラーは**持続的・フィールド帰属**の情報のためミスマッチ。標準の error-summary パターン（スクロール＋足元ヒント）を主にし、スナックバーは成功トーストと対称の**補助＋自動消滅させない**運用で採用。§4.7 の no-focus-jump は維持（スクロールのみ）。
- **§13 使い分け**＝フォーム POST 押下の既定はボタン内スピナー。パネル全体再取得のみオーバーレイ。
- **SC-21 スコープを CRUD＋公開に限定**＝添付/投票/フォローは router 未実装のため後続。編集は SC-22 から `ideaId` 経由で実 PATCH に接続（詳細本体はデモ据え置き）＝write 経路だけ先に通す判断。
- （継続）会社プロビジョニングは MVP 手動（`POST /companies/{id}/provision`＝`d34cfb0`・SC-92「会社DB」セクション）。テスト運用＝md 先行＋TC-ID トレーサビリティ＋pre-commit。

## 7. 次にやること（優先順・具体的に）
1. **SC-21 受入ゲート（手動）＋ D e2e 作成**。手順＝(a) `doc/テスト/D_アイデア.md` に e2e TC 行（`根拠` 列付き・§5.2 md 先行）を追加 (b) `impl/frontend/e2e/` に spec 作成（投稿/下書き/編集＋§4.7 スクロール・スナックバー）(c) `python3 scripts/check_tc_traceability.py` で ✅。**md 無しでテストコードを書かない**。
2. **SC-12 アイデアタブの実接続**＝`impl/frontend/src/features/quests/components/QuestDetailView.tsx` のデモ `IDEAS` を `listIdeas(questId)`（`features/ideas/api.ts`）に差し替え＋`IDEAS_CHANGED_EVENT` を購読して投稿後に再取得。カード表示は `IdeaCardDTO`（`vote_summary`/`comment_count`/`my_vote`/`my_state`）に整合。
3. **SC-22 詳細の実接続**＝`impl/frontend/src/features/ideas/components/IdeaDetailView.tsx` の fixtures を `getIdea(ideaId)` に差し替え（本文/価値/利害関係者/ステータス/作成者/版数）。**投票・フォローは EP 未実装＝表示のみ**にする（ボタンは disabled か「準備中」明示・サイレント無効化にしない）。チャット導線は E 未接続。
4. **mock/style-guide の §4.7 反映**（正本 `デザイン標準.md` は更新済み・mock 側が未反映）＝`doc/画面設計/mocks/shared.css`（`.form-footer-error`）・`shared.js`（sticky スナックバー＝duration:0 相当）・`style-guide.html`「4b.」にスクロール追従/足元ヒント/エラースナックバーのサンプル追加。
5. **backend D 残り EP**＝添付アップロード（multipart・MinIO・`validate_image_upload` 流用）／投票（1人1票 upsert・集計）／フォロー（冪等）を `router.py` に公開（repository は実装済み）。公開時 chat_groups 作成（E 依存＝no-op か最小）・投稿 XP+50（G 依存＝no-op フック）。**md 先行**で `doc/テスト/D_アイデア.md` に TC 追加→red-green。
6. **（折衷）§4.7 の残存フォーム是正**＝認証系（`form-error` 単文字列）はスナックバー/足元ヒントは付けたが、フィールド別インライン化（`aria-invalid`＋`.field__error`）は未。SC-11/12 の受入ゲートも未実施。

## 8. 再開に必要な環境情報
- 作業ディレクトリ: `/home/t-umekawa/sc-ideaquest-G2`。compose＝`impl/compose.yaml`（絶対パス `-f /home/t-umekawa/sc-ideaquest-G2/impl/compose.yaml` 推奨）。
- **フルスタック起動**＝`docker compose -f impl/compose.yaml --profile workers up -d --build`。ポート＝frontend :3000／backend :8000(`/healthz`)／db :5432／redis :6379／minio :9000/:9001／mailhog :8025。**e2e は `--profile workers` 必須**。現在全サービス Up。
- **反映**＝frontend `up -d --build frontend`／backend `up -d --build backend worker mail-worker`。
- **frontend tsc**＝`docker compose -f impl/compose.yaml exec -T frontend npx tsc --noEmit`（または `cd impl/frontend && npx tsc --noEmit`）。既知2件は §4-1。
- **backend テスト**（cwd=`impl` 厳守）＝`cd /home/t-umekawa/sc-ideaquest-G2/impl && docker compose -f /home/t-umekawa/sc-ideaquest-G2/impl/compose.yaml run --rm -T -v "$PWD/backend:/app" backend pytest tests/ -q`。範囲＝`pytest tests/ideas -q`／`tests/quests -q`。
- **openapi 型再生成**（backend 再ビルド後）＝`docker compose -f impl/compose.yaml exec -T -e OPENAPI_URL=http://backend:8000/openapi.json frontend npm run codegen` → `docker compose -f impl/compose.yaml cp frontend:/app/src/lib/api/schema.d.ts /home/t-umekawa/sc-ideaquest-G2/impl/frontend/src/lib/api/schema.d.ts`。
- **e2e**＝(1)`exec -T -u root frontend npx playwright install-deps chromium`（再ビルド毎）(2)`exec -T frontend npx playwright install chromium`(3)`cp <spec> frontend:/app/e2e/`(4)`exec -T redis redis-cli FLUSHALL`(5)`exec -T frontend npx playwright test e2e/<spec> --workers=1 --reporter=line`。**1ファイルずつ**。
- **TC-ID 検査**＝`python3 scripts/check_tc_traceability.py`（`--list` で一覧）。pre-commit 有効化＝各端末で `pip install pre-commit && pre-commit install`（README・`.git/hooks` は共有されない）。
- **会社DB 作成/有効化（手動）**＝SC-92「会社DB」セクションの「会社DBを作成して有効化」ボタン（`POST /companies/{id}/provision`・冪等）／または `docker compose exec backend python -m scripts.bootstrap`→`psql ... UPDATE companies SET status='active'`。詳細＝ルート `README.md`。
- **dev ログイン（PW 全て `Passw0rd!`）**＝system_admin `OPS`/`admin@ops.example`／一般 `ACME-01`/`user@acme.example`(MFA OFF・「テスト 太郎」・デモグループ所属)・`ACME-02`/`mfa@acme2.example`(MFA ON)。手動追加＝`SYSCON`/`t-umekawa`(active)。MailHog＝`http://localhost:8025`。
- 規約/正本＝`CLAUDE.md`（各種規約＋設計の正本のパス参照）。UI 標準＝`doc/画面設計/デザイン標準.md`＋見本 `doc/画面設計/mocks/style-guide.html`。API＝`doc/API設計/{A..L}_*.md`＋`README.md`。データモデル＝`doc/データモデル.md`。テスト＝`doc/テスト/*.md`。
