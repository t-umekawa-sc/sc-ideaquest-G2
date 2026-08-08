# 作業引き継ぎ (handoff)

> 次回セッション開始時に **このファイルだけ読めば作業を再開できる** ことを目的とした引き継ぎメモ。
> 読者は「このセッションの記憶が一切ない次回の自分」。会話ログは参照不可。詳細仕様は必ず `doc/要件定義/README.md`（唯一の要件定義書）と `doc/API設計/` を参照。
> 毎回このファイルは全文を上書きする（履歴は git に任せる）。
>
> **次回の開始点＝実装スキャフォールド進行中（§7-(3)）**。方針＝「少しずつ／まずログイン(状態A)が動くまで」を **設計書→テストパターン→テストコード** の連鎖で。ツール＝Alembic＋SQLAlchemy(同期)。
> 完了＝docs 先行（`57e4f20`）＋**Chunk 1＝起動する骨格（`f8f4db9`・compose+2プレーンDB+マイグレ+シード+healthz、起動確認済み）**。
> **次は Chunk 2＝認証エンドポイント**（`app/core` に session/CSRF/errors/deps 追加→4層で `/api/v1/auth/{login,session,logout}`）→ Chunk 3＝A_認証.md の pytest 実装 → Chunk 4＝フロント SC-00 配線＋つなぎ md＋e2e。過去フェーズ＝L 確認完了・A〜L 横断再レビュー完了（drift 修正=`6d72e5b`）。残る仕上げパス＝門番表記2系統の統一（最終パス）。

---

## 1. 最終更新日時 / ブランチ / 最新コミット

- 最終更新: **2026-08-08 JST**（セッション終了時）
- ブランチ: **main**（`origin/main` と同期・作業ツリー クリーン＝確認済み）
- 最新コミット: **`8278f6a`**（handoff: ドメインL 詳細確定を記録）。その本文コミットが **`16d1774`**（API設計 ドメインL 詳細確定＝A〜L 全完了）。
  - ※**本 handoff（セッション終了版）更新コミットはこの直後**。今回は本体（`doc/API設計/` 等）の変更は無く **handoff のみの単独コミット**（2段方式の本体が無い＝handoff だけを更新）。
- remote: `https://github.com/t-umekawa-sc/sc-ideaquest-G2.git`
- **プッシュ状況**: `8278f6a` まで origin 反映済み。**本 handoff 更新は本作業でコミット＆プッシュする**。
- 直近の主なコミット（新しい順）:
  - `8278f6a` handoff: ドメインL 詳細確定を記録
  - `16d1774` API設計 ドメインL 詳細確定（リアルタイム配信・WebSocket＝A〜L 全完了）
  - `0f86dbe` API設計 ドメインK 詳細確定（プロフィール・背景画像）
  - `16d1774` の前は J（`7a5cf47`/`bbf8a41`/`d68ebff`）・K（`0f86dbe`）等

---

## 2. このプロジェクトのゴール

- **ideaquest**＝社内のアイデア創出をゲーミフィケーション（XP/コイン/レベル/魔法/ランキング）で促す **WEB アプリ**（マルチテナント SaaS・管理DB1＋会社DB N）。
- スタック＝フロント Next.js／バック FastAPI／PostgreSQL（全文検索 PGroonga）／Redis／MinIO／Docker。
- 現在は **実装前の設計フェーズの最終盤**＝**API設計 A〜L が全確定**。次は横断再レビュー→実装スキャフォールド。

---

## 3. 今回やったこと — 変更ファイルと理由

今セッション＝**API設計の残りドメインを確定し A〜L を完了**＋規約1件追記＋既存ドメインの整合修正。変更は **ドキュメントのみ**（コードは無い）。各項目「本体→handoff にハッシュ追記」の2段コミット・プッシュ済み。

