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
| T-TC-113 | int | 単一ポリシー解決＝コンテスト配下は会社全体可視・通常クエストは従来ゲート | contest-backed quest／通常 quest | `contests/access.py`（`contest_of`/`can_vote`/`can_chat`/`can_evaluate`）＋`quests/repository.can_access_quest` 中央分岐 | コンテスト配下=会社全員可視（非パーティー員でも可）＋Tier/審査員ゲート／通常=`contest_of`=None で従来パーティー＋部署ゲート（分岐が1モジュール） | §2.3 |
| T-TC-114 | api | public/DEMO の Tier1 自動 approved（決定G） | `access_mode=public`・サインアップ直後 | `POST /contests/{id}/participation` | 即 `approved`（閲覧＋投稿＋投票がすぐ可） | §8.2／決定G |
| T-TC-115 | api | コンテスト配下のアイデア投稿＝Tier1 参加者に開放（§5.1 の「自分のアイデア投稿」・単一ポリシー） | Tier1 承認済み/未参加（いずれも非クエストメンバー） | コンテスト backing quest へ `POST /quests/{qid}/ideas` | Tier1 承認済み=201（member/idea_create 権限は不要）・未参加=403 | §5.1／§2.3 |
| T-TC-116 | api | 参加承認はコンテスト単位で選べる＝`auto_approve=true` なら社内でも即 approved（オープン参加） | 社内会社・`auto_approve=true` の contest | `POST /contests/{id}/participation`（本人） | 即 `approved`（承認待ちにならず投稿/投票可）／既定（false）は従来どおり `requested` | T.2／FR-46 |

## 3. 評価（審査員）・②会社レベル能力（T.0/T.4・§5.2/§5.3・データモデル §5.63）

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| T-TC-120 | api | 評価は `contest_evaluator` 保持者のみ（偏り防止・既存Fを流用） | 審査員能力あり/なしのユーザー | コンテスト配下アイデアへ評価（既存 F の評価EP） | 審査員=可・非保持=403（投稿者でも不可＝運営指名のみ） | §5.2／T.0 |
| T-TC-121 | api | 能力付与/剥奪＝管理者のみ・UNIQUE(user,capability) WHERE revoked_at NULL | admin／一般 | `POST /admin/accounts/{uid}/capabilities`（contest_evaluator）／`DELETE .../{capability}` | admin=200（1行有効）・一般=403・剥奪は論理（revoked_at）・二重付与は1行 | T.4／§5.63 |
| T-TC-122 | int | `info_curator` も user_capabilities へ統合（情報判定が能力レジストリで引ける） | 旧 info_curator 相当 | `user_capabilities(capability='info_curator')` 判定 | 情報インプットの判定権限が本表で解決（統合・移行整合） | §5.3／§5.63 |
| T-TC-123 | api | `quest_create` ゲート＝保持者のみクエスト作成（移行は既存作成者に自動付与） | quest_create 保持/非保持 | `POST /quests` | 保持=201・非保持=403／移行で既存クエスト作成者は保持（決定K） | §7／§5.3 |

## 4. 表彰・ランキング（T.1 finalize/T.3・§6・既存基盤再利用）

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| T-TC-130 | api | ランキング軸＝賛成投票数/平均評価点/活動貢献（会期スコープ） | 会期内に投票/評価/活動 | `GET /contests/{id}/ranking?axis=` | 各軸が backing quest×[starts_at,ends_at) で集計（`repo.rank_approve_votes`/`rank_avg_score`/`rank_contribution`＝votes/evaluation_scores/activities を直接集計）・成果軸は idea_id＋投稿者/貢献軸は user_id・新テーブル不要・不正 axis は 422 | T.3／§6.1 |
| T-TC-131 | int | 表彰確定＝上位N へ XP/コイン付与（冪等 reason='contest_award'）＋入賞実績＋is_selected＋殿堂入り＋通知 | judging の contest＋prize_config | `POST /contests/{id}/finalize`（Idempotency） | judging→closed・XP/コインはユーザー単位で軸横断合算し1回ずつ（`grant_exists_by_ref` 冪等・ref=(contests,id)）・入賞バッジ＝順位→tier（1位gold/2位silver/3位bronze＝`contest_award_{tier}`・migration 0052）・成果軸1位は `hall_of_fame`・`ideas.is_selected=true`・通知／再実行は `granted_now=0`（二重付与なし） | T.1／§6.2／§1.9 |
| T-TC-132 | int | 殿堂入り/お蔵入り＝`contest_idea_flags`（ideas 無改修）・rolling は自動お蔵入り | rolling contest＋期限超過アイデア | `contest_app.auto_shelve_expired`（自動アーカイブ・スケジューラ後追いの明示トリガ） | rolling×`auto_archive_days` 超過の公開アイデアに `shelved` 冪等付与・`ideas` スキーマ不変・bounded/未設定は no-op | §4.2／§5.64 |

## 5. アイデア→クエスト昇格（T.5・§7・データモデル quests.origin_idea_id）

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| T-TC-140 | api | 昇格＝別実体の独立業務クエスト生成＋由来参照・要 `quest_create`・社内のみ | コンテストの有望アイデア・quest_create 保持 | `POST /ideas/{id}/promote-to-quest` | 新クエスト（内容コピー・`origin_idea_id` 保持）／能力なしは 403／`public` 参加者には導線なし | T.5／§7／決定H |

## 6. 公開/非公開モード 外周ガード（§8.0・A.11.1／e2e 含む）

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| T-TC-150 | api | public×general は非コンテストEPを 403（許可リスト外） | `access_mode=public`・role=general | 非コンテストEP（例 `GET /quests`）呼び出し | 403 `forbidden`／コンテスト系（T・配下 D/E/F）は 200 | §8.0／README §1.6 |
| T-TC-151 | api | public でも管理者は管理系EP保持（決定O） | `access_mode=public`・company_account_admin | 管理系EP | 200（403 は role=general のみ） | §8.0／決定O |
| T-TC-201 | e2e | public 会社はSC-53 着地・SC-01 を出さない・クエスト系リンク非表示（決定P） | public 会社ログイン | ログイン後の着地/ナビ確認 | SC-53 着地・SC-01 非描画・クエスト系 `<Link>` なし（UIと403の二重封鎖） | §8.0／決定P |
