# handoff.md — 次セッションの自分への引き継ぎ

> 読者＝このセッションの記憶が無い次回の自分。会話ログは参照不可。本ファイルだけで再開できるよう**全文上書き**で維持（履歴は git）。
> 規約の正本＝リポジトリ直下 `CLAUDE.md`（毎セッション自動読込）。設計の正本は `doc/` 配下、実装現況は `impl/README.md`。

## 1. 最終更新 / ブランチ / 最新コミット
- 更新: 2026-10-07（セッション末・アイデアコンテストの昇格機能＋出典URL＋info_curators統合まで）
- ブランチ: `main`（main 直 push が慣習・本セッションも都度 push 済み）
- 最新コミット: `99452673 refactor(info): info_curators を user_capabilities へ統合（クリーン移行・FR-47・決定D）`
- working tree: **clean**・`origin/main` と同期済み（`git status` で確認）。
- alembic heads（ファイル基準）: control=`0020_signup_challenges`／company=`0056_info_curators_merge`（本セッションで `0055_quest_source_url`・`0056_info_curators_merge` を追加）。
- 本セッションのコミット（古→新・すべて push 済み）: `35339f93`（昇格 promote-to-quest）/`1c6a7dc9`（一覧の参加状況列）/`922a1572`（投稿後の一覧即反映 fix＋⋮最右）/`accebb24`（クエスト出典URL）/`99452673`（info_curators 統合）。

## 2. プロジェクトのゴール
ISO56001 準拠のアイデア/イノベーション管理 SaaS（マルチテナント＝control DB＋会社別DB・ゲーミフィケーション）。直近フェーズはアイデアコンテスト（FR-46）＋会社レベル能力/昇格（FR-47）＋セルフサインアップ/公開モード（FR-48）周辺の未実装つぶしと細部改善。

## 3. 今回やったこと（変更ファイルと理由）
### A. アイデア→クエスト昇格（FR-47・T.5・決定H・commit `35339f93`）
- **理由**＝裏取りの結果、アイデアコンテスト機能で唯一明確に未実装だったのが「アイデア→クエスト昇格」。設計（`doc/設計ドラフト/アイデアコンテスト機能_設計.md` §7・`doc/API設計/T_アイデアコンテスト.md` T.5）は確定済み・`quests.origin_idea_id` カラムと ORM は存在したが EP/ロジックが皆無だった。
- backend＝`app/tenant/quests/repository.py::create_quest` に `origin_idea_id`/`source_url` 引数追加／`app/tenant/quests/application.py::promote_idea_to_quest`（public 会社は明示 404 存在秘匿／`quest_create` or 管理者ゲート＝通常作成と同一 `_can_create_quest`／アイデアの title・本文＋狙う価値を種継ぎ・owner 投入・初版リビジョン・トークン）＋`_compose_promote_purpose`／`app/tenant/quests/router.py` に `POST /ideas/{idea_id}/promote-to-quest`／`app/tenant/ideas/application.py::get_idea_detail` に `can_promote` 算出（`is_contest`×非public×`_can_create_quest`）・`app/tenant/ideas/schemas.py::IdeaDetailDTO` に `can_promote` 追加。
- frontend＝`src/features/ideas/api.ts::promoteIdeaToQuest`／`src/features/ideas/components/IdeaDetailView.tsx` に「🚀 クエストへ昇格」導線（`can_promote` 時のみ・確認→POST→新クエストへ遷移）。
- tests＝`tests/contests/test_promote.py`（T-TC-140 成功/403・140b public404・140c can_promote・140d source_url）。
- docs＝`doc/API設計/T_アイデアコンテスト.md` T.5／`doc/テスト/T_アイデアコンテスト.md`／`impl/README.md`。

### B. コンテスト一覧の参加状況列（commit `1c6a7dc9`・ユーザー要望）
- `src/features/contests/components/ContestListView.tsx` に「参加状況」列（`my_status`＝approved→参加中/requested→リクエスト中/left→退席済/他→—・enum 絞り込み・カードにもバッジ）。backend は既存 `_list_item.my_status` をそのまま利用（API 変更なし）。

### C. 不具合修正＋⋮位置（commit `922a1572`・ユーザー指摘）
- **不具合**＝コンテスト詳細（SC-54）でアイデア投稿後、一覧がリロードしないと出ない。**原因**＝`ContestDetailView.tsx` が `IDEAS_CHANGED_EVENT`（window・跨ルート）を未購読だった（SC-12 `QuestDetailView` は購読済み）。**修正**＝`ContestDetailView.tsx` に同イベント購読 effect を追加し `load()` 再取得。
- `IdeaDetailView.tsx` で「クエストへ昇格」ボタンを編集/⋮ブロックより**前**に移動＝⋮（削除danger）を最右に戻す（操作統一 §4.14）。

