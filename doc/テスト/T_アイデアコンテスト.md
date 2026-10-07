# T. アイデアコンテスト テストパターン（FR-46/47・API設計 T・データモデル §5.60-5.64）

> トレーサビリティ＝設計書→本 md（TC-ID・`根拠` 列）→テストコード（テスト規約 §5）。TC-ID は `T-TC-1xx`（api/int）・`T-TC-2xx`（e2e/unit）で採番。設計元＝[アイデアコンテスト機能 設計](../設計ドラフト/アイデアコンテスト機能_設計.md)。
>
> **状態＝TC 先出し（実装未着手・FR-46/47 Phase1）**。各 Step 着手時に本 md へ TC 行（`根拠` 付き）を追加してからコードを書く（md 無しでコード書かない・CLAUDE.md）。**アーキの芯＝クエストを器に再利用**＝アイデア/投票/評価/チャットは既存機構を無改修共有（本 md は差分＝枠/参加/能力/表彰/昇格と単一ポリシー解決のゲートを検証）。

## 1. コンテスト CRUD・会期・backing クエスト（T.1・§4・データモデル §5.60）

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| T-TC-101 | api | 作成＝`contest_create` 保持者のみ・backing quest を 1:1 生成 | `contest_create` 保持 | `POST /contests`（theme/mode=bounded/会期/prize_config） | 201・`contests` 1行＋`quest_id` の backing quest（UNIQUE）生成・一般（能力なし）は 403 | T.0/T.1／§5.60 |
| T-TC-102 | api | 状態遷移＝`draft→open→judging→closed→archived`・backing quest.status マップ | 作成済み | `PATCH /contests/{id}`（status 遷移） | 各状態で backing quest.status が対応値（recruiting/evaluating/completed）に／不正遷移は 409 `invalid_state` | T.1／§4.1 |
| T-TC-103 | api | 一覧＝会期タブ（開催中/予定/終了）・DataTable 契約 | 複数 contest（状態各種） | `GET /contests`（status 絞り込み/カーソル） | status 別に出る・§1.8 契約準拠 | T.1／§1.8 |
| T-TC-104 | api | 詳細＝アイデアタブ（応募中/入賞/殿堂入り/お蔵入り）を導出 | contest＋アイデア（is_selected/flags 各種） | `GET /contests/{id}` | タブが `contest_idea_flags`＋`is_selected` から正しく導出 | T.1／§4.2／§5.64 |
| T-TC-105 | api | 公開性は `access_mode` 一本化＝contest に visibility パラメータ無し | — | `POST /contests` に visibility 送信 | 無視/422（extra forbid）・公開性は会社設定のみ | §8.0／§3.1 |
| T-TC-106 | api | 削除＝`contest_create`/管理者のみ・論理削除（contest＋backing quest）／一般は403 | 作成済み | `DELETE /contests/{id}` | 管理者=204・一覧/詳細から消える（deleted_at）・子データは監査保持・一般は403 | T.1／§5.60 |
| T-TC-107 | api | 状態は隣接1段で**前進・後退とも可**（運営がやり直せる）・非隣接は409 | 作成済み（open 等） | `PATCH /contests/{id}`（status 後退） | open→draft／judging→open など隣接後退は200＋backing quest.status も同期・非隣接（judging→draft 等）は409 | T.1／§4.1 |

