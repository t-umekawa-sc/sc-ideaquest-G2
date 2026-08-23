# handoff — ideaquest 開発引き継ぎ

> 読者＝「このセッションの記憶が無い次回の自分」。会話ログは参照不可。本ファイルだけで再開できるよう全文を上書きする（履歴は git）。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: **2026-08-23**（時刻は概算・セッション終了時）。
- ブランチ: `main`（作業ツリーはクリーン＝本ファイル更新のコミット前を除き未コミットなし）。
- 最新コミット: **`69f88a8`** `docs(ADR-0009): 管理者によるメールアドレス確認`。
- 本セッションの追加コミット（新しい順）: `69f88a8`（ADR-0009 メール確認 設計）／`c687543`（RowMenu 上フリップ境界を最終行まで拡張）／`11b50d6`（handoff 全文更新）／`483685f`（SC-21 D e2e）／`c5bdd4a`（複製を SC-93/SC-10 へ）／`9591413`（RowMenu footer 重なり修正）。**すべて push 済み**（origin/main = `69f88a8`）。

## 2. ゴール
社内向けアイデア創出ゲーミフィケーション型マルチテナント SaaS「ideaquest」。フロント＝Next.js App Router、バック＝FastAPI 4層、DB＝PostgreSQL/Redis/MinIO/MailHog/Docker。開発は**1画面単位で backend 接続ループ**（各画面でユーザー受入ゲート）。実装順＝アカウント→クエスト(C)→アイデア(D)→評価→その他。正本＝[`doc/実装計画.md`](doc/実装計画.md)。

## 3. 今回やったこと（変更ファイルと理由）
### 3-A. SC-21 受入＝アイデア登録・編集の画面 e2e（`483685f`）
- 前セッションで D/SC-21 をフロント接続済み（`f479889`）だが**受入ゲート未実施**だったため、画面 e2e を追加＋ブラウザ受入。
- 新規＝`impl/frontend/e2e/sc-21-idea-form.spec.ts`（D-TC-201 即公開作成→一覧反映／D-TC-202 下書き保存→本人可視／D-TC-203 編集で件名更新→API反映／D-TC-204 §4.7 前段ガード＝3必須が揃うまで投稿ボタン無効＋件名 blur インライン検証）。**4 passed**。
- md 先行＝`doc/テスト/D_アイデア.md` に **§3 画面 e2e** を追記（根拠列付き）。red-green＝主アサーション一時反転で behavior-red 目視→green、証跡＝`doc/テスト/red確認台帳.md` の「D. アイデア 画面 e2e」。TC-ID トレーサビリティ ✅（code 283）。
- **重要な設計事実**＝**§4.7 の3チャネル（上部サマリ scroll＋足元ヒント＋sticky スナックバー）は SC-21 では主経路で到達不能**。主ボタン「投稿する／変更を保存」が `disabled={!canSave}` で client `validate()` と同条件＝client 検証エラーが出ない（下書き保存は検証スキップ）。3チャネルが出るのは**サーバエラー（完了クエスト編集の 409・公開状態機械の 409 等）経由のみ**＝後続 TC（サーバエラー seed が必要）。D-TC-204 は前段ガード（活性・blur）を担保。
- ブラウザ受入（スクショ確認済み）＝登録フォーム（投稿先クエスト文脈カード＋3必須＋任意＋添付「保存は準備中」注記）／投稿後の成功トースト「アイデアを投稿しました・+50 XP」／編集モーダルが実 `getIdea` で件名・価値・本文をプリフィル（詳細本体はデモのまま・編集経路だけ実接続）。

### 3-B. 行アクション ⋯ メニューが DataTable footer と重なる不具合の修正（`9591413`）
- 理由＝ユーザー指摘。行が少ない一覧（例 `/admin/accounts` 2行）で最終行の ⋯ を下に開くと、件数/ページャ/表示件数の footer と視覚的に重なる（メニューは solid 白・z-1000 で透けはしないが右端の「表示 N 件」が衝突）。
- 修正＝`components/ui/RowMenu.tsx`＝`footerBoundary(trigger)` で同一 DataTable（`[data-dt-root]`）の `.dt-footer` 上端を検出し、下方向の配置境界を `min(ビューポート下端, footer上端)` に。下に収まらなければ**上フリップ**。`components/ui/DataTable.tsx`＝root `<div>` に `data-dt-root` 付与。DataTable 外の RowMenu（クエスト詳細の操作メニュー）は境界なし＝従来どおり。
- 検証＝ブラウザ実測で `overlaps footer: false`（メニューが上フリップ）。回帰 e2e＝`sc-93-own-accounts` 4／`sc-91-companies` 9 green。

