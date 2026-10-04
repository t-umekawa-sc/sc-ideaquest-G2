# handoff.md — 次セッションの自分への引き継ぎ

> 読者＝このセッションの記憶が無い次回の自分。会話ログは参照不可。本ファイルだけで再開できるよう全文上書きで維持（履歴は git）。
> 規約の正本＝リポジトリ直下 `CLAUDE.md`（毎セッション自動読込）。設計の正本は `doc/` 配下、実装現況は `impl/README.md`。

## 1. 最終更新 / ブランチ / 最新コミット
- 更新: 2026-10-04 JST（セッション末）
- ブランチ: `main`（作業は main 直 push が本プロジェクトの慣習）
- 最新コミット: 本セッションの `feat(contest): 承認制コンテストの可視ゲート（backend認可＋応募ダイアログ）`（commit＋origin/main へ push 済）。前回末は `69ff8dce`（docs(handoff)・親 `bd510b08`）。
- working tree: clean（全コミット済・push 済）
- alembic heads: control=`0019_company_access_mode` / company=`0053_contest_auto_approve`（**本セッションで migration 追加なし**＝認可ロジック変更のみ）
- ⚠️ 開始時に **git リポジトリ破損**（`.git/objects` に空オブジェクト3つ＝HEAD/tree/blob・WSL2 クラッシュ起因）を検出。GitHub(origin/main) が完全コピーを保持していたため、空オブジェクト削除→`git fetch` で修復済（working tree 無傷）。**節目でこまめに push 推奨**。

## 2. プロジェクトのゴール
ISO56001 準拠のアイデア/イノベーション管理 SaaS（マルチテナント＝control DB＋会社別 DB・ゲーミフィケーション付き）。
現フェーズ＝**アイデアコンテスト機能（FR-46/47/48）**。コンテスト中核〜SC-54 詳細の作り込みは概ね完了し、次は公開/非公開モード（Step3）等。

## 3. 今回やったこと（このセッションの変更＝コミット単位・理由つき）

> **本セッション（2026-10-04）＝アイデアコンテストのアクセス制御の整理＋承認制コンテストの可視ゲート実装（backend認可をテストで検証しながら＋frontend）。** 設計書ファースト→テストmd先出し→red→green で実施。詳細な設計判断はメモリ `contest-access-control-design`。
>
> - **設計整理（ユーザーと合意）**＝(1) コンテスト内の中身の可視は**会社レベルから撤廃しコンテスト単位 `auto_approve` へ移設**（承認制=参加者のみ）／(2) 会社 `access_mode` は メニュー/着地/外周403/サインアップの4役に専念（可視は担わない・直交）／(3) **決定O 改訂**＝公開会社は「コンテスト専用テナント」＝`role=general` はコンテスト許可リストのみ・**管理者はコンテスト＋管理許可リストのみ**（それ以外は管理者でも403）。旧「403 は general のみ=管理者全EP素通し」は誤りとして改訂。正本2箇所（`doc/API設計/A_認証・セッション.md §A.11.1`・`doc/設計ドラフト/アイデアコンテスト機能_設計.md §8.0`）を修正。
> - **可視ゲート実装**（migration なし）＝`contests/access.py` に `can_view_contest`（`auto_approve` OR 作成者 OR Tier1参加者 OR 運営）/`is_contest_manager` 新設。`quests/repository.can_access_quest` のコンテスト分岐を委譲（アイデア一覧/詳細/全文検索/活動が一斉ゲート＝承認制×未参加は404存在秘匿）。`GET /contests/{id}`・ランキングは `can_view_contest` で**403明示ガード**。一覧 `GET /contests` に `auto_approve`/`participant_count`/`my_status`/`description`＋直下 `can_manage` を付与。
> - **frontend**＝`ContestListView` 行クリックを `canManage||auto_approve||my_status='approved'` で分岐（詳細遷移 or **応募ダイアログ**＝概要+種別/会期/状態/参加人数+応募／運営以外は編集複製削除メニュー非表示）。`ContestDetailView` は直接URLの403を「参加承認制」の案内に。api `fetchContests` は `{items,canManage}` を返すよう変更。OpenAPI 型再生成済。
> - **検証**＝backend フル **945 passed**（+4新規 T-TC-113改訂/128/129/133/134・回帰ゼロ）／frontend build+vitest 218 green／traceability ✅969／ブラウザ目視（承認制→ダイアログ・応募→承認待ち・誰でも参加可→詳細遷移）。既存 T-TC-112/115/117/120 は可視を開く `auto_approve=True` 前提に修正（tierゲート単体検証に純化・可視は新規TCが担当）、T-TC-118 の can_manage 判定は一覧EP経由に変更。
>
> ---
> 以下は前セッション（2026-10-03）の記録。
> 前半（Step2b-2〜2c・SC-54 初版）は前セッション。本セッションは **SC-54 の受入ポリッシュと機能追加の連続**。すべて main に push 済み。コンテスト実装の正本ファイル＝backend `impl/backend/app/tenant/contests/`（access/application/repository/router/schemas/orm）・frontend `impl/frontend/src/features/contests/`（api.ts/types.ts/contests.css/components/{ContestListView,ContestDetailView}.tsx）。