## 2. 参加の2階層（Tier1/Tier2）・単一ポリシー解決のゲート（T.2・§2.3・§5.1・データモデル §5.61/5.62）

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| T-TC-110 | api | Tier1 参加リクエスト→管理者承認で投票可（案X） | contest open・一般ユーザー | `POST /contests/{id}/participation`→管理者 `PATCH .../{uid}`（approved） | `contest_participants` requested→approved／承認後にコンテスト配下アイデアへ投票可（既存 D の投票EP）・未承認は 403 | T.2／§5.1／§6.1 |
| T-TC-111 | api | Tier2 参加リクエスト→**アイデア投稿者**承認でチャット可 | Tier1 承認済み・対象アイデアあり | `POST /ideas/{id}/participation`→投稿者 `PATCH .../{uid}`（approved） | `idea_participants` requested→approved／承認後にチャット可（既存 E）・投稿者以外の承認は 403 | T.2／§5.1 |
| T-TC-112 | api | 投票ゲート＝Tier1 開放・チャットゲート＝Tier2 承認（案X の分岐） | Tier1 のみ承認（Tier2 未） | コンテスト配下アイデアへ投票／チャット投稿 | 投票=可（Tier1）・チャット=403（Tier2 未承認） | §5.1／§2.3 |
| T-TC-113 | int | 単一ポリシー解決＝コンテスト配下は `can_view_contest` で可視分岐・通常クエストは従来ゲート（改訂 2026-10-04） | contest-backed quest（auto_approve 真偽）／通常 quest | `contests/access.py`（`contest_of`/`can_view_contest`/`can_vote`/`can_chat`/`can_evaluate`）＋`quests/repository.can_access_quest` 中央分岐 | コンテスト配下=`can_view_contest`（auto_approve OR 参加者 OR 運営 OR 作成者）で可視・承認制×未参加は不可＋Tier/審査員ゲート／通常=`contest_of`=None で従来パーティー＋部署ゲート（分岐が1モジュール） | §2.3 |
| T-TC-128 | int | `can_view_contest` 真理値＝可視ゲートの各条件（改訂 2026-10-04・ユーザー要件） | auto_approve 真偽 × 未参加/Tier1承認/運営(contest_create)/作成者 | `contests/access.can_view_contest(session, contest, user_id)` | auto_approve=true→全員 True／auto_approve=false×未参加→False／false×Tier1承認→True／false×運営→True／false×作成者→True | §2.3 |
| T-TC-129 | api | 承認制×未参加はコンテスト詳細/配下アイデア一覧/全文検索が 403・参加承認後は 200（can_access_quest 波及＋詳細明示ガード） | `auto_approve=false` の contest・未参加ユーザー | `GET /contests/{id}`／`GET /quests/{qid}/ideas`（backing quest）／`GET /quests/{qid}/search`→その後 Tier1 approved で再取得 | 未参加=すべて 403／Tier1 approved 後=すべて 200（アイデア一覧が見える） | §2.3／T.0 |
| T-TC-133 | api | ランキングは `can_view_contest` でゲート＝承認制×未参加は 403・auto_approve=true は誰でも 200 | `auto_approve=false`（未参加）／`auto_approve=true` の contest | `GET /contests/{id}/ranking?axis=approve_votes` | 承認制×未参加=403／auto_approve=true=200（会社内の誰でも） | §2.3／§6.1 |
| T-TC-134 | api | 一覧 item に応募導線用メタ（auto_approve/participant_count/my_status/description）＋直下 can_manage | 参加者 approved 数が既知の contest・運営/一般ユーザー | `GET /contests` | 各 item に `auto_approve`・`participant_count`（approved 数）・`my_status`（none/approved 等）・`description`／応答直下 `can_manage`＝運営=true・一般=false | T.1／SC-53 |
| T-TC-114 | api | public/DEMO の Tier1 自動 approved（決定G） | `access_mode=public`・サインアップ直後 | `POST /contests/{id}/participation` | 即 `approved`（閲覧＋投稿＋投票がすぐ可） | §8.2／決定G |
| T-TC-115 | api | コンテスト配下のアイデア投稿＝Tier1 参加者に開放（§5.1 の「自分のアイデア投稿」・単一ポリシー） | Tier1 承認済み/未参加（いずれも非クエストメンバー） | コンテスト backing quest へ `POST /quests/{qid}/ideas` | Tier1 承認済み=201（member/idea_create 権限は不要）・未参加=403 | §5.1／§2.3 |
| T-TC-116 | api | 参加承認はコンテスト単位で選べる＝`auto_approve=true` なら社内でも即 approved（オープン参加） | 社内会社・`auto_approve=true` の contest | `POST /contests/{id}/participation`（本人） | 即 `approved`（承認待ちにならず投稿/投票可）／既定（false）は従来どおり `requested` | T.2／FR-46 |
| T-TC-117 | api | 詳細の `my_participating_idea_ids`＝自分が投稿者 or Tier2承認のアイデア（SC-54「新着の議論」の限定根拠） | コンテスト＋アイデア・Tier2 承認済み/未参加ユーザー | `GET /contests/{id}` | Tier2 承認者の応答に当該 idea_id を含む・未参加者は含まない | T.1／§5.1 |
| T-TC-118 | api | 参加者一覧（パーティタブ）＝運営のみ・承認待ちを先頭／一般は403 | Tier1 リクエスト済み | `GET /contests/{id}/participants` | 管理者=200・requested を先頭に一覧／一般（権限なし）は403・`can_manage` も false | T.2／T.0 |
| T-TC-119 | api | パーティタブ運営操作＝審査員付与/剥奪・参加者 is_evaluator・詳細に主催者・排除(論理) | 参加者（approved）あり | `PATCH /contests/{id}/participants/{uid}/evaluator`／`GET /participants`／`GET /contests/{id}`／`PATCH .../participation/{uid}` rejected | granted=true で is_evaluator=true・false で解除／詳細に owner_display_name／排除は status=rejected（運営のみ） | T.2／§5.3／T.0 |
| T-TC-124 | api | パーティ直接追加＝会社ユーザー候補（既参加/主催者除外・運営のみ）＋PATCH approved で即参加 | 会社に複数ユーザー | `GET /contests/{id}/participant-candidates?q=`／`PATCH .../participation/{uid}` approved | 候補に会社ユーザーを含み主催者/既参加は除外・一般は403／承認で候補から消え参加中に入る | T.2／T.0／FR-38候補基盤 |
| T-TC-125 | api | コンテスト配下アイデアの詳細は `is_contest=true`（SC-22 で関連情報を非表示）・通常クエストは false | コンテスト配下アイデア／通常クエストのアイデア | `GET /ideas/{id}` | コンテスト配下=is_contest true／通常=false | §2.3／FR-46 |
| T-TC-126 | api | 運営がアイデアを入賞/殿堂入り/お蔵入りへ手動振り分け（SC-54 動線）・一般は403 | コンテスト配下アイデア | `PATCH /contests/{id}/ideas/{iid}/flags`（flag=selected/hall_of_fame/shelved・on） | selected→is_selected・hall_of_fame/shelved→contest_idea_flags 付与/解除（詳細 flags に反映）・一般は403・他コンテストのアイデアは404・**排他（他状態を自動解除）** | T.1／§4.2／§5.64 |
| T-TC-127 | api | Tier2 参加文脈（SC-22/SC-24 導線）＝コンテスト配下か・投稿者か・自分の状態・申請一覧 | コンテスト配下アイデア・投稿者/希望者 | `GET /ideas/{id}/participation` | 投稿者=is_author true＋requests に申請一覧／希望者はリクエスト→requested／投稿者承認で approved／非コンテストは is_contest false | T.2／§5.1 |
| T-TC-135 | api | Tier1 参加リクエスト（承認制）で**運営へ通知** `contest_join_request_received`／auto_approve・public は通知なし（即承認のため） | 承認制 contest・運営（作成者/contest_create）・申請者 | `POST /contests/{id}/participation`（本人）→運営の `GET /notifications` | 運営に `contest_join_request_received`（applicant_id/contest_id params）／申請者本人には出ない／auto_approve/public は requested にならず通知0 | T.2／H.2／FR-46 |
| T-TC-136 | api | Tier1 承認/却下で**申請者へ通知** `contest_join_request_decided`（result=approved/rejected） | 承認制 contest・requested 済み | `PATCH /contests/{id}/participation/{uid}`（運営・approved/rejected）→申請者の `GET /notifications` | 申請者に `contest_join_request_decided`（result 一致・contest_id params）／運営自身には出ない | T.2／H.2 |
| T-TC-202 | api | **自己退席**（本人）＝approved→`left`（decided_by=本人）／管理者排除は `rejected`（decided_by=管理者）＝**主体を区別** | auto_approve の open contest・参加者本人/管理者 | 本人 `DELETE /contests/{id}/participation`→`contest_participants` 直読／再参加後に管理者 `PATCH .../{uid}`(rejected) | 自己退席＝`status=left`・`decided_by_id=本人`／未参加で DELETE は 409／管理者排除＝`status=rejected`・`decided_by_id=管理者`（left と区別できる＝自主退席か管理者による退席か判別可能） | T.2／FR-46／ユーザー要望 |
| T-TC-203 | api | ContestDetail.`my_status`＝閲覧者の Tier1 参加状態（タブ出し分け・参加/退席トグルの根拠） | auto_approve の open contest・本人 | `GET /contests/{id}` を 参加前/参加後/退席後 で取得 | 参加前=`my_status:"none"`／参加後=`"approved"`／退席後=`"left"`（フロントは approved でタブ表示＋退席ボタン・それ以外は参加ボタン） | T.1／SC-54／ユーザー要望 |
| T-TC-137 | api | ダッシュボードの**未処理コンテスト参加リクエスト**＝運営に requested を返す・一般は空 | 承認制 contest・requested 1件・運営/一般 | `GET /dashboard`（`incoming_contest_requests`） | 運営=当該 contest 概要＋申請者を含む／一般（運営でない）=空配列 | I.1／T.2／SC-01 |
| T-TC-138 | api | コンテストの **backing quest はクエスト系の一覧に出ない**（内部の器・ユーザーにはコンテストとしてのみ可視） | contest（backing quest あり）・作成者/一般 | 作成者 `GET /quests`（SC-10・自分のクエスト）／`GET /quests/catalog`（SC-13 発見） | どちらの一覧にも backing quest.id を**含まない**（作成者の自分一覧にも出ない＝owner別格でも除外） | §2.2／FR-46 |
| T-TC-139 | api | backing quest は**クエストとして発見/参加/詳細不可**（器を内部に閉じる・サーバーガード） | contest（backing quest あり） | `GET /quests/{backing}`／`POST /quests/{backing}/join-request`／`POST /quests/{backing}/follow` | 詳細=404・参加リクエスト=404（存在秘匿・`can_discover_quest`）・フォロー=404／アイデア一覧 `GET /quests/{backing}/ideas` は従来どおり可（コンテスト内部経路は can_access_quest 経由で無影響） | §2.2／FR-46 |
| T-TC-141 | api | 参加リクエスト承認の判断材料プロフィール＝運営のみ・コンテスト内活動＋ゲーム層・申請のない user は404 | 承認制 contest・requested 済み・運営/一般 | `GET /contests/{id}/participation/{uid}/profile` | 運営=200（posted_idea_count/vote_count/chat_message_count＋game〔モードON時〕）／一般（運営でない）=403／未申請 user=404（存在秘匿） | T.2／C.9.1／SC-01/SC-54 |

