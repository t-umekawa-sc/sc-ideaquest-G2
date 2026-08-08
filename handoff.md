# 作業引き継ぎ (handoff)

> 次回セッション開始時に **このファイルだけ読めば作業を再開できる** ことを目的とした引き継ぎメモ。
> 読者は「このセッションの記憶が一切ない次回の自分」。会話ログは参照不可。詳細仕様は必ず `doc/要件定義/README.md`（唯一の要件定義書）と `doc/API設計/` を参照。
> 毎回このファイルは全文を上書きする（履歴は git に任せる）。
>
> **次回の開始点＝⑩ドメインL（リアルタイム配信・WebSocket／§1.12・最後のドメイン）の詳細確定**（§7 参照）。A〜K は詳細確定済み。

---

## 1. 最終更新日時 / ブランチ / 最新コミット

- 最終更新: **2026-08-08 JST**（セッション終了時）
- ブランチ: **main**（`origin/main` と同期・作業ツリー クリーン）
- 最新コミット（本文＝直近の内容変更）: **API設計 ドメインK 詳細確定**（`K_プロフィール・背景画像.md` 新規＋データモデル `accounts.display_name` 追加＋README §2）。**このコミット直後に本 handoff 追記コミット**（2 段方式）。ハッシュは `git log --oneline` で確認。
- remote: `https://github.com/t-umekawa-sc/sc-ideaquest-G2.git`
- **プッシュ状況**: 本文コミット＋本 handoff コミットを **origin/main へプッシュ済み**（当セッションで実施）。
- 直近の主なコミット（新しい順・ハッシュは `git log --oneline` で確認）:
  - （本セッション）API設計 ドメインK 詳細確定（プロフィール・背景画像）
  - `7a5cf47` ドメインJ J.5 に snippet_html 出力形を明記
  - `bbf8a41` ドメインJ 門番を精緻化（パーティー＋グループ所属 AND）
  - `d68ebff` ドメインJ 詳細確定（全文検索）

---

## 2. このプロジェクトのゴール

- **ideaquest**＝社内のアイデア創出をゲーミフィケーション（XP/コイン/レベル/魔法/ランキング）で促す **WEB アプリ**（マルチテナント SaaS・管理DB1＋会社DB N）。
- スタック＝フロント Next.js／バック FastAPI／PostgreSQL（全文検索 PGroonga）／Redis／MinIO／Docker。
- 現在は **実装前の設計フェーズ**（要件定義→データモデル→画面設計→**API設計（いまここ）**→実装）。API設計は A〜K 確定・残り L のみ。

---

## 3. 今回やったこと — 変更ファイルと理由

今セッション＝**H レビュー反映→⑦I→規約§2.3 DRY→ログインボーナス一般化→⑧J（＋門番精緻化＋J.5 明記）→⑨K** を順に確定。変更は **ドキュメントのみ**（コードは無い）。各段階で「本体→handoff にハッシュ追記」の2段コミット・プッシュ済み。

### 3.6 ドメインK 詳細確定（プロフィール・背景画像・本セッションの本体コミット）
- **論点1＝`display_name` の源泉をユーザー選択で 1b に確定**＝**管理DB `accounts` 源泉**（`accounts.display_name` 列を追加・会社DB `users.display_name` はミラー化）。identity（login_id/email/locale/display_name）を accounts に**源泉一元化**（DRY・上書き競合排除）。→ データモデル §4.2（列追加・ミラー一覧に display_name 追記）・§5.3（users を「ミラー」注記）を更新。
- **論点2＝エンドポイント構成**（承認どおり）:
  - `GET /me`＝プロフィール＋残高の**正準**（I の hero と両立・同じ `users` 読取。I 申し送りの「残高一本化」は"GET /me が正準・ダッシュボードは集約で同梱"として解決）。
  - `PATCH /me`＝`display_name`/`locale` のみ（**accounts+outbox の単一コントロールプレーン Tx**・§1.13）。
  - `POST /me/password`＝現在PW再確認（1-㉒）→§A.9-③（全セッション破棄＋信頼端末失効）＋`security_password_changed` 通知（**K が H の notify() を呼ぶ**＝B-5 契約）。
  - `POST /me/email`＝再認証（1-㉓）→accounts+outbox（新メール確認リンク要否は TBD）。
  - `PUT/DELETE /me/avatar-image`・`/me/background-image`＝MinIO・会社DB `users` 直接・**読取は署名URL**（§1.10・恒久公開URL禁止）。
  - Mass Assignment（§2.2）＝残高/`system_role`/`status`/`password_set`/`login_id` は編集不可。MFA は会社設定（per-user 無し）＝A.9-⑦ の MFA 再認証は将来 per-user 追加時の先取り注記。