- **H レビュー反映**（`bb36a79`）: `notify()` 責務をA案で確定（宛先解決＝発火ドメイン／畳み込み＝H 純粋 domain／INSERT＋Redis publish＝H repository・post-commit）＋B-1〜C-6（同UoW→post-commit・Redis publish は H・`ref_idea_id` 追記・meta 是正・K 発火元・冪等 at-most-once 等）。波及＝H/D.4/E.7/README §1.4。
- **I ダッシュボード集約**（`b7644d5`）: `doc/API設計/I_ダッシュボード集約.md` 新規。**集約1本 `GET /dashboard`**／I は読取合成の殻（新業務ロジック無し）／横断 read（下書き/未投票/フォロー中アイデア・下書き評価）は **D/F の repository に追加し I が合成**（別 EP 新設なし）／ヒーロー残高は当面 I（後に K の `GET /me` 正準化で整理）。
- **規約 §2.3「DRY」追記**（`966943b`）: `doc/規約/コーディング規約.md` に §2.3「DRY（単一の情報源）と重複許容の線引き」を新設（知識の正は1箇所＋過剰抽象を避ける限界）。
- **ログインボーナス付与契機の一般化**（`61c4a4a`）: 「A のログイン成功時のみ」→**「新しい暦日（JST）の最初の認証済みリクエスト」**（判定=純粋 `daily_login_bonus_due`／付与=冪等台帳 `activities(reason=login)` をユーザー×JST日で1回／契機=セッション解決依存性）。反映＝A.1/G.6/データモデル §7・activities 注記/SC-00 §10/I.1。
- **J 全文検索**（`d68ebff`/`bbf8a41`/`7a5cf47`）: `doc/API設計/J_全文検索.md` 新規。PGroonga 横断（ideas/chat_messages/attachments）／スコープ2種（`GET /quests/{id}/search`・`GET /search`）／**可視範囲は索引でなく WHERE で強制**（下書き除外・completed 可・非トゥームストーン）／結果 UNION score 降順・**オフセットページング**・同期索引。**門番＝パーティー所属＋クエストグループ所属の AND**（C.0 と同一・`bbf8a41` で精緻化）。J.5 に `pgroonga_snippet_html` の出力形（ユーザー文のみエスケープ＋タグは生 HTML・二重エスケープでない・デコード工程なし）を明記（`7a5cf47`・公式ドキュメントで確認済）。
- **K プロフィール・背景画像**（`0f86dbe`）: `doc/API設計/K_プロフィール・背景画像.md` 新規。**`display_name` 源泉＝管理DB `accounts`（1b・`accounts.display_name` 列追加・`users` はミラー）**＝identity 源泉一元化（ユーザー選択）／`GET /me` 正準（I の hero と両立）／`PATCH /me`＝display_name/locale（accounts+outbox の単一制御プレーン Tx）／`POST /me/password`（現在PW再確認→§A.9-③＋H 通知）／`POST /me/email`（再認証）／画像は会社DB `users` 直接＋署名URL。データモデル §4.2/§5.3 更新（列追加のみ・テーブル数不変）。
- **L リアルタイム配信**（`16d1774`）: `doc/API設計/L_リアルタイム配信.md` 新規。`GET /realtime`（Cookie 認証・`company_id` バインド）／**配信専用**（L は購読→WS 転送のみ・publish しない）／トピック（常時 `notifications:{user_id}`・動的 `chat:{chat_group_id}`＝購読時に門番検証）／**イベント type を canonical ドット記法に統一**（`chat.message.*`/`chat.reaction.*`/`notification.*`）／**publisher＝chat は E・notifications は H の `notify()`**／購読中の認可失効＝除去時ドロップ＋再接続再検証。波及＝README §2-L/§1.14・E.7（event 名を canonical 化）。

**今セッション末の状態**: ユーザーが `L_リアルタイム配信.md` を内容確認する段階に入り、その後に「API設計 A〜L の横断再レビュー」を私に依頼する合意ができた（＝次回の最優先タスク・§7）。

---

## 4. 現在の状態 — 動いているもの / 壊れているもの / テスト