### D. クエスト出典URL（FR-47・commit `accebb24`・ユーザー要望）
- **理由**＝クエスト登録フォームに任意「出典URL」を追加し、昇格時は由来アイデアへの可視リンクを貼る（人間向け・機械リンク `origin_idea_id` と併存）。UIは情報インプットの登録ダイアログの出典URL欄に合わせる。
- backend＝`quests.source_url`（migration `0055_quest_source_url`・text・NULL可）／`app/tenant/quests/orm.py` にカラム／`schemas.py` の QuestCreate/Update/Publish/Detail に `source_url`／`application.py::_validate_source_url`（http/https または `/` 始まり内部パスを許容・`//`/`javascript:` は 422・open-redirect 防止）を create/update(`_apply_content`)/promote/`_build_detail` に配線。昇格は `source_url=/ideas/{origin_idea_id}` 自動設定。
- frontend＝`src/features/quests/components/QuestForm.tsx` に出典URL欄（情報ダイアログ同形の Field/hint/placeholder・内部パス許容のため `type=text inputMode=url`・`questContentSig`/payload/prefill に配線）／`QuestDetailView.tsx` に出典リンク（内部パスは `<Link>`・http(s) は新規タブ）。
- tests＝C-TC-307（`tests/quests/test_sc11_api.py`・round-trip＋422検証）・T-TC-140d。docs＝データモデル §5.6／`doc/API設計/C_クエスト・パーティー・権限.md`／T.5。

### E. info_curators → user_capabilities 統合（FR-47・決定D・commit `99452673`）
- **理由**＝②会社レベル能力を単一レジストリ `user_capabilities` に集約する設計方針（§3.1/§5.63）。info_curator だけ独自テーブル `info_curators` に残っていた（1能力1テーブルの増殖）。
- migration `0056_info_curators_merge`＝既存 `info_curators` 行を `user_capabilities(capability='info_curator')` へデータ移行（`granted_by_id`/`granted_at`/`revoked_at` 保持）→旧テーブル DROP（**クリーンカットオーバー**・ユーザー選択）。
- `app/tenant/info/repository.py` の `is_curator`/`list_curators`/`grant_curator`/`revoke_curator` を `app/tenant/capabilities/repository.py`（caps）経由へ差し替え＋`app/tenant/info/orm.py` の `InfoCurator` クラス撤去。
- 管理EP `GET/POST /info-curators`（N.5・account_id ベース）は**内部実装のみ差し替えて応答互換を維持**（frontend 無改修・ユーザー選択）。
- tests＝`tests/info/test_api.py`・`tests/info/test_repository.py`（N-TC-011 他）の curator seed を `UserCapability` へ更新。docs＝データモデル §5.37/§5.63・`doc/テスト/red確認台帳.md`・`impl/README.md`。

## 4. 現在の状態（動作/テスト）
- **backend pytest**（本セッションで実行・green・baked backend に `-v` マウントで実行）＝`tests/quests tests/contests tests/ideas` **263 passed**／`tests/info tests/capabilities` **82 passed**／`tests/contests/test_promote.py` 単体も baked backend（`docker compose exec`）で 3 passed 確認。
- **frontend**＝`npm run build` ✅（複数回）。codegen 済（`promote-to-quest`・`can_promote`・`source_url` 取込）。
- **TC トレーサビリティ**＝`python3 scripts/check_tc_traceability.py` ✅（code 1013 件）。
- **ブラウザ受入＝OK**（ユーザー確認済み・昇格ボタン/⋮位置/一覧即反映/参加状況列/出典URL）。
- **コンテナ**＝`backend`/`db`/`frontend`/`mailhog`/`minio`/`redis` が稼働。backend/frontend は本セッションの変更を `--build` 反映済み。**worker/mail-worker は停止中**（本セッションは起動していない）。
- **dev 会社DBのマイグレーション**＝`0055`・`0056` を全会社DB（acme/acme2/demo/ops）に適用済み（§8 の手順で実施）。
- 壊れているもの＝**無し**（確認した範囲）。

