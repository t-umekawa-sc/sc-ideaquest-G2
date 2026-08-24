# handoff — ideaquest 開発引き継ぎ

> 読者＝「このセッションの記憶が無い次回の自分」。会話ログは参照不可。本ファイルだけで再開できるよう全文を上書きする（履歴は git）。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: **2026-08-24**（セッション終了時・時刻は概算）。
- ブランチ: `main`。**作業ツリーはクリーン**（未コミットなし）。
- 最新コミット: **`5cc05e8`** `fix(B/B.5.1): last_system_admin 保護を OPS テナントスコープに限定`。**origin/main と同期済み（push 済み）**。
- 本セッションの主なコミット（新しい順）: `5cc05e8`(last_system_admin OPS スコープ修正)／`1d20184`(メール確認 frontend)／`766cb20`(メール確認 backend)／`6f4dcc2`(mock §4.7/§14 反映)／`f2c8119`(添付 D.3)／`03ec931`(IdeaDetailDTO に quest 参照)／`8ed4d02`(idea_count 連動)／`4ae948f`(投票/フォロー フロント接続)／`57f8b1d`(impl/README.md 新設＋追随更新規約化)。

## 2. ゴール
社内向けアイデア創出ゲーミフィケーション型マルチテナント SaaS「ideaquest」。フロント＝Next.js App Router（dev モード起動）、バック＝FastAPI 4層、DB＝PostgreSQL/Redis/MinIO/MailHog/Docker。開発は**1画面単位で backend 接続ループ**（各画面でユーザー受入ゲート）。実装順の正本＝[`doc/実装計画.md`](doc/実装計画.md)＝アカウント→クエスト(C)→**アイデア(D)**→評価(F)→その他。

## 3. 今回やったこと（変更ファイルと理由）

### 3-0. 進捗スナップショットの正を新設（`57f8b1d`）
- **`impl/README.md` を「実装現況（画面別/EP別の済・未）の正」として新設**＝画面進捗テーブル・backend API 進捗・既知課題・起動/テスト手順。**進捗が進むたび追随更新**する運用を規約化（[`doc/規約/フロントエンド実装フロー規約.md`](doc/規約/フロントエンド実装フロー規約.md) **§1.2 新設**・§1.1-5 に更新トリガー組込）。役割分担＝**計画順=実装計画.md／現況=impl/README.md／経緯・次アクション=handoff.md**。`doc/実装計画.md` §0/§4 は現況を impl/README.md へ委譲（重複回避）。`CLAUDE.md` 設計の正本節に impl/README.md ポインタ追加。