- **リポジトリは `doc/`・`CLAUDE.md`・`handoff.md` のみ**（確認済み）。アプリのコード・`compose`・テストは**未着手＝存在しない**（`doc/画面設計/mocks/shared.js` はモック用資産）。
- **壊れているもの**: なし（作業ツリー クリーン＝確認済み）。
- **テスト**: 自動テストは無い（コード未着手）。
- **ドキュメント整合の状態（重要）**: 各ドメインは**単体レビューで確定**しているが、**A〜L を通した横断整合の再レビューは未実施**＝**矛盾/drift が残っていないかは未確認**（＝次回の最優先タスク §7-(2)）。今セッション中に見つけて直した整合の例＝H の post-commit/publish 責務・J の門番（パーティー＋グループ AND）・L の event 名 canonical 化。**それ以外に未検出の矛盾がある可能性は否定できない（未確認）**。
- **API設計の進捗（`doc/API設計/` 実在・確認済み）**: **A〜L の全12ドメインに個別ファイルあり・README §2 一覧で全て ✅**。
- 成果物の所在:
  - `CLAUDE.md`（直下・規約自動参照の入口）
  - `doc/要件定義/README.md`（唯一の要件定義書）
  - `doc/データモデル.md`（管理DB6＋**会社DB29テーブル**・§6 PGroonga・`accounts.display_name` 追加済）＋`.pdf`（派生・追跡外）
  - `doc/API設計/`（`README.md`＝全体規約 §1＋§2目次／`A_…`〜`L_リアルタイム配信.md` の**12ドメイン全確定**）
  - `doc/規約/`（`ドキュメント作成規約.md`〔汎用〕／`コーディング規約.md`〔§2.3 DRY・§3.1 4層・§3.4 ディレクトリ・§3.5 意図的選択・§4.1 フロント構成〕）
  - `doc/画面設計/`（`screens/` の SC-xx md・`mocks/` html〔入口 `mocks/index.html`〕・`デザイン標準.md`・`画面遷移図.md`）
  - `doc/WEBアプリ開発時のセキュリティ対策一覧.md`（OWASP系・規約 §2.2 で義務化）

---

## 5. 詰まっている点 — 失敗したアプローチと理由

- **現時点でブロッカーは無い**。API設計は全ドメイン確定。
- **今セッション内で「採用→撤回」した検討はない**（各論点は初回提示の推奨どおり確定。ただし K の `display_name` 源泉は**推奨1a に対しユーザーが1b を選択**＝§6）。
- 過去セッションの撤回記録（再検討不要・参考）: D の `publish` を当初「2ステップ非原子」としたが**部分コミットの穴**のため撤回し、`content?` を受ける**アトミック単一UoW**へ変更。

---

## 6. 決定事項と根拠（採用しなかった案も）

今セッションで確定した主判断（採否理由つき）:
- **H `notify()`＝A案**（宛先解決=発火ドメイン／畳み込み=H 純粋 domain／INSERT＋Redis publish=H repository・post-commit）。不採用＝(B) H が他モジュールを横断参照して宛先解決（ハブ化）／(C) `notify()` 完全純粋で application が全DB（肥大化）。通知は **at-most-once**（取りこぼしゼロ要件化で outbox・§3.5-(3)）。
- **I＝集約1本 `GET /dashboard`**（ランディングの1往復優先）。不採用＝分割並列（横断リストEPの乱立・I が目次化）。横断 read は D/F の repository に置く（別 EP 新設なし）。
- **ログインボーナス＝「新しいJST日の最初の認証済みリクエスト」**（判定純粋・付与冪等台帳・契機セッション解決依存性）。不採用＝認証イベント紐づけ（持続セッションで取りこぼし・ストリーク断）。
- **J＝可視範囲は WHERE で強制／下書き FTS 対象外／オフセットページング／門番パーティー＋グループ AND**。不採用＝索引ヒットを返す（漏洩）／カーソル（異種スコア UNION に不適）／下書きを含める。
- **K＝`display_name` 源泉 accounts（1b・列追加）＝ユーザー選択**。不採用＝1a（会社DB `users` 所有・スキーマ変更なし）＝私の推奨は1a だったが、identity 一元化（DRY・上書き競合排除）を優先しユーザーが1b を採用。`GET /me` 正準／`PATCH /me` は accounts+outbox。
- **L＝配信専用（publish しない）／event type canonical ドット記法／publisher chat=E・notifications=H／認可失効は除去時ドロップ＋再接続再検証**。不採用＝L が publish（責務混在）／毎 fan-out で権限再チェック（高コスト）。
- 過去確定（正は各 `doc/API設計/*.md`）: A=Cookie＋Redis 不透明セッション／B=ロール別パス分離・QG管理者は `quest_group_members.role=admin`／C=パーティー門番・6権限・状態機械 前進のみ（凍結 canonical=C.5）／D=publish アトミック単一UoW・投票 upsert・公開後 全保存で1版／E=`chat_reads`・チャット添付 単一 multipart・魔法リアクション統合 EP／F=選定 F 保有・限定公開 完全非表示／G=実績は台帳フック即時付与・台帳 canonical=G.6・ランキング週起点 月曜JST／H=取得時レンダリング多言語化・1イベント×1宛先1件。
- 横断原則: 設計の正は1箇所・なぜ併記（メモリ [[document-design-rationale]]）／DRY 線引き＝規約 §2.3／意図的選択＝§3.5／i18n JA/EN／リアルタイムは WebSocket＋Redis Pub/Sub（§1.12）。