- **SC-53 一覧をクエスト一覧UIに統一＋コンテスト削除** `26acf5f0`: `ContestListView` を DataTable（検索/並替/絞込/列設定/エクスポート/表示切替）＋RowMenu（詳細/編集/複製/削除）に。会期ステータスを `.segmented` スイッチに。backend に `DELETE /contests/{id}`（論理削除・application.delete_contest）＝T-TC-106。
- **作成/編集に会期入力＋詳細に状態遷移** `34949470`: モーダルに開始日/締切（会期型）・自動お蔵入り日数（常設型）。詳細ヘッダーに会期遷移。
- **状態の隣接後退可＋⋯メニュー統一** `f7345c52`: `_CONTEST_FLOW` を隣接1段で前進・後退とも可に。詳細の状態操作をクエスト詳細同様の ⋯ RowMenu（進める/戻す/削除）へ。T-TC-107。
- **`.page-title`・通知見出しをビジネス体に** `893019a2`/`eba9ee1e`: ピクセル体はゲーム要素専用の方針に反していたため `--font-base` に是正（`design-system.css .page-title`・`notifications.css .notif-title`）。
- **参加承認をコンテスト単位に** `66c456e1`: 会社単位ではなく `contests.auto_approve`（migration 0053・既定 false＝承認制）。作成/編集モーダルにトグル。request_contest_participation が public OR auto_approve で自動承認。T-TC-116。
- **SC-54 に4パネル＋チェックボックス標準化** `355a278d`: 概要/コンテスト内アクティビティ（ActivityFeed＝backing quest の activities 流用）/新着の議論/活動の活発さ（ActivitySpark）。新着の議論は本人参加アイデア限定＝詳細に `my_participating_idea_ids`（repository.discussion_idea_ids）。T-TC-117。チェックボックスを style-guide の `.checkbox` に統一。
- **「パーティー」→「パーティ」UI全面統一** `fd10fd5d`: frontend src 全体＋backend のユーザー向けエラー2件。vitest 218 passed。
- **SC-54 上位タブ（アイデア/全文検索/パーティ）** `5ea2ce51`/`d1baf9aa`/`fb6c5417`: クエスト詳細同様の `.tabs`。全文検索＝backing quest の `GET /quests/{id}/search` 流用。パーティ＝運営のみ（詳細に `can_manage`・`GET /contests/{id}/participants`・T-TC-118）。`.tabs`/`.ft-*`/`.member-list` 等 feature スコープCSSを `contests.css` に複製（タブ崩れ修正）。
- **パーティ管理（主催者/審査員/退出/追加）** `abdbe53e`/`64c7be88`/`7f8953e1`/`922a4122`: 主催者表示（detail owner_display_name）・審査員トグル（`PATCH /contests/{id}/participants/{uid}/evaluator`＝contest_evaluator・T-TC-119）・退出=rejected 論理削除・退出済みブロック（再承認）・直接追加（`GET /contests/{id}/participant-candidates`＝`list_cross_group_candidates([])` 流用＋ピッカー・T-TC-124）。パーティ操作は全体 load を回さず `partyReload` で参加者だけ再取得（ちらつき/ダイアログ再開を解消）。候補は「もっと見る」（cursor）。
- **アイデア一覧を DataTable 化** `4b58bd8d`: SC-54 アイデアタブをクエスト詳細同一の DataTable（件名/提案価値/あなた/フォロー/賛成反対/💬/評価/操作）。
- **ボタン体裁統一** `a93ee0cd`: 「メンバーを追加」通常サイズ・クエストの「パーティ・権限を編集」を primary（青）通常サイズに。
- **入賞/殿堂入り/お蔵入りの手動動線＋排他** `5ec8e742`/`92dfedef`: アイデア操作メニューに運営トグル（`PATCH /contests/{id}/ideas/{idea_id}/flags`・flag=selected/hall_of_fame/shelved・T-TC-126）。3状態は**排他**（ON で他を自動解除）。タブ分類も優先度排他（お蔵入り>殿堂入り>入賞>応募中）＝応募中は「いずれでもない」。
- **コンテスト配下アイデア詳細で関連情報を非表示** `3bc2a4bf`: IdeaDetailDTO に `is_contest`（contests.access.contest_of 判定）。SC-22 の RelatedInfoPanel を is_contest で非表示。T-TC-125。
- **Tier2 議論参加の導線** `f7f863ae`→`bd510b08`: `GET /ideas/{id}/participation`（文脈＝is_contest/is_author/my_status/requests・T-TC-127）。最終形（bd510b08）＝SC-22 の**チャットカードのボタン**を Tier2 承認状態で切替（未承認→「議論に参加をリクエスト」／承認待ち→「⏳承認待ち」／承認済・投稿者・非コンテスト→「チャットを開く」）＋投稿者にはカード内に承認/却下リスト。独立パネル（IdeaParticipationPanel）は廃止。request/decide は既存EP（Step2b-1）利用。実装＝`impl/frontend/src/features/ideas/components/IdeaDetailView.tsx`（partCtx 状態・load で is_contest 時 getIdeaParticipation・requestPart/decidePart ハンドラ・チャットカード条件分岐）。