## 2b. 公開モード外周アクセスゲート（FR-48 §8.0・決定O・2026-10-04／存在秘匿 404 化 決定P'・2026-10-07）

> `companies.access_mode='public'`（コンテスト専用テナント）＝役割別許可リスト外のEPをサーバーで 404＝存在秘匿（`not_found`・決定P'・UI非依存・§1.6）。可視ゲート（§2.3）とは直交する2段目の外周ガード。実装＝`app/core/access_gate.py`（middleware・全/api/v1 一律）＋frontend 業務ルート群 `layout.tsx` の `requireNotPublicMode()`（`notFound()`）。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| T-TC-204 | unit | 許可判定（純関数）＝コンテスト許可リストは全ロール可／管理許可リストは管理者のみ追加／業務EPは管理者でも不可（決定O） | `access_gate.is_path_allowed(sub, is_admin)`（実パスは /api/v1 以降・auth は /auth/*・管理系は /admin/*） | contest系（/contests・/ideas・/chat-messages・/attachments・/me・/notifications・/announcements〔read〕・/auth/session）／admin系（/admin/companies・/admin/accounts・/admin/quest-groups・/admin/announcements〔管理〕）／業務系（/quests・/quests/{id}/search・/concepts・/dashboard）を general/admin で判定 | contest系＝general/admin とも True（お知らせ read 含む）／admin系＝admin のみ True・general False（お知らせ管理 /admin/announcements 含む）／業務系＝general/admin とも False（公開会社はコンテスト専用・コンテスト内検索は /quests 配下ゆえ当面不可） | §8.0／決定O／SC-95 §4.6 |
| T-TC-205 | int | public 会社は許可リスト外を 404＝存在秘匿・コンテスト系は素通し／private は不変（middleware 外周ガード） | シード会社を access_mode=public とみなす（`access_gate._resolve` を monkeypatch）・一般ログイン | `GET /quests`（業務）／`GET /contests`（コンテスト）を public で／private（非patch）で `GET /quests` | public×general＝`/quests` 404 `not_found`・`/contests` は 404 以外（ゲート非該当）／private＝`/quests` は 404 にならない（従来どおり） | §8.0／§1.6／決定P' |