## 5. 詰まっている点（試して失敗/注意）
- **【重要・再発防止】TC-ID は採番前に既存 max を確認する**＝本セッション、昇格の表示フラグ用テストを `T-TC-141` で採番したが、既に `T-TC-141`（参加リクエスト判断材料プロフィール・`tests/contests/test_contests.py`）が使用済みで衝突。`scripts/check_tc_traceability.py` は重複を検出しない（memory `tc-id-traceability-no-uniqueness`）。→ `T-TC-140c` へ改番して解消。**新規採番は `grep -rhoE '<DOMAIN>-TC-[0-9]+' doc/テスト/` で max を見てから**。
- **【重要】red-green は「対象に到達した behavior-red」でないと規約違反**（テスト規約 §5.1）＝ルート未定義の 404 や KeyError は NG。新規EPは**スタブ（501  or 誤値）を先に置き**、期待値との差分（例 `501≠201`・`False≠True`）で red を目視してから本実装。本セッションは最初この手順を飛ばして指摘され、スタブ方式で取り直した。storage 置換の refactor（info_curators 統合）は後追いのため**スタブ手技＋`doc/テスト/red確認台帳.md` 記録**で代替した。
- **frontend にコンポーネント描画テスト基盤が無い**＝vitest は `environment: "node"`・`@testing-library/react`/jsdom 未導入。SC-54 のアイデア投稿→一覧即反映（commit `922a1572`）の回帰テストは**単体化不可**で、本来の担保は e2e（未実装＝follow-up・§7-1）。コミットメッセージにも明記済み。
- **baked backend の pytest は未コミット編集を反映しない**＝`docker compose up -d --build backend` か `docker compose run --rm -T -v "$(pwd)/backend:/app" backend pytest …`（-v マウント）。本セッションは一貫して -v マウントで red/green を回した。
- **新規 migration は dev 会社DBへ手動適用が要る**＝§8 のワンライナー（`scripts.bootstrap.migrate_company` を全 `db_identifier` に適用）。backend 再ビルドだけでは既存DBのスキーマは変わらない。
- **worker/mail-worker は `--build` しないと古いベイクコードで動く**（前セッションからの既知落とし穴・本セッションでは worker 未使用）。起動時は `docker compose --profile workers up -d --build worker mail-worker`。

## 6. 決定事項と根拠（不採用案も）
- **昇格EPのゲート＝通常のクエスト作成と同一**（`quests.application._can_create_quest`＝`quest_create` 能力 or 管理者）＝一か所で一致（DRY）。能力なしは 403（`capability_required`）。
- **昇格は社内のみ＝public 会社では application で明示 404（存在秘匿）**＝`/ideas` 配下は公開モード外周ガード（`app/core/access_gate.py`）の許可リストに含まれ素通りするため、業務機能である昇格を application 側で 404 にする（決定O/P' 整合・管理者でも不可）。
- **出典URL は汎用の任意URL欄**（ユーザー選択）＝外部URLも可。昇格時のみ内部パス `/ideas/{id}` を自動入力。**内部パス形式を採用**（ユーザー選択）＝環境非依存（ホスト名を焼かない）・アプリ内 `<Link>` でシームレス遷移。http/https のみに縛る情報インプットより緩和（内部リンクを張れるようにするため）。`//`（プロトコル相対）は open-redirect 防止で拒否。入力 `type` は情報側の `url` ではなく `text`（内部パスが native url 検証で誤無効にならないよう）＝見た目・ラベル・ヒント・placeholder は情報ダイアログに合わせる。
- **参照資格の無いユーザーが出典（内部リンク）を踏むと 404（存在秘匿）**＝`GET /ideas/{id}` の門番 `can_access_quest_id`（コンテスト配下は `can_view_contest`）が 403 でなく 404 を返す（情報漏洩なし・切れたリンクに見えるのは許容）。
- **info_curators は DROP（クリーンカットオーバー）**（ユーザー選択）＝互換ビュー/二重書きは採らず、DRY の終状態に一本化。管理EP（N.5）は内部実装のみ差し替えて応答互換を維持（frontend 無改修）＝統合EP `POST /admin/accounts/{uid}/capabilities` への寄せは今回スコープ外。