- 成果物＝`doc/API設計/K_プロフィール・背景画像.md` 新規（K.0〜K.6）＋README §2 の K 行 ✅（プレーン＝テナント＋コントロール）＋§2-K サマリ＋データモデル `accounts.display_name` 追加。**背景/アバターの画像列は既存**（`users.background_image_path`/`avatar_image_path`）＝画像側はスキーマ変更なし。

### 3.5 ドメインJ 詳細確定＋門番精緻化＋J.5 明記
- 全文検索（PGroonga）: 対象＝ideas/chat_messages/attachments・スコープ2種（`GET /quests/{id}/search`／`GET /search`）・**可視範囲は索引でなく WHERE で強制**（下書き除外・completed 可・非トゥームストーン）・結果＝3種 UNION を score 降順・**オフセットページング**・索引は同期更新。**門番＝パーティー所属＋クエストグループ所属の AND**（C.0 と同一・後続コミットで精緻化）。J.5＝`pgroonga_snippet_html` は「ユーザー文のみエスケープ＋ハイライトタグは生 HTML・二重エスケープでない・デコード工程なし」を明記（フロントは許可リストサニタイズ）。

### 3.4 ログインボーナス付与契機の一般化
- 「新しい暦日（JST）の最初の認証済みリクエスト」（判定=純粋・付与=冪等台帳〔ユーザー×JST日1回〕・契機=セッション解決依存性）。日境界 JST 統一。スキーマ変更なし。

### 3.3 規約 §2.3「DRY」追記
- DRY＝知識の正は1箇所＋過剰抽象を避ける限界（3回目で検討・間違った抽象より重複が安い）を §2 に新設。

### 3.2 ドメインI 詳細確定（ダッシュボード集約）
- 集約1本 `GET /dashboard`・I は読取合成の殻・横断 read は D/F の repository に追加し I が合成（別 EP 新設なし）・ヒーロー残高は当面 I（→ K で GET /me が正準化）。

### 3.1 ドメインH レビュー反映
- `notify()` A案・B-1〜C-6（同UoW→post-commit・Redis publish は H・at-most-once 等）。

---

## 4. 現在の状態 — 動いているもの / 壊れているもの / テスト

- **リポジトリは `doc/`・`CLAUDE.md`・`handoff.md` のみ**。アプリのコード・`compose`・テストは**未着手＝存在しない**（`doc/画面設計/mocks/shared.js` はモック用資産）。
- **壊れているもの**: なし。
- **テスト**: 自動テストは無い（コード未着手）。ドキュメント整合は人手＋Explore で確認。
- **API設計の進捗（`doc/API設計/` 実在）**: **A/B/C/D/E/F/G/H/I/J/K ＝詳細確定**（個別ファイルあり・README §2 一覧で ✅）。**L ＝未着手**（README §2 一覧で ⬜・目次のみ）＝**残り1ドメイン**。
- 成果物の所在:
  - `CLAUDE.md`（直下・規約自動参照の入口）
  - `doc/要件定義/README.md`（唯一の要件定義書）
  - `doc/データモデル.md`（管理DB6＋**会社DB29テーブル**。§6 PGroonga。K で **`accounts.display_name` 追加**〔列追加のみ・テーブル数不変〕・`users.display_name` をミラー化）＋`.pdf`（派生・追跡外）
  - `doc/API設計/`（`README.md`＝全体規約＋§2目次／`A_…`〜`K_プロフィール・背景画像.md` の11ドメイン）
  - `doc/規約/`（`ドキュメント作成規約.md`〔汎用〕／`コーディング規約.md`〔§2.3 DRY・§3.5 意図的選択を含む〕）
  - `doc/画面設計/`（`screens/` md・`mocks/` html〔入口 `mocks/index.html`〕・`デザイン標準.md`・`画面遷移図.md`）
  - `doc/WEBアプリ開発時のセキュリティ対策一覧.md`（OWASP系・規約 §2.2 で義務化）

---

## 5. 詰まっている点 — 失敗したアプローチと理由

- **現時点でブロッカーは無い**。
- 今回確定した派生判断（再検討不要）:
  - K＝`display_name` 源泉は accounts（1b・列追加）／`GET /me` 正準（I の hero と両立）／`PATCH /me` は accounts+outbox 単一制御プレーン Tx／PW変更＝現在PW再確認＋§A.9-③＋H 通知／画像は会社DB 直接＋署名URL。
  - J＝下書き FTS 対象外／可視範囲は WHERE 強制／オフセットページング／同期索引／門番＝パーティー＋グループ AND。
  - ログインボーナス＝「新しいJST日の最初の認証済みリクエスト」。
  - I＝集約1本・合成の殻・横断 read は D/F。H＝`notify()` A案・Redis publish は H・at-most-once。