## 3. 評価（審査員）・②会社レベル能力（T.0/T.4・§5.2/§5.3・データモデル §5.63）

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| T-TC-120 | api | 評価は `contest_evaluator` 保持者のみ（偏り防止・既存Fを流用） | 審査員能力あり/なしのユーザー | コンテスト配下アイデアへ評価（既存 F の評価EP） | 審査員=可・非保持=403（投稿者でも不可＝運営指名のみ） | §5.2／T.0 |
| T-TC-121 | api | 能力付与/剥奪＝管理者のみ・UNIQUE(user,capability) WHERE revoked_at NULL | admin／一般 | `POST /admin/accounts/{uid}/capabilities`（contest_evaluator）／`DELETE .../{capability}` | admin=200（1行有効）・一般=403・剥奪は論理（revoked_at）・二重付与は1行 | T.4／§5.63 |
| T-TC-122 | int | `info_curator` も user_capabilities へ統合（情報判定が能力レジストリで引ける） | 旧 info_curator 相当 | `user_capabilities(capability='info_curator')` 判定 | 情報インプットの判定権限が本表で解決（統合・移行整合） | §5.3／§5.63 |
| T-TC-123 | api | `quest_create` ゲート＝保持者のみクエスト作成（移行は既存作成者に自動付与） | quest_create 保持/非保持 | `POST /quests` | 保持=201・非保持=403／移行で既存クエスト作成者は保持（決定K） | §7／§5.3 |
| T-TC-208 | api | 能力保有者一覧（汎用付与UI・SC-93）＝任意能力の保有者を account_id/氏名/付与者/付与日で返す・管理者のみ | admin／一般・付与済みユーザー | `GET /admin/capabilities/{capability}/holders`（contest_create を付与→取得→剥奪→消える） | admin=200（付与者名＋付与日時つき・付与日時降順）・一般=403・未知能力=422・剥奪後は一覧から消える（revoked_at） | T.4／§5.63／FR-47 |