---

## 7. 次にやること — 優先順に、具体的に

### (1) ユーザーの `L_リアルタイム配信.md` 内容確認 → 完了（2026-08-08）
- **L 確認は完了**。反映済みの軽微指摘＝下記2件。以降は (2) 横断再レビューに着手。
- **反映済みの軽微指摘**（`8b1ef0c`）: タイトル直後に「本ファイル中の『WS』は WebSocket の略（ワーカースレッド/プロセスではない）」の注記を1行追加（略語の誤読防止・内容仕様の変更なし）。L の本文確認は継続中。
- **反映済み（`8946a42`）**: L.4 に「配信モデル（プロセス毎ハブ集約）」小節を追記。実装者向けの明文化＝1接続=受信ループ+配信の2系統／プロセス内シングルトンのハブに接続登録し Redis 購読を共有／転送は購読集合+`company_id` フィルタ／水平スケールは Redis ファンアウト。購読方式（パターン vs 動的）は L.5 TBD に接続。仕様意図の明文化で内容変更なし。

### (2) API設計 A〜L の横断再レビュー（矛盾/drift の洗い出し）→ 完了・修正反映済み（2026-08-08）
- **完了**。4観点を並行調査（通知/イベント・門番/状態遷移・台帳/命名・クロスプレーン/§1.x）。**重大0・中1・軽微7＋整合確認3**。**設計セマンティクスの破綻は無し**（門番条件の欠落・台帳ルールの食い違い・identity 二重管理・凍結許可の逆転などゼロ）。指摘はすべて表記drift／記述陳腐化。
- **修正反映済み（本体=`6d72e5b`）**＝ユーザー承認のうえ中1＋軽微を一括修正:
  - E.2/E.4 の event 名を canonical ドット記法へ（旧 underscore `chat_message_updated` 等を除去）＝中1。
  - G.4/F.5/A.9-⑧ の `notify()` を post-commit 明示に統一（§3.5-(3)）。
  - README §1.12 の type 列挙に `chat.reaction.removed` 補完。
  - 通知i18nテンプレの参照ズレ（E.6/README：§1.13→データモデル §8-⑬）。
  - K 確定に伴う「未着手」表記を更新（I/README/H）。残高の正準＝K の `GET /me`・I は同梱で両立。
  - 画像フィールドを署名URL統一（I.1 hero／D.7 uploaded_by DTO：`avatar_image_path`→`avatar_image_url`・§1.10 生パス非露出）。※K の会社DBカラム名 `avatar_image_path` は正なので不変。
  - H.0 のメール送信担当を A経路/K経路とも一般化。
