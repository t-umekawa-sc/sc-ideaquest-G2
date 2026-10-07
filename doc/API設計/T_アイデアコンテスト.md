# T. アイデアコンテスト（contests・会期公募・投票/評価・会期表彰・FR-46/47）

> 横断規約＝[API設計 README](README.md)（§1.6 認可・§1.8 一覧/カーソル・§1.9 冪等性・§1.12 リアルタイム）。データモデル＝[§5.60 contests](../データモデル.md)・[§5.61 contest_participants](../データモデル.md)・[§5.62 idea_participants](../データモデル.md)・[§5.63 user_capabilities](../データモデル.md)・[§5.64 contest_idea_flags](../データモデル.md)。設計元＝[アイデアコンテスト機能 設計](../設計ドラフト/アイデアコンテスト機能_設計.md)。画面＝SC-50（一覧）/SC-51（詳細）＋SC-22/24/25 流用。セルフサインアップ/公開モードは [A 認証・セッション](A_認証・セッション.md)（FR-48）。

> **アーキの芯**＝**クエストを器に再利用**（設計 §2）。コンテスト1件につき backing クエスト1行を 1:1 で持ち、**アイデア投稿/投票/評価/チャットは既存EP（ドメイン D/F/E）をそのまま流用**（本ドメインで再実装しない＝DRY・一か所直せば両方直る）。本ドメイン T は**コンテスト固有の差分だけ**＝枠CRUD・会期・参加リクエスト（Tier1/Tier2）・審査員付与（②能力）・表彰確定・昇格を担う。

## T.0 アクター・認可スコープ

| 操作 | 許可 | 補足 |
|---|---|---|
| コンテスト作成/編集/状態遷移/確定 | **②能力 `contest_create` 保持者**（＋ `company_account_admin`/`system_admin`） | 決定I＝一般ユーザーにも付与可（Q4「管理者のみ」を緩和） |
| コンテスト**一覧**（`GET /contests`） | 会社内 active ユーザー | 一覧は全ユーザーに返す（承認制の未参加者も「どんなコンテストがあるか」は見える＝応募導線のため）。各行にメタ（参加人数・`auto_approve`・自分の参加状態）を付与し、未参加者はダイアログ表示→応募（SC-53・設計 §2.3） |
| コンテスト**詳細/中身**（詳細・アイデア一覧/詳細・全文検索・活動・ランキング） | **`can_view_contest`**＝`auto_approve` OR 作成者 OR Tier1参加者(approved) OR 運営（`contest_create`/管理者） | 改訂 2026-10-04。承認制（`auto_approve=false`）×未参加は **403**（会社全体可視は撤廃）。`auto_approve=true`/public 会社は会社全体可視（設計 §2.3） |
| Tier1 参加リクエスト | 本人 | `public`/DEMO はサインアップで自動 `approved`（決定G） |
| Tier1 承認/却下 | **管理者**（`company_account_admin`/`system_admin`／`contest_create` 保持者） | `contest_participants.decided_by` |
| Tier2 参加リクエスト（チャット希望） | 本人（Tier1 承認済み） | |
| Tier2 承認/却下 | **そのアイデアの投稿者** | `idea_participants.decided_by`（荒れ対策・心理的安全性） |
| 投票（コンテスト配下アイデア） | **Tier1 参加者**（`contest_participants='approved'`・案X） | 既存 D の投票EPを流用＝ゲートのみ単一ポリシーで分岐 |
| 評価（コンテスト配下アイデア） | **②能力 `contest_evaluator`（審査員）保持者のみ** | 偏り防止（決定J・会社横断=J'）。既存 F の評価EPを流用＝ゲートのみ分岐 |
| チャット（コンテスト配下アイデア） | **Tier2 承認者**（`idea_participants='approved'`） | 既存 E のチャットEPを流用＝ゲートのみ分岐 |
| 能力付与/剥奪（`contest_evaluator`/`quest_create`/`contest_create`） | **`company_account_admin`/`system_admin`** | §5.3・SC-93 系 UI |
| アイデア→クエスト昇格 | **②能力 `quest_create` 保持者**（社内のみ） | `public`/公開参加者には出さない |