---

## 6. 決定事項と根拠（採用しなかった案も）

本セッション（ドメインK）で確定した主判断:
- **`display_name` 源泉＝accounts（1b・`accounts.display_name` 追加）**。不採用＝1a（会社DB `users` 所有・スキーマ変更なし）＝ユーザー選択で identity 一元化（DRY・上書き競合排除）を優先し 1b を採用。
- **`GET /me` を正準・ダッシュボードは集約で hero 同梱（両立）**。不採用＝ダッシュボードから hero を外し GET /me に一本化（1往復の集約価値を損なう）。
- **`PATCH /me` は accounts+outbox（display_name/locale とも accounts 源泉のため単一制御プレーン Tx）**。email/password は再認証・重い操作として別 EP に分離。

過去セッションの主判断（要約・正は各 `doc/API設計/*.md`）:
- J＝PGroonga 横断・門番パーティー＋グループ AND・可視範囲 WHERE 強制・下書き除外・オフセット・同期索引。
- I＝集約1本 `GET /dashboard`・合成の殻・横断 read は D/F。
- H＝取得時レンダリング多言語化・1イベント×1宛先1件・`notify()` A案・Redis publish は H・at-most-once。
- G＝実績は台帳フック即時付与・台帳 canonical=G.6・ランキング週起点 月曜JST・ログインXP は「新しいJST日の初回」。
- F＝選定 F 保有・限定公開 完全非表示・投稿者コイン確定トリガ。
- E＝未読 `chat_reads`・チャット添付 単一 multipart・魔法リアクション統合 EP。
- D＝publish アトミック単一UoW・投票 upsert・公開後 全保存で1版・フォローは解除のみ完了後可。
- C＝パーティー門番・6権限サーバー強制・状態機械 前進のみ。
- B＝ロール別パス分離・QG管理者は `quest_group_members.role=admin`・会社アカウント管理者 SoD。
- A＝Cookie＋Redis 不透明セッション・MFA/pre-auth 分離・列挙耐性。
- 全体＝設計の正は1箇所・なぜ併記（メモリ [[document-design-rationale]]）／DRY 線引き＝規約 §2.3／意図的選択＝§3.5／i18n JA/EN／リアルタイムは WebSocket＋Redis Pub/Sub（§1.12）。

---

## 7. 次にやること — 優先順に、具体的に

### ★最優先＝⑩ドメインL（リアルタイム配信・WebSocket／§1.12）の詳細確定＝最後のドメイン
- 読む: `doc/API設計/README.md` **§1.12（リアルタイム配信・WebSocket 方針）**・§1.14（Redis Pub/Sub の一覧）・§2-L・一覧表 L 行／SC-24（チャット・WS の主用途）・SC-02（通知・ベル）。
- 予約シグネチャ（README §2-L）: `GET /realtime`（WS ハンドシェイク・Cookie セッション認証・`company_id` バインド）。常時購読 `notifications:{user_id}`／動的購読 `chat:{chat_group_id}`（`subscribe`/`unsubscribe`・購読時に閲覧権限検証）。**配信専用（書き込みは各ドメインの REST）**。
- **既に確定済みの前提（踏襲）**: **通知チャネル `notifications:{user_id}` の Redis publish は H の `notify()`（post-commit）が担い、L は購読→WS 転送に徹する**（ドメインH B-2 契約）。チャットチャネル `chat:{chat_group_id}` の publish は E（E.7）。切断中欠落は REST を正として再同期（§1.12）。
- 成果物: `doc/API設計/L_リアルタイム配信.md` を新規作成→ README §2 の L 行 ✅+リンク化・§2-L サマリ記述。**これで全ドメイン（A〜L）完了**。
- 詰める論点: **WS ハンドシェイク認証**（Cookie セッション・`company_id` バインド・§1.5）／**トピック購読制御**（`notifications:{user_id}` 常時／`chat:{chat_group_id}` 動的・**購読時にパーティー閲覧権限を検証**＝C.0 門番）／**イベント種別とペイロード**（D/E/H が発行する event の統合カタログ＝`chat_message_created/updated/deleted`・`reaction_added/removed`・通知 `new`/`unread_count`）／**再接続・再同期**（`GET /ideas/{id}/chat?after=` ・`GET /notifications`＋未読数・将来 `Last-Event-ID`）／**fan-out backbone＝Redis Pub/Sub**（複数インスタンス跨ぎ・§1.12）／**認可の連続強制**（購読後にパーティーから外れた場合の失効）／スケール/ハートビート。