### 3-A. D 投票・フォローのフロント接続（`4ae948f`）
- `impl/frontend/src/features/ideas/api.ts` に `voteIdea`/`removeVote`/`followIdea`/`unfollowIdea` を追加。`impl/frontend/src/features/ideas/components/IdeaDetailView.tsx` の投票（賛成/反対/切替/**同ボタン再クリックで取消**）とフォロー★トグルを実接続＝**楽観更新＋サーバー権威**（409/403/404 でロールバック＋理由トースト）。e2e＝`sc-22-vote-follow.spec.ts`（D-TC-209〜212）。D-TC-207（`sc-22-idea-detail.spec.ts`）は「ボタン活性」へ更新。

### 3-B. idea_count を公開アイデア数に連動（`8ed4d02`）
- クエストDTO の `idea_count` が 0 固定だった不整合を解消。`impl/backend/app/tenant/ideas/repository.py` に `count_published_ideas_for_quests`（batch・N+1回避）追加、`impl/backend/app/tenant/quests/application.py` の一覧カード/詳細 DTO で連動。**定義＝公開(published)・未削除のみ**（下書きは作成者のみ可視で数えると存在漏れ・`sort=-idea_count` も安定）＝`doc/API設計/C_クエスト・パーティー・権限.md` に明記。フロントは既に表示（変更不要）。api テスト C-TC-143/144。

### 3-C. IdeaDetailDTO に quest 参照追加（`03ec931`）
- `impl/backend/app/tenant/ideas/schemas.py` に `IdeaQuestRefDTO`（id/title/status/categories/deadline）、`IdeaDetailDTO.quest` を必須公開。`_build_detail`（`app/tenant/ideas/application.py`）で合成。フロント SC-22＝「クエストへ戻る」を実導線化・カテゴリーバッジ・**completed 凍結の事前無効化**（投票/新規フォロー disabled＋⏸バッジ）。締切(時刻)超過はサーバー 409 を権威に維持。api D-TC-130／e2e `sc-22-quest-ref.spec.ts`（D-TC-213/214）。

### 3-D. 添付ファイル D.3（`f2c8119`）
- `impl/backend/app/infra/storage.py` に添付 allowlist（画像/pdf/Office/txt/csv/md/zip）・20MB・`validate_attachment_upload`（**申告 Content-Type を信用せず拡張子から MIME 導出**）・`hashed_key` 汎用化。EP 3本（`app/tenant/ideas/router.py`）＝`POST /ideas/{id}/attachments`（複数・編集権限・完了409・10件上限）／`DELETE .../{aid}`（DB＋MinIO）／`GET /attachments/{aid}/download`（パーティー所属→短TTL署名URL）。`IdeaDetailDTO.attachments` 追加。フロント＝`features/ideas/api.ts`（`uploadAttachments`/`deleteAttachment`/`getAttachmentDownloadUrl`）／SC-22 で実添付表示＋DL（0件非表示・§4.3）／SC-21 `IdeaForm.tsx` で**保存成功後にアップロード**（id 先行）。api D-TC-131〜137／e2e `sc-22-attachments.spec.ts`（D-TC-215）。

### 3-E. mock/style-guide に §4.7・§14 反映（`6f4dcc2`）
- 正本は更新済みで mock 未反映だった2点を追随。`doc/画面設計/mocks/shared.js` の `iqSnack` が **`duration:0`（自動消滅させない・✕のみ）** を honor するよう修正（従来 0 が握り潰されていた）。`shared.css` に足元ヒント `.form-footer-error` 追加。`style-guide.html`「4b.」に §4.7 の3チャネル（上部サマリへスクロール＋足元ヒント＋エラースナックバー duration:0）を実演。「14b.」にセッション終了通知（session_expired/logged_out の固定文言・reason enum マップ）追加。デザイン標準 §14 に mock サンプル参照追記。

### 3-F. 管理者によるメールアドレス確認 ADR-0009（backend `766cb20`／frontend `1d20184`）
- migration `impl/backend/migrations/control/versions/0011_accounts_email_verified_at.py`＝`accounts.email_verified_at`＋`otp_challenges.target_email` 追加。ORM/config＝`email_verify` purpose・`email_verify_ttl_seconds`(72h)・mail category `email_verify_link`（`app/control_plane/mail_outbox/templates.py`）。repo helper（`app/control_plane/auth/repository.py`）＝invalidate/create/find email_verify challenges。
- 送信 EP（`app/control_plane/admin/router.py`・`application.py send_email_verification`）＝B.2(system_admin)/B.2.1(company_admin) の2系統・現メール宛に確認リンク（単回・旧失効・現メールを target_email に束ねる）・202。確定 EP（`app/control_plane/auth/router.py`・`application.py confirm_email_verify`）＝`POST /auth/email-verify/confirm`・未認証（Origin のみ）・`email_verified_at=now`／410（無効/期限/使用済）／**409 stale**（送信後 email 変更・target_email≠現email）。`PATCH email` 変更で `email_verified_at=NULL`（`admin/application.py edit_account`）・自己変更確定でも now を刻む（`me/application.py confirm_email_change`）。一覧/状態 DTO に `email_verified`。
- フロント＝`features/accounts/api.ts`（`sendEmailVerification`/`sendOwnEmailVerification`/`confirmEmailVerify`）／SC-92 `AccountSection.tsx`・SC-93 `AccountSelfSection.tsx` にメール列バッジ（未確認/確認済み）＋⋯「確認メールを送信」／`app/(auth)/email-verify/confirm/page.tsx`＋`features/accounts/components/EmailVerifyConfirm.tsx`（明示ボタンで確定・410/409 分岐）。api B-TC-165〜168・A-TC-103〜106／e2e `sc-92d-email-verify.spec.ts`（B-TC-169）。

### 3-G. last_system_admin 保護を OPS スコープに修正（`5cc05e8`・**セッション中に発見した既存バグ**）
- `impl/backend/app/control_plane/admin/application.py` の `_active_system_admin_count` が**全社横断**で数えていた抜けを修正＝**OPS 会社内**（予約コード `ops_company_code` で識別・新ヘルパ `_ops_company_id`）の active system_admin のみ。`disable_account`/`edit_account` のガードも「対象が OPS 会社の system_admin」に限定（非 OPS の system_admin 無効化を誤ブロックしない）。api B-TC-170。詳細は §5・§6。

## 4. 現在の状態（動く / 壊れ / テスト）
### 4-1. frontend（tsc・e2e）
- **tsc＝既知2件のみ**（本セッション複数回確認）＝`impl/frontend/src/components/ui/Snackbar.tsx:122`・`impl/frontend/src/features/shop/components/ShopView.tsx:98`（いずれもデモ/既存）。今回の変更はクリーン。
- **接続済み画面**＝SC-00／SC-03,K／SC-10（idea_count 連動）／SC-11／SC-12（アイデアタブ＋ヘッダー idea_count）／SC-21（登録・編集・**添付アップロード**）／SC-22（本体＋**投票/フォロー/添付/quest参照/completed事前無効化**）／SC-90/91／SC-92,93（**メール確認バッジ＋送信**）。
- **まだ表示のみ/デモ**＝SC-22 の評価(F)/チャット(E)/版差分(D.4)／SC-12 の評価列(F)/週間ランキング(G)/全文検索(J)／SC-01(一部)/02/24/25/30/31/32/40/41。
- **e2e（本セッションで green 確認）**＝`sc-22-vote-follow`(4)／`sc-22-quest-ref`(2)／`sc-22-attachments`(1)／`sc-22-idea-detail`(1)／`sc-21-idea-form`(5)／`sc-92b-accounts`／`sc-93-own-accounts`／`sc-92d-email-verify`(1)。**注＝dev の `next dev` はコールドコンパイルで各 spec の最初の login が稀にタイムアウト→ウォームで再実行すれば green**（本セッションで複数回観測）。
### 4-2. backend（pytest）
- 登録ルータ＝auth / admin / me（control_plane）・quests / ideas（tenant）。**D API＝13 EP**（一覧/詳細/作成/編集/公開/削除＋投票 POST/DELETE・フォロー POST/DELETE＋**添付 POST/DELETE・DL**）。版差分 GET(D.4) は未実装。
- **本セッション末に `pytest tests/`（backend 全体）＝332 passed（0 failed）を確認**（下記 §5 の OPS スコープ修正後・`t-umekawa` を active のままで）。以前は `test_b_tc_028` が OPS を無効化して連鎖失敗していたが根治済み。
### 4-3. テスト運用
- **TC-ID トレーサビリティ ✅（code 318・本セッション末に確認）**。red-green は `doc/テスト/red確認台帳.md` に本セッション分を追記（投票/フォロー・idea_count・quest参照・添付・メール確認・OPS スコープ）。**新規 EP は test-first／後追い・ガード確認は反転手技を台帳へ**（テスト規約 §5.1）。

## 5. 詰まっている点（試した/注意）
- **backend api テストは共有 control DB（`ideaquest_control`）を使う**＝dev の永続 DB。ここに**手動追加の `t-umekawa`（非 OPS 会社の active system_admin）が居る**。これが last_system_admin 保護の全社横断カウントと噛み合い、`test_b_tc_028`（OPS 管理者 disable→422 期待）が **200 になり OPS を無効化→以後の admin/auth 系テストが OPS ログイン 401 で連鎖失敗**する現象を引き起こしていた。→ §3-G の OPS スコープ修正で**根治**（`t-umekawa` active のままで 332 passed）。**もし再びこの汚染に遭遇したら**＝`docker compose -f impl/compose.yaml exec -T db sh -lc 'psql -U "$POSTGRES_USER" -d ideaquest_control -c "update accounts set status='"'"'active'"'"' where login_id='"'"'admin@ops.example'"'"';"'` で OPS を復元。
- **`test_a_tc_095_independent_processing`（tests/mail_outbox）は既存フラキー**＝`tests/` 全体実行時の順序/タイミング依存で稀に落ちるが**単独では green**。本セッションの変更とは無関係。
- **frontend はソース非マウント**（`impl/compose.yaml` に volume マウント無し）＝コード反映には `up -d --build frontend` が必須。逆にこれは**接続前バンドルで e2e の red を目視**するのに好都合（本セッションの red-green は全てこの方式）。
- **backend ソースは pytest 時にマウント**（`run --rm -T -v "$PWD/backend:/app"`）＝test は再ビルド不要。ただし**実アプリ/openapi へ反映するには `up -d --build backend` が必要**。
- **backend テスト/red-green の cwd 罠**＝`run --rm -T -v "$PWD/backend:/app"` は **cwd=`impl` 前提**。別ディレクトリだと `$PWD/backend` が消える。**必ず `cd /home/t-umekawa/sc-ideaquest-G2/impl`**。

## 6. 決定事項と根拠
- **OPS は固定運用**（ユーザー確認 2026-08-24）＝OPS 会社は予約コード `ops_company_code`（config・既定 "OPS"）で識別し、デプロイ寿命の間固定。「is_ops フラグ新設（案B）」は不採用＝(a) 再起動なしで OPS を切替える運用要件が無い、(b) 案B は SoT 二重化＋is_ops を bootstrap/migration 限定にする security 手当てが要る。**採用＝案A（予約コードで OPS スコープ化・migration/フラグ不要）**。last_system_admin 保護の対象は B.5.1 どおり**OPS テナント内**（`disable_account` docstring と一致）。
- **idea_count＝公開・未削除のみ**（下書きは数えない）＝他人下書きの存在漏れ防止＋`sort=-idea_count` の閲覧者非依存の安定。自分の下書きがあるクエストではタブ件数がヘッダーを上回りうる（仕様・C API設計に明記）。
- **添付の MIME 判定＝拡張子から正規 MIME を導出**（申告 Content-Type 非信用）。完全な magic-byte スニッフィングは follow-up（D.8）。**削除 UI は SC-22 に置かない**（§4.3＝一覧＋DL のみ）＝削除は SC-21 フォームの×／api（D-TC-134）で担保。
- **メール確認（ADR-0009）**＝`email_change`(ADR-0008・変更) と `email_verify`(確認) は purpose 分離。確定の副作用は `email_verified_at` 更新のみ（identity 書換なし）。送信時 email を `otp_challenges.target_email` に束ね、confirm で現 email と照合＝不一致は 409 stale（`email_verified_at` は変えずやり直し）。**MVP は情報提供のみ・未確認でも通知/リンクは止めない**（発行直後は必ず未確認のため）。
- **snackbar `duration:0`＝自動消滅させない**（§4.7 の持続エラー・§14）。impl（`components/ui/Snackbar`）は既に対応、mock 側を今回追随。
- （継続）テスト運用＝md 先行＋TC-ID トレーサビリティ＋red確認台帳。会社プロビジョニングは MVP 手動。

## 7. 次にやること（優先順・具体的に）
1. **§7-7 §4.7 サーバエラー経由 TC**＝SC-21 の3チャネル（上部サマリ scroll＋足元ヒント＋エラースナックバー）は主ボタンが `disabled={!canSave}` で client 検証エラーが出ず主経路で到達不能。**サーバエラー（完了クエスト編集の 409・公開状態機械の 409 等）で発火させる e2e**が必要（seed が要る）。対象＝`impl/frontend/src/features/ideas/components/IdeaForm.tsx` の `persist()` の catch（`mapServerErrors`→`notify`）。md 先行で `doc/テスト/D_アイデア.md` に TC 追加→red-green。
2. **D 版差分 GET（D.4）**＝`impl/backend/app/tenant/ideas/router.py` に版一覧/差分 EP（`idea_revisions` は publish/edit で記録済み）。SC-22 `IdeaDetailView.tsx` の更新履歴モーダル（現在デモ）を実接続。md 先行→red-green。
3. **SC-21 編集モードの既存添付 管理 UI**＝現状は新規アップロードのみ接続。編集時に `getIdea` の `attachments` を `IdeaForm` に読み込み、既存添付の一覧＋削除（`deleteAttachment`）を出す（backend の DELETE EP は実装済み）。
4. **評価 F（SC-25）／チャット E（SC-24）**＝実装計画フェーズ4/5。`doc/API設計/F_*.md`・`E_*.md`＋`doc/画面設計/screens/SC-25,SC-24`。着手は依存（C/D 済み）を満たすため可能。
5. **メール確認の実機受入（後回し可）**＝SC-92/93 で「確認メールを送信」→MailHog（`http://localhost:8025`）で確認リンクを開き `/email-verify/confirm` の確定（verified バッジ化）を通しで確認。**backend api（B-TC-165〜168/A-TC-103〜106）は green だが、ブラウザ通しの受入は未実施**。
6. **`idea_count`/添付等の受入**＝本セッションの D 系フロント接続はいずれも e2e green だが**ユーザーのブラウザ受入は後追い**（受入ゲート §1.1-4）。

## 8. 再開に必要な環境情報
- 作業ディレクトリ: `/home/t-umekawa/sc-ideaquest-G2`。compose＝`impl/compose.yaml`。
- **フルスタック起動**＝`docker compose -f impl/compose.yaml --profile workers up -d --build`。ポート＝frontend :3000／backend :8000(`/healthz`)／db :5432／redis :6379／minio :9000/:9001／mailhog :8025。**e2e は `--profile workers` 必須**。セッション終了時点で**全サービス Up**。
- **反映**＝frontend `up -d --build frontend`／backend `up -d --build backend worker mail-worker`。**frontend 再ビルド後は playwright を再インストール**（`exec -T -u root frontend npx playwright install-deps chromium` ＋ `exec -T frontend npx playwright install chromium`）。
- **frontend tsc**＝`cd impl/frontend && npx tsc --noEmit`（既知2件は §4-1）。
- **backend テスト**（cwd=`impl` 厳守）＝`cd /home/t-umekawa/sc-ideaquest-G2/impl && docker compose -f "$PWD/compose.yaml" run --rm -T -v "$PWD/backend:/app" backend pytest tests/ -q`。範囲を絞るなら `tests/ideas` `tests/quests` `tests/admin` `tests/auth` 等。
- **e2e**＝(1)deps/browser 再インストール（上記）(2)`CID=$(docker compose -f impl/compose.yaml ps -q frontend); docker cp <spec> "$CID":/app/e2e/`(3)`docker compose -f impl/compose.yaml exec -T redis redis-cli FLUSHALL`(4)`exec -T frontend npx playwright test e2e/<spec> --workers=1 --reporter=line`。**1ファイルずつ・login コールドコンパイルで初回落ちたらウォームで再実行**。
- **openapi 型再生成**（backend 再ビルド後）＝`exec -T -e OPENAPI_URL=http://backend:8000/openapi.json frontend npm run codegen` → `docker cp "$CID":/app/src/lib/api/schema.d.ts impl/frontend/src/lib/api/schema.d.ts`。
- **TC-ID 検査**＝`python3 scripts/check_tc_traceability.py`（`--list` で一覧）。コミット前ゲート。
- **DB 直接確認**（control DB）＝`docker compose -f impl/compose.yaml exec -T db sh -lc 'psql -U "$POSTGRES_USER" -d ideaquest_control -c "..."'`（`POSTGRES_USER` 既定 `ideaquest`）。system_admin 汚染復元は §5 参照。
- **dev ログイン（PW 全て `Passw0rd!`）**＝system_admin `OPS`/`admin@ops.example`／一般 `ACME-01`/`user@acme.example`（MFA OFF・「テスト 太郎」・デモグループ所属）・`ACME-02`/`mfa@acme2.example`（MFA ON）。手動追加＝`SYSCON`/`t-umekawa`（system_admin・非 OPS＝§5 の注意点）。MailHog＝`http://localhost:8025`。
- 規約/正本＝`CLAUDE.md`（各種規約＋設計の正本のパス参照）。**現況の正＝`impl/README.md`**（追随更新・フロントエンド実装フロー規約 §1.2）。UI 標準＝`doc/画面設計/デザイン標準.md`。API＝`doc/API設計/{A..L}_*.md`＋`README.md`。データモデル＝`doc/データモデル.md`。ADR＝`doc/ADR/`。テスト＝`doc/テスト/*.md`＋`red確認台帳.md`。