## 7. 次にやること（優先順・ファイル/関数レベル）
1. **（任意・回帰補強）SC-54 アイデア投稿→一覧即反映の e2e** ＝commit `922a1572` の修正に対する自動回帰が無い（§5 の infra 制約）。`impl/frontend/e2e` に Playwright で「コンテスト配下アイデアを投稿→詳細のアイデア一覧にリロードせず出る」を1本。共有DB非冪等に注意（専用シード垢・memory `e2e-full-not-idempotent-shared-db`）。
2. **アイデアコンテストの残り（Phase2）**＝`doc/設計ドラフト/アイデアコンテスト機能_設計.md` §6.4 の「妥当性」解析・自動表彰スケジューラ（bounded の `ends_at` 経過自動 closed／rolling の `auto_shelve_expired` の定期実行トリガ）。いずれも MVP スコープ外＝LLM/スケジューラ基盤前提。着手前にコードで現況裏取り（memory `handoff-notes-often-stale`）。
3. **Turnstile `size:flexible` 幅の実ブラウザ目視**（前セッション持ち越し・未実施）＝CAPTCHA を再有効化（`impl/.env` の `#TURNSTILE_*` を外す＋`IQ_DEFAULT_COMPANY_CODE=DEMO`＋backend 再起動）して `/signup` で「成功しました!」ボックスが認証コード入力欄と同幅か確認。ズレたら `src/features/auth/components/SignupForm.tsx`。確認後 `.env` を dev 既定へ戻す。
4. **バックログ F8＝リッチ本文インライン画像の恒久表示**（前セッション持ち越し・未着手）＝`doc/バックログ/未実装・ギャップ一覧.md` F8。安定配信プロキシEP（`GET /media/{key}` が都度署名して 302・認可付き）を新設し、情報 N.2（`info/application.rehost_image`）とお知らせ U-8（`announcements/application.rehost_image`）の短TTL署名URL 直埋めを置換。
5. **SC-01 設計書 §3〜9 を5ゾーンに整合**（前セッション持ち越し・`doc/画面設計/screens/SC-01_ダッシュボード.md` 本文が再設計前のまま）。
6. **（任意）info_curators 統合の総仕上げ**＝管理UI/EP を統合EP `POST /admin/accounts/{uid}/capabilities`（ドメインT）へ寄せるか（今回は N.5 EP 互換維持で据え置き）。DRY 観点の follow-up。

## 8. 再開に必要な環境情報
- 作業ディレクトリ：`/home/t-umekawa/sc-ideaquest-G2`（実装 `impl/`・frontend `impl/frontend`・backend `impl/backend`）。
- 起動：`cd impl && docker compose up -d`。backend=`http://localhost:8000`・frontend=`http://localhost:3000`・openapi=`http://localhost:8000/openapi.json`・MailHog=`http://localhost:8025`。
- **workers（必ず `--build`）**：`cd impl && docker compose --profile workers up -d --build worker mail-worker`。確認後 `docker compose stop worker mail-worker`。
- 反映（ソースベイク・volumes 無）：`cd impl && docker compose up -d --build backend|frontend`。型再生成＝backend 再ビルド後 `cd impl/frontend && npm run codegen`。
- **新規 migration を dev 会社DBへ適用**（本セッションで多用）：`cd impl` した上で `docker compose run --rm -T -v "$(pwd)/backend:/app" backend python -c "<SCRIPT>"` を実行。`<SCRIPT>` の中身＝`scripts.bootstrap.migrate_company` を全会社DBに回す（`app.db.control.control_session` を with で開き `Company` 全件の `db_identifier` を取り、各 `d` に `migrate_company(d)` を適用）。control DB は `scripts.bootstrap.migrate_control()`。この -v マウント run は実行中の `db` コンテナ（＝同一 Postgres）に効くので、再ビルドした backend/worker も同じスキーマを見る。backend 再ビルドだけではスキーマは変わらない点に注意。
- テスト：
  - frontend `cd impl/frontend && npm run build`（lint＋コンパイル必須ゲート）／`npx vitest run <path>`。
  - backend（ベイク）`cd impl && docker compose exec -T backend pytest <path> -q`。**未コミット反映は** `cd impl && docker compose run --rm -T -v "$(pwd)/backend:/app" backend pytest <path> -q`（-v マウント）。
  - TC トレーサビリティ：`cd /home/t-umekawa/sc-ideaquest-G2 && python3 scripts/check_tc_traceability.py`。
- `.env`（`impl/.env`・gitignore 追跡外）現状＝**dev 共有スタック既定**＝`IQ_DEFAULT_COMPANY_CODE=`（空）・`TURNSTILE_SITE_KEY`/`TURNSTILE_SECRET_KEY` はコメントアウト（CAPTCHA 無効）。CAPTCHA/公開登録を検証する時だけ該当行を有効化し backend 再起動。
- ログイン（PW いずれも `Passw0rd!`）：一般 `ACME-01`/`user@acme.example`（MFA OFF）／管理 `ACME-01`/`kanri@acme.example`（company_account_admin）／OPS `admin@ops.example`（system_admin・会社 `OPS`）／MFA `ACME-02`/`mfa@acme2.example`（MFA ON）／**DEMO会社** `DEMO`/`admin@demo.example`（public＋self_signup）。会社DB＝`ideaquest_company_acme`／`ideaquest_company_demo`。
- 昇格機能の手動確認：管理者 `kanri@acme` でコンテスト作成（「誰でも参加可」＝auto_approve）→配下にアイデア投稿→アイデア詳細に「🚀 クエストへ昇格」→確認→新クエスト（下書き）へ遷移＋クエスト詳細の「🔗 出典」が元アイデアを指す。
- 目視検証の型：`impl/frontend` に使い捨て `_*.mjs`（Playwright chromium）を作り、**使い終わったら削除**。