### 3-C. 「複製」アクションの監査＋取りこぼし追加（`c5bdd4a`）
- 理由＝ユーザー指摘「一覧のアクションメニューに複製が無い／実装済み全一覧を見直せ」。デザイン標準 §4.5 複製（登録ダイアログを追加モードで開き選択行を引き継ぐ）。
- **SC-93 自社アカウント（`AccountSelfSection`）**＝兄弟 SC-92（`AccountSection`）にはあったが取りこぼし→「複製」追加（表示名を引き継ぐ・ログインID/メールは一意キーで除外・system_role は general 固定で引き継がない）。
- **SC-10 クエスト一覧（`QuestListView`）**＝リスト表示は操作列、カード表示はカード右下に ⋯ を重ねる（`<Link>` の兄弟に置き button-in-anchor 回避）。`QuestForm` を `dup` プリフィル対応（件名/カラー/カテゴリー/グループを引き継ぎ、id・ステータス→下書き・アイコン・パーティー・目的〔一覧DTOに無い〕は除外）。
- **複製が明らかに不要（対象外）**＝QGメンバー一覧（`QuestGroupAdminView`）・クエスト詳細のパーティー（人の関係データ）／クエスト詳細の操作メニュー（単一クエスト）／クエスト詳細のアイデアタブ（未接続デモ）。**既に複製あり**＝会社一覧・SC-92 会社別アカウント・QGグループ。

### 3-D. RowMenu 上フリップ境界を最終データ行まで拡張（`c687543`）
- 理由＝ユーザー再指摘。行が多い一覧（/admin/companies）で末尾付近の行の ⋯ を下に開くと**最終データ行を覆う**（footer だけの前修正では未対応）。
- 修正＝`downBoundary(trigger)` が「最終 `td.col-actions` の行の上端」と footer 上端の小さい方を返し、そこを超えるなら上フリップ。末尾付近の行は上方向に開き最終行/footer を覆わない。ブラウザ実測で下行 ⋯ との矩形重なり false。

### 3-E. メール確認フロー＝設計を正本へ起こした（`69f88a8`・ADR-0009・実装は未）
- 発見＝**自己メール変更（K.3・ADR-0008）は既にダブルオプトインで確認済み**。ギャップは管理者経路（B PATCH）だけ。
- 決定（ユーザー承認）＝**(A) 現アドレスの確認方式**＝編集は no-block 維持＋opt-in「確認メール送信」で現メール到達/所有確認→`accounts.email_verified_at` に記録。`otp_challenges` に新 `purpose=email_verify`（72h・単回）・確定 EP は未認証。`email_change`（変更）と `email_verify`（確認）は purpose 分離。
- 正本追記＝ADR-0009 新規／データモデル（`email_verified_at`・`otp_purpose`・`mail_category`）／API B（送信 EP・`GET` 行に `email_verified`・PATCH で NULL リセット）／API A（`POST /auth/email-verify/confirm`・A.7.1）／API K（K.3 confirm も `email_verified_at=now`）／SC-92・SC-93（バッジ＋⋯「確認メールを送信」）。**実装は別スライス（md 先行→red-green）**。