- **整合確認（矛盾でないが記録）**＝E 削除権限に QG/システム管理者（§8-⑪の正当な拡張）／既読更新の凍結例外（E.5/§8-⑰ canonical）／K.3 メール確認リンク要否は K.6 TBD。
- **既知で未処理（別項）**＝門番表記2系統の統一は「仕上げパス」で一括（下記）。
- **突き合わせる主な観点（具体）**:
  - **通知の発火点**: 各ドメイン（D.126/E.6/F.5/G.4/A.9）の通知発火が `H_通知.md` H.0 の「種別×発火ドメイン×`ref_*`×`params`」表と一致するか。`notify()` は post-commit（同UoW でない）で統一されているか（D.4 を今回修正済＝再確認）。
  - **event publish の責務**: `chat:{chat_group_id}` は E のみ・`notifications:{user_id}` は H の `notify()`（`L_リアルタイム配信.md` L.3・README §1.14/§2-L・E.7）。event `type` はドット記法（`chat.message.*`/`chat.reaction.*`/`notification.*`）で全箇所一致するか。
  - **門番の一貫性**: パーティー所属＋クエストグループ所属の **AND**（`quest_members.removed_at IS NULL` かつ `quest_group_members.removed_at IS NULL`）が C.0/D.0/E.0/F/J/L で揃っているか。
  - **状態遷移・凍結**: 凍結対象の canonical は C.5。D/E/F/L の「completed で何が 409 か／何が許可か（フォロー解除のみ・既読・検索）」が C.5 と一致するか。
  - **台帳/残高**: XP/コイン/SP 付与の canonical は G.6。A/D/E/F の付与記述（reason/量/上限/冪等）が G.6 表と一致するか（ログイン XP の契機一般化を含む）。
  - **命名の統一**: パラメータ（全文検索 `types`・ランキング `period=this_week|last_week|this_month|all`）／テーブル名（`activities`/`notifications`）／enum 値（データモデル §3）。旧記法（§7 小キュー参照）が API設計本体に残っていないか。
  - **クロスプレーン**: identity（`login_id`/`email`/`locale`/`display_name`）は accounts 源泉→`account_sync_outbox`（§1.13）。K/B/A で一貫しているか（`accounts.display_name` 追加を反映して B の発行フローが破綻しないか）。
  - **§1.x 全体規約 vs 各ドメイン**: §1.5 テナント解決・§1.6 認可・§1.7 エラー・§1.8 一覧・§1.9 冪等・§1.10 添付/署名URL・§1.12 WS・§1.13 outbox・§1.14 Redis と各ドメインの整合。

### (3) 実装スキャフォールド＝ログイン(状態A)を縦に通す（進行中）
- **方針確定（2026-08-08 ユーザー決定）**＝「少しずつ／まずログインが動くまで」。手法＝**設計書→テストパターン→テストコード**の連鎖を作る（ユーザーの仕様把握にも資する）。スライス範囲＝**SC-00 状態A（PWログイン）＋`GET /auth/session`＋`logout`**のみ（MFA・初回/再設定PW は範囲外＝後続）。契約＝**OpenAPI を正＋つなぎ md は orchestration/state のみ**（スキーマ二重化しない）。

- **完了（docs 先行・本体=`57e4f20`）**＝3ファイル新設:
  - `doc/テスト/テスト規約.md`＝TC-ID（`A-TC-001`）で 設計節⇄パターン md⇄テスト関数 を3方向リンク／テスト階層（unit/int/api/e2e）・DB隔離・**§6 共通必須観点**（セッション必須EP→401・CSRF→403・門番→404・冪等→副作用1回）・失敗反復TCの隔離。
  - `doc/ADR/ADR-0001_認証・セッション基本パラメータ.md`＝実装に要る具体値を**確定**（ユーザー承認）＝API `/api/v1/`／セッション（CSPRNG 32B・Redis `sess:{token}`・**idle30分/絶対12h**）／Cookie（A.0 準拠・dev は `COOKIE_SECURE` で切替）／CSRF（ダブルサブミット・login は CSRF 免除で Origin のみ）／**Argon2id `m=19MiB,t=2,p=1`**／**レート制限 (IP+login_id) 10回/5分→429**／エラーコードSoT=OpenAPI（別レジストリ作らない）。**アカウントロックは MFA スライスへ委譲**（決定先=A 設計）。
  - `doc/テスト/A_認証.md`＝状態A のテストパターン**20件**（`A-TC-001〜020`・列挙耐性・停止会社の正/誤資格の対〔006/007〕・no-session→401〔012/015〕・CSRF→403〔014〕・Cookie属性・固定化・timing・e2e）。