- **アクセス分岐は単一ポリシー解決**（設計 §2.3）＝`resolve_idea_access(quest, user)` でコンテスト配下は `can_view_contest`（参加者/運営/作成者/`auto_approve`）＋Tier1(投票)/Tier2(チャット)/審査員(評価) ゲート、通常クエストは従来のパーティー＋部署ゲート。**判定入口を1か所**＝`quests/repository.can_access_quest` のコンテスト分岐に集約（アイデア一覧/詳細/全文検索/活動へ一度で効く）。認可はサーバー権威（README §1.6・UI非表示に依存しない）。
- **一覧の追加メタ（応募導線用）**＝`GET /contests` の各 item に `auto_approve`・`participant_count`（approved 数）・`my_status`（none/requested/approved/rejected/left）・`description` を付与、レスポンス直下に `can_manage`（会社レベル運営可否・全行共通）。フロントは `can_manage || auto_approve || my_status='approved'` で詳細遷移、未満はダイアログ（概要＋メタ＋応募）＝SC-53。
- **公開モードの外周ガード**（会社 `access_mode='public'`・FR-48）＝`role=general` はコンテスト系許可リスト外のEPを **403**（README §1.6・A 参照）。本ドメイン T のEPはその許可リストに含む。

## T.1 コンテスト CRUD・会期

| メソッド / パス | 概要 | 補足 |
|---|---|---|
| `GET /contests` | 一覧（DataTable 契約・§1.8） | 会期タブ（開催中/予定/終了）・検索。`status`/`mode` 絞り込み |
| `GET /contests/{id}` | 詳細＝ヘッダー（会期/テーマ/賞）＋アイデア一覧タブ＋ランキング | アイデアタブ＝応募中/入賞/殿堂入り/お蔵入り（`contest_idea_flags`＋`is_selected` から導出・設計 §4.2） |
| `POST /contests`（要 `contest_create`） | 作成＝**backing quest も同時生成**（1:1・`contests.quest_id`） | `theme`/`description`/`mode`/`starts_at`/`ends_at`/`auto_archive_days`/`prize_config` |
| `PATCH /contests/{id}`（要 `contest_create`／所有） | 会期/賞 設定・**状態遷移**（`draft→open→judging→closed→archived`） | backing quest.status にマップ（設計 §4.1） |
| `POST /contests/{id}/finalize`（管理者・**Idempotency §1.9**） | **表彰確定**＝各軸上位N（`prize_config`）へ `ledger.grant`（冪等 `reason='contest_award'`）＋入賞実績（bronze/silver/gold）＋`ideas.is_selected`＋通知 | `judging→closed`。MVP は管理者手動（`rolling`/自動はスケジューラ後追い） |

- **状態機械**＝`draft→open（公募中）→judging（締切後の審査/集計）→closed（表彰確定）→archived`。`bounded` は `starts_at/ends_at` で自動遷移＋確定、`rolling` は常設（`auto_archive_days` で経過アイデアを「お蔵入り」自動付与）。
- 公開性は会社設定 `companies.access_mode` に一本化（本EPに `visibility` パラメータは持たない）。

## T.2 参加（2階層・Tier1/Tier2）

| メソッド / パス | 概要 | 補足 |
|---|---|---|
| `POST /contests/{id}/participation`（本人） | **Tier1 参加リクエスト**（閲覧＋投稿＋投票を得る） | `contest_participants(status='requested')`。`public`/DEMO は自動 `approved`（決定G） |
| `PATCH /contests/{id}/participation/{uid}`（管理者） | Tier1 承認/却下 | `approved`/`rejected`・`decided_by` |
| `POST /ideas/{id}/participation`（本人・Tier1承認済） | **Tier2 参加リクエスト**（チャット希望） | `idea_participants(status='requested')` |
| `PATCH /ideas/{id}/participation/{uid}`（**アイデア投稿者**） | Tier2 承認/却下 | `approved`/`rejected`・`decided_by`=投稿者 |

- **ゲート**（案X）＝**投票は Tier1（`contest_participants='approved'`）に開放**／**チャットは Tier2（`idea_participants='approved'`・投稿者承認）**／**評価は審査員（`contest_evaluator`）のみ**。閲覧＋自分のアイデア投稿は Tier1。
- 投稿・投票・評価・チャット本体は**既存EPを流用**（新設しない）＝D（アイデア/投票）/F（評価）/E（チャット）。本ドメインは参加の承認状態だけを管理し、単一ポリシー解決関数が各EPのゲートで参照する。
- **参加リクエストの通知（H・2026-10-04 ユーザー要望）**＝承認制で `requested` になったとき**運営（作成者＋`contest_create` 保持者）へ `contest_join_request_received`**（📩・`params.contest_id`/`applicant_id`・クエストの `join_request_received` と同型）／`auto_approve`・public は即 `approved` で通知なし。承認/却下したとき**申請者へ `contest_join_request_decided`**（✅・`params.result`）。通知クリックは `/contests/{id}`（運営はパーティタブで承認）。
- **ダッシュボード表示（I.1・SC-01）**＝運営（`is_contest_manager`）に `GET /dashboard` の `incoming_contest_requests`（未処理 requested＝コンテスト概要＋申請者）を返す。クエストの `incoming_join_requests` とは**別パネル**（データ/承認API/遷移先/承認スコープが異種＝カードUIは踏襲し隣接配置）。