## 4. 表彰・ランキング（T.1 finalize/T.3・§6・既存基盤再利用）

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| T-TC-130 | api | ランキング軸＝賛成投票数/平均評価点/活動貢献（会期スコープ） | 会期内に投票/評価/活動 | `GET /contests/{id}/ranking?axis=` | 各軸が backing quest×[starts_at,ends_at) で集計（`repo.rank_approve_votes`/`rank_avg_score`/`rank_contribution`＝votes/evaluation_scores/activities を直接集計）・成果軸は idea_id＋投稿者/貢献軸は user_id・新テーブル不要・不正 axis は 422 | T.3／§6.1 |
| T-TC-131 | int | 表彰確定＝上位N へ XP/コイン付与（冪等 reason='contest_award'）＋入賞実績＋is_selected＋殿堂入り＋通知 | judging の contest＋prize_config | `POST /contests/{id}/finalize`（Idempotency） | judging→closed・XP/コインはユーザー単位で軸横断合算し1回ずつ（`grant_exists_by_ref` 冪等・ref=(contests,id)）・入賞バッジ＝順位→tier（1位gold/2位silver/3位bronze＝`contest_award_{tier}`・migration 0052）・成果軸1位は `hall_of_fame`・`ideas.is_selected=true`・通知／再実行は `granted_now=0`（二重付与なし） | T.1／§6.2／§1.9 |
| T-TC-132 | int | 殿堂入り/お蔵入り＝`contest_idea_flags`（ideas 無改修）・rolling は自動お蔵入り | rolling contest＋期限超過アイデア | `contest_app.auto_shelve_expired`（自動アーカイブ・スケジューラ後追いの明示トリガ） | rolling×`auto_archive_days` 超過の公開アイデアに `shelved` 冪等付与・`ideas` スキーマ不変・bounded/未設定は no-op | §4.2／§5.64 |