## 4. 現在の状態
- **動いているもの**: backend/frontend 再ビルド済みで稼働（§8 の起動参照）。SC-53 一覧／SC-54 詳細（4パネル＋3タブ＝アイデアDataTable/全文検索/パーティ運営管理）／コンテスト CRUD・会期・状態遷移（前進/後退）・表彰確定・ランキング・参加2階層・審査員・入賞/殿堂入り/お蔵入り（手動＋自動・排他）・Tier2 チャット参加導線。多くを**ブラウザ目視検証済**（Playwright スクショ）。
- **テスト通過状況（確認済）**: **全backend 941 passed**（`f7f863ae` 時点でフル実行・回帰ゼロ）。`bd510b08` は frontend のみ（backend 無改修＝再実行せず・941 のまま）。traceability `check_tc_traceability.py`＝✅（code 965 件すべて md 記載・`f7f863ae` 時点）。frontend `npm run build` は各コミットで green。vitest は `fd10fd5d` 時点 218 passed。
- **壊れているもの**: 既知なし。
- **注意**: コンテストの参加者一覧・候補・パーティ操作系の pytest はダミー user を seed して共有 dev DB を使うため、各テストは finally で物理掃除している（`tests/contests/test_contest_access.py` の `_purge_contest_idea`・`test_contests.py`/`test_contest_awards.py` の掃除ヘルパ）。新テスト追加時は contest_idea_flags/idea_participants/contest_participants の掃除漏れに注意（quests_owner_id_fkey で teardown が落ちる）。

## 5. 詰まっている点（試して失敗 → 対処）
- **スキーマ命名衝突**: コンテストの ranking/finalize レスポンスを `RankingResponse`/`FinalizeResponse` にしたら既存 gamification の `RankingResponse` と衝突し、FastAPI が両方をモジュール修飾名化→既存 ranking 型参照まで壊れた。→ `Contest` 接頭辞（`ContestRankingResponse` 等）に改名して解決。**新規スキーマ名は既存と衝突しないか確認**。
- **feature スコープCSS がコンテストページで無スタイル化**: `.tabs`/`.ft-*`/`.member-list`/`.idea-*` 等は `quests.css`（feature）にしかなく、コンテストページのバンドルに含まれずタブ等が崩れた。→ 必要分を `contests.css` に複製（`fb6c5417` 等）。他画面で同じことが起きたら複製で対応。
- **パーティ操作のちらつき/ダイアログ再開**: 操作後に全体 `load()`（`setLoading(true)`）を呼ぶとローディング early-return でモーダル含む全要素が一瞬 unmount→再mount。→ `partyReload` 状態を別に設け参加者/候補だけ再取得（`ContestDetailView`）。
- **cwd ドリフトの事故多発**: `Bash` の cwd が `impl` や `impl/frontend` にずれたまま `git add doc/...`（repo ルート相対）や `docker ... -v "$PWD/backend:/app"` を叩くとパスが外れて失敗。→ git は repo ルート、pytest/compose は `impl` から実行する（パスは都度確認）。
- **codegen の実行方法**: §8 記載の `cd frontend && npm run codegen`（localhost:8000）ではなく、本セッションは compose ネットワーク経由で実行＝`docker compose run --rm -T -v "$PWD/frontend:/app" -w /app --entrypoint sh frontend -c "npx openapi-typescript http://backend:8000/openapi.json -o src/lib/api/schema.d.ts"`（`impl` から・backend 起動＆再ビルド済みが前提）。