- **ツール選定（2026-08-08 ユーザー決定）**＝マイグレーション **Alembic**／DBアクセス **SQLAlchemy（同期・psycopg3）**。同期採用の理由は `backend/README.md`。

- **Chunk 1 完了＝起動する骨格（本体=`f8f4db9`・起動確認済み）**:
  - `compose.yaml`（db=postgres:16／redis:7／backend）。`backend/`（FastAPI＋SQLAlchemy 同期＋Alembic）。
  - **2プレーンを実データベースで再現**＝管理DB `ideaquest_control`＋会社DB `ideaquest_company_acme`（`companies.db_identifier` を DB 名に）。`app/core/db.get_tenant_session()` で §1.5 動的ルーティング。
  - `scripts/bootstrap.py`＝DB作成→Alembic（control/company 別環境）→シード（会社 ACME-01〔mfa_required=false〕＋アカウント `user@acme.example`/PW `Passw0rd!`＋会社DB users ミラー）。**冪等**。
  - `GET /healthz`＝DB/Redis 疎通。**検証済**＝healthz ok・2DB作成・シード投入・bootstrap 再実行で重複なし。
  - 実装＝`app/core`（config／db〔control+tenant〕／redis／security〔Argon2id・ADR-0001準拠〕）／`app/models`（control: companies/accounts・company: users）／`migrations/{control,company}`。

- **次にやること＝Chunk 2（認証エンドポイント）**:
  1. `app/core` 追加＝session（Redis `sess:{token}`・idle30分/絶対12h）／CSRF（ダブルサブミット）／errors（RFC7807 problem+json）／deps（認証ガード・CSRF・Origin）。
  2. 4層で `POST /api/v1/auth/login`・`GET /api/v1/auth/session`・`POST /api/v1/auth/logout`（router→application→domain→repository）。login はコントロールプレーン完結＋session.user は会社DBミラーから解決（A.6）。
  3. **Chunk 3**＝`doc/テスト/A_認証.md` の A-TC-001〜019 を pytest 実装（api中心＋int2件）。テストDBは隔離（テスト規約 §3）。
  4. **Chunk 4**＝フロント SC-00 状態A 配線＋**SC-00 つなぎ md**（orchestration のみ）＋e2e（A-TC-020）。frontend サービスを compose に追加。
- **起動手順**（`backend/README.md`）＝リポジトリ直下で `docker compose up --build` → `curl localhost:8000/healthz`。
- 骨格の正＝コーディング規約 **§3.4（2プレーン×縦スライス4層・`main.py`＋`worker.py`）**・**§4.1（フロント feature ベース）**。将来のフル DB＝`migrations/control`（管理DB6）＋`migrations/company`（会社DB29・PGroonga §6）＋`seeds`。
- **残タスク（後続スライス）**＝MFA（状態C）・初回/再設定PW（B/D）・**アカウントロック方針の確定（A 設計＋後続 ADR）**・エラーコードの OpenAPI 整備・つなぎ md の他画面展開。

### 仕上げパス（設計確定に伴い実施可）
- **ドキュメント作成規約の網羅適用（最終パス）**＝A〜L ほかの裸 `§x` を文書名接頭辞へ一括正規化（現状は「折衷」で新規のみ準拠）。再レビュー(2)と併せて実施検討。
- **門番の表記統一（横断レビュー指摘・意味は同一/drift ではない）**＝門番条件の書き方が2系統に割れている。A系統＝散文・否定形・2文分割（C.0/D.0/E.0/F.0）／B系統＝論理式・`かつ`＋`AND` 明示・肯定形（J.15/L.37）。**セマンティクスは完全同一**（パーティー所属 ∧ グループ所属、共に `removed_at IS NULL`）で J/L は「C.0 と同一」明記済み。**ユーザー決定＝今は触らず、最終パスで B系統（`AND` 明示）へ一括正規化**（1文書だけ直すと別の不統一を生むため横断で実施）。