## 4. 現在の状態（動く / 壊れ / テスト）
### 4-1. frontend
- **tsc＝既知2件のみ**（本セッション確認）＝`components/ui/Snackbar.tsx:122`・`features/shop/components/ShopView.tsx:98`（いずれもデモ/既存）。今回の変更はクリーン。
- 再ビルド済み・起動中。接続済み画面＝SC-00／SC-03,K／SC-10（＋複製）／SC-11／SC-12（詳細本体）／SC-21（登録・編集・**受入済み**）／SC-90/91/92/93（SC-93 に複製追加）。
- まだデモ＝**SC-12 アイデアタブ**（`QuestDetailView` 内 IDEAS 配列）／**SC-22 アイデア詳細の本体**（`IdeaDetailView` の fixtures＝投票/評価/チャット/履歴・編集経路のみ実接続）。SC-01/02/24/25/30/31/32/40/41。
### 4-2. backend
- 登録ルータ＝auth / admin / me / quests / ideas。D API＝6 EP（一覧/詳細/作成/編集/公開/削除）。**添付/投票/フォローの EP は未実装**（repository には関数あり・router 未公開）。**本セッションで backend 変更なし**。
- pytest＝本セッション実行＝`tests/ideas tests/quests` **78 passed**（healthz ok）。
### 4-3. テスト
- 追加＝画面 e2e `sc-21-idea-form.spec.ts`（D-TC-201〜204・4 passed）。TC-ID トレーサビリティ ✅（code 283）。回帰＝sc-93(4)/sc-91(9) green。
- e2e＝`sc-11`/`sc-12`/`sc-91`/`sc-93` 等が green。**D の e2e は SC-21 分を新規追加済み**。SC-12/22 の e2e は未（未接続のため）。

## 5. 詰まっている点（試した/注意）
- **§4.7 3チャネルは SC-21 では未到達**（§3-A 参照）。サーバエラー経由 TC が必要＝後続。
- **RowMenu の footer 境界**＝`[data-dt-root]` マーカー＋`.dt-footer` 検出に依存。DataTable の root `<div>` に `data-dt-root` が無いと従来動作（ビューポートのみ）に戻る。DataTable 外利用は境界なしで正常。
- **メール確認は現行仕様に無い**（§3-D）。実装は要件/API B・K/データモデルへの追記が先（設計先行）。
- **backend テスト/red-green の cwd 罠**（再発）＝`run --rm -T -v "$PWD/backend:/app" backend pytest ...` は **cwd=`impl` 前提**。**必ず `cd /home/t-umekawa/sc-ideaquest-G2/impl`**。
- **焼き込み反映**＝frontend `up -d --build frontend`／backend `up -d --build backend worker mail-worker`。e2e spec は `docker compose cp <spec> frontend:/app/e2e/`。
- **impl 共通部品**＝`useConfirm` 本文は `msg`。`QuestIcon` は `@/components/layout`。`RowMenu` は body へ portal・stopPropagation でカード誤遷移防止。`useSnackbar()` は `duration:0`=sticky。複製は `buildDuplicateHref`（`lib/forms/duplicate.ts`）＋作成フォームが `readDuplicatePrefill(searchParams)` で読む（accounts/quests/companies が採用）。

## 6. 決定事項と根拠
- **複製は「登録系一覧」にのみ付ける**＝人の関係データ（メンバー/パーティー）や単一レコードの操作メニューには付けない（§3-C の対象外リスト）。
- **RowMenu は footer と重ならないよう上フリップ**（§3-B）＝dropdown が同一 DataTable の footer chrome を隠さないようにする判断。
- **SC-21 の §4.7 は前段ガードで担保**＝主ボタン活性ガードにより client 検証エラー経路が無いため、3チャネル e2e はサーバエラー seed の後続 TC に回す（§3-A）。
- **メール確認は opt-in アクション方式で追加する方針**（§3-D・実装は設計先行後）。
- （継続）会社プロビジョニングは MVP 手動（`POST /companies/{id}/provision`・SC-92）。テスト運用＝md 先行＋TC-ID トレーサビリティ＋red確認台帳。