## 6. 決定事項と根拠（採用しなかった案も）
- **クエストを器に再利用（B案）**＝`contests.quest_id` が backing quest を 1:1 で指す。ideas/votes/evaluations/chat は無改修共有。A案（ideas.quest_id を nullable 化）はアクセス制御総取替で影響大のため不採用。
- **アクセスは単一ポリシー**＝`contests/access.py`（contest_of/can_vote/can_chat/can_evaluate/can_post_idea）に集約し、可視は `quests/repository.can_access_quest` 先頭の遅延import分岐で会社全体可視に（§2.3）。
- **参加承認はコンテスト単位 `contests.auto_approve`**（会社単位から変更＝ユーザー要望）。public/DEMO は常に自動承認（決定G）。
- **入賞/殿堂入り/お蔵入りは排他**（1アイデア1状態）＝手動 ON で他を自動解除・タブ分類は優先度（お蔵入り>殿堂入り>入賞>応募中）。
- **投票=Tier1 全参加者 / チャット=Tier2 投稿者承認 / 評価=contest_evaluator のみ**（案X＝賛成票バイアス回避＋心理的安全性・偏り防止）。
- **業務画面の見出しはビジネス用フォント**（`--font-base`）。ピクセル体はゲーム要素専用。
- **FR 採番 46/47/48**（FR-45 が LLM連携で使用済のため +1）。**SC 採番 05/53/54**（SC-50/51 は情報インプットで使用済）。
- **user_capabilities＝②会社レベル能力の単一レジストリ**（info_curator/quest_create/contest_create/contest_evaluator）。**info_curators の統合（移行＋ドメインN参照差替）は未着手＝別ステップ保留**。
- **公開性は会社単位 `companies.access_mode`** 一本化（旧 contests.visibility 廃止・migration 0019）。
- コミット/push は main 直（本プロジェクトの慣習・都度 commit&push）。

## 7. 次にやること（優先順・ファイル/関数レベル）
0. **（進行中・次セッション着手）コンテスト参加リクエストの通知＋ダッシュボード未処理パネル表示**（ユーザー要望 2026-10-04）＝Tier1 参加リクエスト（`request_contest_participation`）を運営（主催者/`contest_create`/管理者）へ通知（H `notify()`・新 type 例 `contest_participation_requested`）＋SC-01 ダッシュボード（I `GET /dashboard`）の「未処理（承認待ち）」に表示。**既存の未処理パネルと分けるか統合かはレビューして提案**（クエストのパーティ参加リクエストと同型か確認）。未着手。
1. **Step3 公開/非公開モード（FR-48・SEC・主要ステップ）**＝`companies.access_mode='public'` の外周ガード。**決定O 改訂済（2026-10-04）**＝`role=general`＝コンテスト許可リストのみ／**管理者（system_admin/company_account_admin）＝コンテスト＋管理許可リストのみ・それ以外は管理者でも403**（公開会社=コンテスト専用テナント）。正＝`doc/API設計/README.md §1.6`・`doc/API設計/A_認証・セッション.md §A.11.1`。実装箇所の候補＝`app/control_plane/me/deps.py` の `require_me` 近辺か専用 Depends で access_mode×role×パスを判定。併せて `GET /public/bootstrap`（公開ランディング用・SC-53 着地）。TC＝`doc/テスト/T_アイデアコンテスト.md` の T-TC-150/151/201＋T-TC-114（public 自動承認）。**大きめ・全EP横断の認可＝慎重に（既存テストの回帰確認を厚く）**。
2. **Step4 セルフサインアップ（FR-48・SEC 重）**＝SC-05（画面）＋`POST /public/signup`・`POST /public/signup/verify`（正＝`doc/API設計/A_認証・セッション.md §A.11`・SEC A〜J）。TC＝`doc/テスト/A_認証.md` A-TC-120〜127。`companies.self_signup_enabled` を gate に使う。
3. **Step5 アイデア→クエスト昇格（FR-47・T.5）**＝`POST /ideas/{id}/promote-to-quest`（要 `quest_create`・内容コピー＋`quests.origin_idea_id` で由来参照・社内のみ）。TC＝T-TC-140。
4. **SC-54 残フォロー（任意）**＝①参加状態・権限に応じた CTA 出し分け（現状「参加する」は open 時のみ表示・権限無は 403→snackbar）／②ランキング軸の会期日付が未設定（starts_at/ends_at=null）だと全期間集計になる点の UI 明示／③SC-54 の正式モック（`doc/画面設計/mocks`）と `doc/画面設計/screens/SC-54_*.md` の起票（現状は遷移図のみが仕様源）。
5. **保留**＝info_curators → user_capabilities のデータ移行＋ドメインN参照差し替え（情報インプット稼働部に触る・慎重に・別ステップ）。
6. **dev 復旧（AI生成テスト不要なら）**＝`docker rm -f iq-livefix-worker`／`docker compose stop ollama`／`docker compose up -d llm-worker`（通常 worker は qwen3-swallow 想定＝Ollama未pullで AIジョブは失敗。生成を回すなら override）。

