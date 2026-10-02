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

## 2. 参加の2階層（Tier1/Tier2）・単一ポリシー解決のゲート（T.2・§2.3・§5.1・データモデル §5.61/5.62）

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| T-TC-110 | api | Tier1 参加リクエスト→管理者承認で投票可（案X） | contest open・一般ユーザー | `POST /contests/{id}/participation`→管理者 `PATCH .../{uid}`（approved） | `contest_participants` requested→approved／承認後にコンテスト配下アイデアへ投票可（既存 D の投票EP）・未承認は 403 | T.2／§5.1／§6.1 |
| T-TC-111 | api | Tier2 参加リクエスト→**アイデア投稿者**承認でチャット可 | Tier1 承認済み・対象アイデアあり | `POST /ideas/{id}/participation`→投稿者 `PATCH .../{uid}`（approved） | `idea_participants` requested→approved／承認後にチャット可（既存 E）・投稿者以外の承認は 403 | T.2／§5.1 |
| T-TC-112 | api | 投票ゲート＝Tier1 開放・チャットゲート＝Tier2 承認（案X の分岐） | Tier1 のみ承認（Tier2 未） | コンテスト配下アイデアへ投票／チャット投稿 | 投票=可（Tier1）・チャット=403（Tier2 未承認） | §5.1／§2.3 |
| T-TC-113 | int | 単一ポリシー解決＝コンテスト配下は会社全体可視・通常クエストは従来ゲート | contest-backed quest／通常 quest | `resolve_idea_access(quest,user)` | コンテスト配下=会社全員可視＋Tier/審査員ゲート／通常=パーティー＋部署ゲート（分岐が1関数） | §2.3 |
| T-TC-114 | api | public/DEMO の Tier1 自動 approved（決定G） | `access_mode=public`・サインアップ直後 | `POST /contests/{id}/participation` | 即 `approved`（閲覧＋投稿＋投票がすぐ可） | §8.2／決定G |

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
| T-TC-130 | api | ランキング軸＝賛成投票数/平均評価点/活動貢献（会期スコープ） | 会期内に投票/評価/活動 | `GET /contests/{id}/ranking?axis=` | 各軸が会期内データで集計（既存 aggregate_ranking を backing quest で流用）・新テーブル不要 | T.3／§6.1 |
| T-TC-131 | int | 表彰確定＝上位N へ XP/コイン付与（冪等 reason='contest_award'）＋入賞実績＋is_selected＋通知 | judging の contest＋prize_config | `POST /contests/{id}/finalize`（Idempotency） | 上位N へ `ledger.grant`（二重付与なし）・achievements（bronze/silver/gold）・`ideas.is_selected=true`・通知／再実行で重複付与しない | T.1／§6.2／§1.9 |
| T-TC-132 | int | 殿堂入り/お蔵入り＝`contest_idea_flags`（ideas 無改修）・rolling は自動お蔵入り | rolling contest＋期限超過アイデア | 自動アーカイブ処理 | `shelved` 自動付与・タブ導出が変わる・`ideas` スキーマ不変 | §4.2／§5.64 |

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