## 7. 次にやること（優先順・具体的に）
1. **メール確認フローの実装**（設計は `69f88a8`/ADR-0009 で確定済み・§3-E）＝**md 先行→red-green**。(a) backend migration＝`accounts.email_verified_at` 追加 (b) 送信 EP `POST /admin/(companies/{cid}/)accounts/{id}/email-verification`（`purpose=email_verify`・72h・現メール宛・`mail_category=email_verify_link`） (c) 公開確定 EP `POST /auth/email-verify/confirm`（未認証・410/409・`email_verified_at=now`） (d) `GET .../accounts` の行に `email_verified` (e) `PATCH email` 変更で `email_verified_at=NULL`（＋K.3 confirm で now） (f) フロント＝SC-92/93 の一覧メール列バッジ＋⋯「確認メールを送信」。**添付/投票/フォロー（D 残り EP）とどちらを先にするかは要判断**。
2. **SC-12 アイデアタブの実接続**＝`QuestDetailView` のデモ `IDEAS` を `listIdeas(questId)`（`features/ideas/api.ts`）へ差し替え＋`IDEAS_CHANGED_EVENT` 購読で投稿後再取得。カードは `IdeaCardDTO`（`vote_summary`/`comment_count`/`my_vote`/`my_state`）に整合。
3. **SC-22 詳細の実接続**＝`IdeaDetailView` の fixtures を `getIdea(ideaId)` へ。**投票・フォローは EP 未実装＝表示のみ**（disabled か「準備中」明示）。チャット導線は E 未接続。
4. **mock/style-guide の §4.7 反映**（正本 `デザイン標準.md` は更新済み・mock 側未反映）＝`mocks/shared.css`（`.form-footer-error`）・`shared.js`（sticky スナックバー）・`style-guide.html`「4b.」。
5. **backend D 残り EP**＝添付アップロード（multipart・MinIO・`validate_image_upload` 流用）／投票（1人1票 upsert・集計）／フォロー（冪等）を `router.py` に公開（repository 実装済み）。公開時 chat_groups（E 依存 no-op）・投稿 XP+50（G 依存 no-op）。**md 先行**→red-green。
6. **（折衷）§4.7 サーバエラー経由 TC**＝SC-21 の3チャネルを完了クエスト編集 409 等で発火させる e2e（seed が必要）。認証系フォームのフィールド別インライン化も未。

## 8. 再開に必要な環境情報
- 作業ディレクトリ: `/home/t-umekawa/sc-ideaquest-G2`。compose＝`-f /home/t-umekawa/sc-ideaquest-G2/impl/compose.yaml`。
- **フルスタック起動**＝`docker compose -f impl/compose.yaml --profile workers up -d --build`。ポート＝frontend :3000／backend :8000(`/healthz`)／db :5432／redis :6379／minio :9000/:9001／mailhog :8025。**e2e は `--profile workers` 必須**。
- **反映**＝frontend `up -d --build frontend`／backend `up -d --build backend worker mail-worker`。
- **frontend tsc**＝`cd impl/frontend && npx tsc --noEmit`（既知2件は §4-1）。
- **backend テスト**（cwd=`impl` 厳守）＝`cd /home/t-umekawa/sc-ideaquest-G2/impl && docker compose -f /home/t-umekawa/sc-ideaquest-G2/impl/compose.yaml run --rm -T -v "$PWD/backend:/app" backend pytest tests/ -q`。範囲＝`tests/ideas`／`tests/quests`。
- **e2e**＝(1)`exec -T -u root frontend npx playwright install-deps chromium`（再ビルド毎）(2)`exec -T frontend npx playwright install chromium`(3)`cp <spec> frontend:/app/e2e/`(4)`exec -T redis redis-cli FLUSHALL`(5)`exec -T frontend npx playwright test e2e/<spec> --workers=1 --reporter=line`。**1ファイルずつ**。診断用の使い捨て spec は e2e/ に置いて実行後**必ず削除**（ローカル＋コンテナ両方）。
- **TC-ID 検査**＝`python3 scripts/check_tc_traceability.py`（`--list` で一覧）。
- **openapi 型再生成**（backend 再ビルド後）＝`exec -T -e OPENAPI_URL=http://backend:8000/openapi.json frontend npm run codegen` → `cp frontend:/app/src/lib/api/schema.d.ts impl/frontend/src/lib/api/schema.d.ts`。
- **dev ログイン（PW 全て `Passw0rd!`）**＝system_admin `OPS`/`admin@ops.example`／一般 `ACME-01`/`user@acme.example`(MFA OFF・「テスト 太郎」・デモグループ所属)・`ACME-02`/`mfa@acme2.example`(MFA ON)。手動追加＝`SYSCON`/`t-umekawa`(system_admin)。MailHog＝`http://localhost:8025`。
- 規約/正本＝`CLAUDE.md`（各種規約＋設計の正本のパス参照）。UI 標準＝`doc/画面設計/デザイン標準.md`＋見本 `doc/画面設計/mocks/style-guide.html`。API＝`doc/API設計/{A..L}_*.md`＋`README.md`。データモデル＝`doc/データモデル.md`。テスト＝`doc/テスト/*.md`＋`red確認台帳.md`。