### その後
- **全ドメイン確定後＝実装スキャフォールド**（`compose`＋Next.js/FastAPI/PostgreSQL(PGroonga)/Redis/MinIO・ディレクトリは コーディング規約 §3.4/§4.1）。
- **ドキュメント作成規約の網羅適用（最終パス）**＝設計確定後に A〜L ほかの裸 §x を文書名接頭辞へ一括正規化（今は「折衷」で新規のみ準拠）。

### 未処理の小キュー（軽微・実装 or 該当ドメインで整理）
- **画面 md の旧記法**（実装時に画面 md を追随）: SC-22 §7（`PUT /vote`）・SC-24 §7（`POST /api/ideas/{id}/chat`）・SC-25 §7（`PUT /api/ideas/{id}/evaluation`）・SC-31 §6（`PUT /me/avatar`→装備は `PUT /me/equipment`〔G〕・プロフィール画像は `PUT /me/avatar-image`〔K〕）・SC-41 §6（period 値）・SC-12 §113（全文検索 `scope=`→`types=`）・各画面の `Transaction/Activity`→`activities`・`Notification`→`notifications`。
- 各画面 §9/§10 の実装寄り TBD（SC-01 §10 ダッシュボード各パネル・SC-12 検索語演算子/スコア重み・K の画像上限/メール確認/新実績カタログ・VRM パーツ 等）＝実装/運用で確定。

---

## 8. 再開に必要な環境情報

- **アプリの起動/テストコマンドは無い**（コード未着手＝`compose`/`package.json`/`pyproject.toml` いずれも未作成）。ポート・環境変数も**未定（未確認）**。
- **今使う操作**:
  - `git`（履歴・差分・コミット/プッシュ）。ブランチ `main`・remote `origin`。
  - ドキュメント＝Markdown を読む。画面モック＝`doc/画面設計/mocks/*.html` をブラウザで開く（入口 `mocks/index.html`）。
  - モック JS の構文チェック＝inline `<script>` を抽出して `node --check`（今後モックを触る場合）。
- **技術スタック（確定・未構築）**: フロント Next.js(React/App Router)＋Three.js/R3F＋three-vrm ／ バック Python/FastAPI(4層＝router→application→domain→repository) ／ DB PostgreSQL(管理DB1＋会社DB N・全文検索 PGroonga＝§6・会社DBのみ拡張) ／ Redis(セッション/OTP/pre-auth/会社コンフィグキャッシュ/冪等キー/Pub-Sub) ／ MinIO(添付・画像) ／ 全て Docker。
- **リポジトリ運用ルール**:
  - `.gitignore` で **`*.pdf` は追跡外**（Markdown が正・PDFは派生）。
  - **コミットは「本体コミット→handoff にハッシュ追記」の2段方式**。コミットメッセージ末尾に `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。プッシュ先 `origin/main`。
  - ドキュメント方針＝**設計の正は1箇所・他は参照**（drift 回避）／**設計判断はなぜも併記（必須）**／文書間参照は `doc/規約/ドキュメント作成規約.md`（`CLAUDE.md` から自動参照）／意図的選択は `doc/規約/コーディング規約.md §3.5`・DRY 線引きは §2.3。

---

### 自己チェック（このファイルだけで再開できるか）
- ✅ **再開点＝⑩ドメインL（最後）**を §7 冒頭に明記し、入力（§1.12/§1.14・SC-24/SC-02）・予約シグネチャ（`GET /realtime`・常時/動的購読）・既決前提（通知 publish は H・chat publish は E・L は転送）・論点（ハンドシェイク認証/購読権限検証/イベントカタログ/再同期/Pub-Sub/認可失効）を具体化。
- ✅ 本セッションの H/I/DRY/ログインボーナス/J/K を §3 に記録。K は display_name 源泉=accounts(1b・列追加)・GET /me 正準・PATCH は accounts+outbox・PW/email はセキュリティEP・画像は署名URL。データモデルは `accounts.display_name` 追加（列追加のみ・テーブル数不変）。
- ✅ L 完了で API設計 A〜L 全確定→実装スキャフォールドへ、を §7 に明記。
- ⚠ A〜K の詳細な決定理由は各 `doc/API設計/*.md` を正とすること（本 handoff は要約）。会話ログは参照不可。