### 未処理の小キュー（軽微・実装 or 該当時に整理）
- **画面 md の旧記法**（実装時に画面 md を追随）: SC-22 §7（`PUT /vote`）・SC-24 §7（`POST /api/ideas/{id}/chat`）・SC-25 §7（`PUT /api/ideas/{id}/evaluation`）・SC-31 §6（`PUT /me/avatar`→装備は `PUT /me/equipment`〔G〕／プロフィール画像は `PUT /me/avatar-image`〔K〕）・SC-41 §6（period 値）・SC-12 §113（全文検索 `scope=`→`types=`）・各画面の `Transaction/Activity`→`activities`・`Notification`→`notifications`。
- 各画面 §9/§10 の実装寄り TBD（SC-01 §10 ダッシュボード各パネル件数/並び・SC-12 検索語演算子/スコア重み・K 画像上限/メール確認・L 失効シグナル具体/Last-Event-ID・各種閾値〔セッションTTL・PWポリシー・レート制限・per_page 上限〕）＝実装/運用で確定。

---

## 8. 再開に必要な環境情報

- **アプリの起動/テストコマンドは無い**（コード未着手＝`compose`/`package.json`/`pyproject.toml` いずれも未作成・確認済み）。ポート・環境変数も**未定（未確認）**＝実装スキャフォールドで作成する。
- **今使う操作**:
  - `git`（履歴・差分・コミット/プッシュ）。ブランチ `main`・remote `origin`。
  - ドキュメント＝Markdown を読む。画面モック＝`doc/画面設計/mocks/*.html` をブラウザで開く（入口 `mocks/index.html`）。
  - モック JS の構文チェック＝inline `<script>` を抽出して `node --check`（今後モックを触る場合のみ）。
- **技術スタック（確定・未構築）**: フロント Next.js(React/App Router)＋Three.js/R3F＋three-vrm ／ バック Python/FastAPI(4層＝router→application→domain→repository・2プレーン control_plane/tenant) ／ DB PostgreSQL(管理DB1＋会社DB N・全文検索 PGroonga＝§6・会社DBのみ拡張) ／ Redis(セッション/OTP/pre-auth/会社コンフィグキャッシュ/冪等キー/Pub-Sub) ／ MinIO(添付・画像) ／ 全て Docker。
- **リポジトリ運用ルール**:
  - `.gitignore` で **`*.pdf` は追跡外**（Markdown が正・PDFは派生）。
  - **コミットは「本体コミット→handoff にハッシュ追記」の2段方式**（本体変更が無い今回のような handoff 単独更新はその限りでない）。コミットメッセージ末尾に `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。プッシュ先 `origin/main`。
  - ドキュメント方針＝**設計の正は1箇所・他は参照**（drift 回避）／**設計判断はなぜも併記（必須）**／文書間参照は `doc/規約/ドキュメント作成規約.md`（`CLAUDE.md` から自動参照）／意図的選択は `doc/規約/コーディング規約.md §3.5`・DRY 線引きは §2.3。

---

### 自己チェック（このファイルだけで再開できるか）
- ✅ **再開点＝(1) ユーザーの L 確認待ち →(2) A〜L 横断再レビュー（読み取りのみ・指摘一覧を出すだけで修正しない）→(3) 実装スキャフォールドの進め方検討**を §7 に明記。(2) の突き合わせ観点をファイル/節レベルで列挙。
- ✅ **未確認事項を明記**＝A〜L の横断整合は**未レビュー**（矛盾が残る可能性は否定できない）／起動・テストコマンド・ポート・環境変数は**未定（未確認）**／コード・テストは**存在しない**。
- ✅ 今回の成果（API設計 A〜L 全確定・各コミットハッシュ・K の `accounts.display_name` 追加・ログインボーナス契機一般化・規約 §2.3 DRY）と、採否理由（特に K の1b はユーザー選択で私の推奨1a と異なる）を §3/§6 に記録。
- ✅ 最新コミット `8278f6a`・作業ツリー クリーンを確認済み。本 handoff は**単独コミット**でプッシュする。
- ⚠ A〜L の詳細な決定理由は各 `doc/API設計/*.md` を正とすること（本 handoff は要約）。会話ログは参照不可。