## 5. アイデア→クエスト昇格（T.5・§7・データモデル quests.origin_idea_id）

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| T-TC-140 | api | 昇格＝別実体の独立業務クエスト生成＋由来参照・要 `quest_create`・社内のみ | コンテストの有望アイデア・quest_create 保持 | `POST /ideas/{id}/promote-to-quest` | 新クエスト（内容コピー・`origin_idea_id` 保持・作成者=owner でパーティー投入）／能力なしは 403（`capability_required`） | T.5／§7／決定H |
| T-TC-140b | api | 昇格は社内のみ＝`public`（コンテスト専用テナント）では業務機能として存在しない＝404（存在秘匿） | `public` 会社セッション・quest_create 保持 | `POST /ideas/{id}/promote-to-quest` | `404`（`not_found`）＝`/ideas` 配下は外周ガードを素通りするため application で明示 404（管理者でも不可） | 決定O／決定P'／§8.0／T.5 |
| T-TC-140c | api | 昇格導線の出し分け＝`GET /ideas/{id}.can_promote`（SC-22・サーバー権威） | コンテスト配下アイデア（auto_approve で閲覧可） | `GET /ideas/{id}` | `can_promote`＝`quest_create`/管理者で `true`・非保持は `false`（ゲートは POST と同一＝`_can_create_quest`×非public） | T.5／§7／FR-47 |
| T-TC-140d | api | 昇格クエストの出典URL＝由来アイデアへの内部リンク（可視リンク・機械リンク origin_idea_id と併存） | コンテスト配下アイデア・quest_create 保持 | `POST /ideas/{id}/promote-to-quest` | 応答 `source_url == /ideas/{origin_idea_id}`（情報インプットの出典URLと同趣旨・内部パス） | T.5／§7／FR-47 |

## 6. 公開/非公開モード 外周ガード（§8.0・A.11.1／e2e 含む）

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| T-TC-150 | api | public×general は非コンテストEPを 404＝存在秘匿（許可リスト外） | `access_mode=public`・role=general | 非コンテストEP（例 `GET /quests`）呼び出し | 404 `not_found`／コンテスト系（T・配下 D/E/F）は 200 | §8.0／README §1.6／決定P' |
| T-TC-151 | api | public でも管理者は管理系EP保持（決定O・業務EPは管理者でも 404） | `access_mode=public`・company_account_admin | 管理系EP／業務EP | 管理系＝200／業務系＝404 `not_found`（決定O） | §8.0／決定O／決定P' |
| T-TC-201 | e2e | public 会社はSC-53 着地・SC-01 を出さない・クエスト系リンク非表示（決定P） | public 会社ログイン | ログイン後の着地/ナビ確認 | SC-53 着地・SC-01 非描画・クエスト系 `<Link>` なし（UIと403の二重封鎖） | §8.0／決定P |

## 7. SC-54 非参加運営の表示制御（frontend 純関数・⑤・受入指摘）

> 承認制×未参加でも **運営（can_manage）は `can_view_contest` を通り 200**＝既に全タブが見える。⑤はこれを「パーティは機能／アイデア・全文検索は中身をガード／特定ユーザが分かるパネル（表彰台・新着議論・活動）は秘匿」に絞る**frontend のみの表示制御**。backend・可視ポリシーは無改修。一般ユーザー（invite）・参加者（participant）は現状不変。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| T-TC-206 | unit | 閲覧モード判定（純関数）＝参加者/非参加運営/非参加一般・**ガードは承認制のみ** | `contestViewMode({can_manage, my_status, auto_approve})` | approved／(can_manage×非approved×auto_approve真偽)／(非can_manage×非approved) を判定 | approved→`participant`／**承認制(auto_approve=false)×can_manage×未参加→`manager-guard`**／**auto_approve=true×can_manage×未参加→`participant`**（公開＝運営も全表示・一般invite が表彰台を見えるのと逆転させない）／非運営×未参加→`invite`（my_status 未設定は none 扱い） | SC-54／⑤ |
| T-TC-207 | unit | モード別表示フラグ（純関数）＝DRY の単一ソース（描画側が参照） | `contestViewFlags(...)` | 各モードの showTabs/showIdentifying/guardContent/fetchContent | participant=(t,t,f,t)／manager-guard=(t,**f**,**t**,**f**)＝パネル秘匿+タブ中身ガード+識別データ非取得／invite=(f,t,f,t)＝一般は現状不変 | SC-54／⑤ |