## 8. 再開に必要な環境情報
- 作業ディレクトリ: `/home/t-umekawa/sc-ideaquest-G2`（repo ルート）。compose は `impl/compose.yaml`。**git はルート／pytest・compose は `impl` から**実行（cwd ドリフトでパスが外れるので都度確認）。
- 起動: `cd impl && docker compose up -d`。コード反映は `docker compose up -d --build backend`／`... frontend`（backend/frontend はイメージにソースをベイク＝再ビルド必須）。
- ポート: frontend 3000・backend 8000・db(postgres) 5432（DB ユーザ `ideaquest`）・ollama 11434・mailhog 8025・minio 9000。
- backend テスト（会社DB 要・source mount で未コミット反映）: `cd impl && docker compose run --rm -T -v "$PWD/backend:/app" backend pytest <path> -q -p no:logging`。エントリポイントが bootstrap（migration 適用＋seed）を実行してから pytest。全実行は `... pytest -q`。
- マイグレーション適用: `docker compose run --rm -T -v "$PWD/backend:/app" --entrypoint python backend scripts/bootstrap.py`。
- frontend 検証: `cd impl && docker compose run --rm -T -v "$PWD/frontend:/app" -w /app --entrypoint sh frontend -c "npm run build"`（Next lint＋型・**本来のゲート**）。unit は `... -c "npx vitest run"`。
- OpenAPI 型再生成（codegen・backend 起動＆再ビルド後）: `cd impl && docker compose run --rm -T -v "$PWD/frontend:/app" -w /app --entrypoint sh frontend -c "npx openapi-typescript http://backend:8000/openapi.json -o src/lib/api/schema.d.ts"`。backend のスキーマ/EP を変えたら必ず再ビルド→codegen→frontend build。
- traceability ゲート: `python3 scripts/check_tc_traceability.py`（repo ルート・新規 TC は md 先出し必須）。
- UI 目視検証: ホストに Playwright + chromium あり。`cd impl/frontend` で小スクリプト（`require("@playwright/test")`）を置いて `node` 実行＝ログイン→画面→スクショ→`/tmp/*.png` を Read で確認。
- dev ログイン（PW 全て `Passw0rd!`）: 会社コード `ACME-01`／会社管理者 `kanri@acme.example`（company_account_admin＝コンテスト作成・能力付与・運営操作可）／一般 `user@acme.example`（quest_create 付与済）／system_admin は会社 `OPS`／`admin@ops.example`。
- 動作確認に使った既存コンテスト（acme・共有 dev DB）: 一覧の「公募中」タブに複数あり（例 `/contests/a8057745-6fdd-4290-81f2-eb6bc1eb44bb`）。※共有 dev DB なので手動 seed したら掃除する。
- 必読の正本: `CLAUDE.md`（規約）／`doc/設計ドラフト/アイデアコンテスト機能_設計.md`（コンテスト全論点）／`doc/API設計/T_アイデアコンテスト.md`・`A_認証・セッション.md §A.11`／`doc/テスト/T_アイデアコンテスト.md`（T-TC-101〜201・本セッションで〜127 まで実装）・`A_認証.md`／`impl/README.md`（実装現況）。
- ※`doc/セキュリティ検証/DAST_ZAP検証手順.md` は別セッションで編集中（本セッション対象外・現在 working tree には出ていない＝触らない）。