## T.3 表彰・ランキング（既存基盤の再利用＋軸拡張）

| メソッド / パス | 概要 | 補足 |
|---|---|---|
| `GET /contests/{id}/ranking?axis=` | 成果/貢献ランキング | `axis ∈ {approve_votes, avg_score, contribution}`（設計 §6.1）。会期スコープ＝既存 `aggregate_ranking(start,end,quest_id)` を backing quest で流用 |

- **集計軸**＝賛成投票数（`votes type=approve`・会期内）／平均評価点（`evaluation_scores` submitted・既存評価コイン算定流用）／活動貢献（`activities reason in (chat,evaluation,vote)`・会期内＝新テーブル不要）／選定（`ideas.is_selected`）。
- **表彰付与**は T.1 `finalize` で実行（`prize_config` の上位N へ XP/コイン＋実績＋通知・冪等）。

## T.4 ②会社レベル能力の付与（`user_capabilities`・FR-47）

| メソッド / パス | 概要 | 補足 |
|---|---|---|
| `GET /admin/accounts/{uid}/capabilities`（管理者） | 当該ユーザーの有効能力一覧 | `info_curator`/`quest_create`/`contest_create`/`contest_evaluator` |
| `POST /admin/accounts/{uid}/capabilities`（管理者） | 能力付与（`{capability}`） | `UNIQUE(user_id,capability) WHERE revoked_at IS NULL`。付与=`company_account_admin`/`system_admin` |
| `DELETE /admin/accounts/{uid}/capabilities/{capability}`（管理者） | 能力剥奪（論理・`revoked_at`） | 行は残す（監査） |

- **単一レジストリ `user_capabilities`**（§5.63）＝既存 `info_curators` を統合（`capability='info_curator'`）。付与UIは会社アカウント管理（SC-93）系を踏襲（新規UIを増やさない）。
- **評価者ゲート**＝`contest_evaluator` 保持者のみコンテストアイデア評価可（会社横断・決定J'）。**クエスト作成**＝`quest_create`（移行は既存クエスト作成者に自動付与で維持・決定K）。

## T.5 アイデア→クエスト昇格（社内・FR-47）

| メソッド / パス | 概要 | 補足 |
|---|---|---|
| `POST /ideas/{id}/promote-to-quest`（要 `quest_create`） | **別実体の独立業務クエストへ種継ぎ**（内容コピー＝タイトル／本文＋狙う価値を `purpose` へ・作成者を owner でパーティー投入・初版リビジョン／`quests.origin_idea_id` で由来参照） | 決定H＝器クエストと業務クエストを混ぜない。コンセプト創造・検証（FR-42）以降へ接続。社内のみ（`public`/公開参加者には出さない） |

- **ゲート**＝`quest_create`（②会社レベル能力）または管理者（通常のクエスト作成 C.2 と同一＝`quests.application._can_create_quest`・一か所で一致）。能力なしは `403`（`capability_required`）。
- **社内のみ（決定O/P'）**＝`/ideas` 配下は公開モード外周ガード（access_gate）を素通りするため、**`public` 会社では application で明示 `404`（存在秘匿）**（コンテスト専用テナントでは管理者も不可）。
- **出し分け（SC-22・サーバー権威）**＝`GET /ideas/{id}` の `can_promote`＝コンテスト配下（`is_contest`）×非`public`×上記ゲートで `true`。frontend はこれで「🚀 クエストへ昇格」導線を表示（成功後は新クエストへ遷移）。

## T.6 既存規約準拠

- 認可はサーバー権威の会社スコープ（§1.6）／一覧はカーソル＋DataTable クエリ契約（§1.8）／変更系は Idempotency（§1.9・特に `finalize`）／リアルタイムは既存 WebSocket（§1.12・コンテスト配下アイデアのチャット/通知は既存チャネルを流用）。
- **アイデア投稿/編集/版/投票/フォロー＝D／評価＝F／チャット＝E／通知＝H／ランキング=G** を流用（本ドメインで重複定義しない）。本書は差分EPのみを定義する。
