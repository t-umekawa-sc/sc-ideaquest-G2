# 作業引き継ぎ (handoff)

> 次回セッション開始時に **このファイルだけ読めば作業を再開できる** ことを目的とした引き継ぎメモ。
> 読者は「このセッションの記憶が一切ない次回の自分」。会話ログは参照不可。詳細仕様は必ず `doc/要件定義/README.md`（唯一の要件定義書）と `doc/API設計/` を参照。
> 毎回このファイルは全文を上書きする（履歴は git に任せる）。
>
> **次回の開始点＝⑨ドメインK（プロフィール・背景画像・`GET/PATCH /me`／共通ヘッダー・SC-31 背景設定）の詳細確定**（§7 参照）。A〜J は詳細確定済み。

---

## 1. 最終更新日時 / ブランチ / 最新コミット

- 最終更新: **2026-08-08 JST**（セッション終了時）
- ブランチ: **main**（`origin/main` と同期・作業ツリー クリーン）
- 最新コミット（本文＝直近の内容変更）: **API設計 ドメインJ J.5 に `snippet_html` 出力形を明記**（誤読防止・`7a5cf47`）。その前が **ドメインJ 門番を精緻化**（`bbf8a41`）／**ドメインJ 詳細確定**（`d68ebff`）。**このコミット直後に本 handoff 追記コミット**（2 段方式）。
- remote: `https://github.com/t-umekawa-sc/sc-ideaquest-G2.git`
- **プッシュ状況**: 本文コミット＋本 handoff コミットを **origin/main へプッシュ済み**（当セッションで実施）。
- 直近の主なコミット（新しい順・ハッシュは `git log --oneline` で確認）:
  - `7a5cf47` API設計 ドメインJ: J.5 に `snippet_html` 出力形を明記（誤読防止・二重エスケープでない/デコード工程なし）
  - `bbf8a41` API設計 ドメインJ 門番を精緻化（パーティー所属＋クエストグループ所属の AND）
  - `d68ebff` API設計 ドメインJ 詳細確定（全文検索／SC-12）
  - `61c4a4a` API設計: デイリーログインボーナス付与契機の一般化
  - `966943b` 規約: コーディング規約 §2.3「DRY」追記
  - `b7644d5` API設計 ドメインI 詳細確定（ダッシュボード集約／SC-01）

---

## 2. このプロジェクトのゴール

- **ideaquest**＝社内のアイデア創出をゲーミフィケーション（XP/コイン/レベル/魔法/ランキング）で促す **WEB アプリ**（マルチテナント SaaS・管理DB1＋会社DB N）。
- スタック＝フロント Next.js／バック FastAPI／PostgreSQL（全文検索 PGroonga）／Redis／MinIO／Docker。
- 現在は **実装前の設計フェーズ**（要件定義→データモデル→画面設計→**API設計（いまここ）**→実装）。

---

## 3. 今回やったこと — 変更ファイルと理由

今セッション＝**(1) ドメインH レビュー反映**、**(2) ⑦ドメインI 詳細確定**、**(3) 規約 §2.3「DRY」追記**、**(4) ログインボーナス付与契機の一般化**、**(5) ⑧ドメインJ 詳細確定**。変更は **ドキュメントのみ**（コードは無い）。各段階で「本体→handoff にハッシュ追記」の2段コミット・プッシュ済み。

### 3.5 ドメインJ 詳細確定（全文検索・本セッションの本体コミット）
- 大枠は §1.11・データモデル §6・SC-12 で既決（対象＝`ideas`(title/body/value/note)＋`chat_messages`(body)＋`attachments`(original_name)・PGroonga・門番＝パーティー範囲）。本レビューで残論点を確定:
  - **可視範囲はサーバーが WHERE で強制**（索引ヒットをそのまま返さない）＝`published`＋非削除アイデア／非トゥームストーン `chat_messages`／可視親の添付。**下書きは本人分も含め FTS 対象外**（共有前 WIP）。**`completed` は検索可**。匿名化/評価 visibility は対象外要素。
  - **スコープ2種**＝`GET /quests/{id}/search`（クエスト内・門番 C.0）／`GET /search`（テナント内・自分の全パーティー和集合）。
  - **結果＝3種 UNION を `pgroonga_score` 降順の単一リスト**（種別バッジ・所属アイデア・`snippet_html`・親導線 idea→SC-22/chat・attachment→SC-24）。
  - **ページング＝オフセット `page`/`per_page`**（関連度順 UNION・件数表示・§1.8 の例外＝時系列でなくカーソル不適）。
  - **索引は同期更新（リアルタイム）**＝PGroonga は通常の PG インデックス（外部同期不要・SC-12 §131 の TBD 解消）。
  - パラメータ＝`q`（必須・PGroonga へバインド＝§2.2③）・`types=idea,chat,attachment`（既定 all・README §1.11 準拠。SC-12 の `scope=` は旧記法）。**スニペットは許可リストサニタイズ**（生 `dangerouslySetInnerHTML` 禁止・§2.2④）。
- 成果物＝`doc/API設計/J_全文検索.md` 新規（J.0 責務・門番・可視範囲／J.1 EP／J.2 対象・索引／J.3 結果・スニペット／J.4 ページング／J.5 セキュリティ突合／J.6 境界・残TBD）＋README §2 の J 行 ✅+リンク＋§2-J サマリ。スキーマ変更なし。
  - **門番の精緻化（コミット `bbf8a41`）**＝J.0 が `quest_group_members` 条件を明示していなかったため、C.0/D.0/E.0 と同じ**2条件の AND**（`quest_members` かつ `quest_group_members`・いずれも `removed_at IS NULL`・どちらか欠けても404）へ修正。`GET /search` は両条件が共に有効なクエストの和集合。README §2-J も更新。

### 3.4 ログインボーナス付与契機の一般化（コミット `61c4a4a`）
- 付与契機を「A のログイン成功時のみ」→**「新しい暦日（JST）の最初の認証済みリクエスト」**（ログイン成功を含む）に一般化＝持続セッションで日を跨ぐ利用者の取りこぼしを解消。機構3分割＝判定=純粋関数（G domain）／付与=冪等台帳（`activities(reason=login)` を**ユーザー×JST日で1回**）／契機=セッション解決依存性（A・当日初回のみ G へ委譲）。日境界 JST 統一。スキーマ変更なし。反映＝A.1/G.6/データモデル §7・activities 注記/SC-00 §10/I.1・委譲。

### 3.3 コーディング規約 §2.3「DRY」追記（コミット `966943b`）
- DRY＝「知識（業務ルール・定義）の正は1箇所」に限定し既定の置き場所へ相互参照＋適用の限界（過剰抽象を避ける・3回目で検討・間違った抽象より重複が安い）を併記。§2（横断規約）に新設。

### 3.2 ドメインI 詳細確定（ダッシュボード集約・コミット `b7644d5`）
- 集約1本 `GET /dashboard`／I は読取合成の殻（新業務ロジックなし）／横断 read は D/F の repository に追加し I が合成（別 EP 新設なし）／ヒーロー残高は K 未着手のため当面 I が返す。

### 3.1 ドメインH レビュー反映（コミット `bb36a79`）
- `notify()` A案（宛先解決=発火側／畳み込み=H 純粋 domain／INSERT＋Redis publish=H repository・post-commit）／B-1〜C-6（同UoW→post-commit・Redis publish は H・ref_idea_id 追記・meta 是正・K 発火元・冪等 at-most-once 等）。

---

## 4. 現在の状態 — 動いているもの / 壊れているもの / テスト

- **リポジトリは `doc/`・`CLAUDE.md`・`handoff.md` のみ**。アプリのコード・`compose`・テストは**未着手＝存在しない**（`doc/画面設計/mocks/shared.js` はモック用資産）。
- **壊れているもの**: なし。
- **テスト**: 自動テストは無い（コード未着手）。ドキュメント整合は人手＋Explore で確認。
- **API設計の進捗（`doc/API設計/` 実在）**: **A/B/C/D/E/F/G/H/I/J ＝詳細確定**（個別ファイルあり・README §2 一覧で ✅）。**K/L ＝未着手**（README §2 一覧で ⬜・目次のみ）。
- 成果物の所在:
  - `CLAUDE.md`（直下・規約自動参照の入口）
  - `doc/要件定義/README.md`（唯一の要件定義書）
  - `doc/データモデル.md`（管理DB6＋**会社DB29テーブル**。§6 PGroonga 索引。I/J はスキーマ変更なし）＋`.pdf`（派生・追跡外）
  - `doc/API設計/`（`README.md`＝全体規約＋§2目次／`A_…`〜`J_全文検索.md` の10ドメイン）
  - `doc/規約/`（`ドキュメント作成規約.md`〔汎用〕／`コーディング規約.md`〔§2.3 DRY・§3.5 意図的選択を含む〕）
  - `doc/画面設計/`（`screens/` md・`mocks/` html〔入口 `mocks/index.html`〕・`デザイン標準.md`・`画面遷移図.md`）
  - `doc/WEBアプリ開発時のセキュリティ対策一覧.md`（OWASP系・規約 §2.2 で義務化）

---

## 5. 詰まっている点 — 失敗したアプローチと理由

- **現時点でブロッカーは無い**。
- 今回確定した派生判断（再検討不要）:
  - J＝下書きは FTS 対象外／可視範囲は索引でなく WHERE で強制／オフセットページング／PGroonga 同期更新（リアルタイム）／`types` パラメータ。
  - ログインボーナス＝契機は「新しいJST日の最初の認証済みリクエスト」（判定=純粋・付与=冪等台帳・契機=セッション依存性・日境界 JST）。
  - I＝集約1本・合成の殻・横断 read は D/F・ヒーロー残高は当面 I。
  - H＝`notify()` A案・Redis publish は H・at-most-once。

---

## 6. 決定事項と根拠（採用しなかった案も）

本セッション（ドメインJ）で確定した主判断:
- **可視範囲は索引ヒットでなくクエリ WHERE で強制**。不採用＝索引結果をそのまま返す（下書き/他パーティー/削除の漏洩）。
- **ページング＝オフセット**（`page`/`per_page`）。不採用＝カーソル（関連度順 UNION では利点が効かず異種スコアのカーソル化が非現実的・§1.8 の例外）。
- **下書きは本人分も含め FTS 対象外**。不採用＝本人下書きを検索に含める（共有前 WIP・ダッシュボード/一覧で到達可）。

過去セッションの主判断（要約・正は各 `doc/API設計/*.md`）:
- I＝集約1本 `GET /dashboard`・合成の殻・横断 read は D/F・残高は当面 I。
- H＝取得時レンダリング多言語化（`params`）・1イベント×1宛先1件・`notify()` A案・Redis publish は H・at-most-once。
- G＝実績は台帳フック即時付与（G 一元化）・台帳 canonical=G.6・ランキング `GET /rankings`（週起点 月曜JST・SP非対象）・ログインXP は「新しいJST日の初回」。
- F＝選定 F 保有（複数可・XP 取消なし）・限定公開 完全非表示・投稿者コイン確定トリガ。
- E＝未読 `chat_reads` 新設・チャット添付 単一 multipart・魔法リアクション統合 EP。
- D＝publish アトミック単一UoW・投票 upsert（初回XP・日次上限）・公開後 全保存で1版・フォローは解除のみ完了後可。
- C＝パーティー門番・6権限サーバー強制・publish アトミック・状態機械 前進のみ。
- 全体＝設計の正は1箇所・他は参照／なぜも併記（必須・メモリ [[document-design-rationale]]）／DRY と過剰抽象の線引き＝規約 §2.3／意図的選択＝規約 §3.5／認証は Cookie＋Redis 不透明セッション／リアルタイムは WebSocket＋Redis Pub/Sub（§1.12）／i18n JA/EN。

---

## 7. 次にやること — 優先順に、具体的に

### ★最優先＝⑨ドメインK（プロフィール・背景画像・`GET/PATCH /me`）の詳細確定
- 読む: `doc/画面設計/screens/SC-31_アバター着せ替え.md`（§6 背景画像/`PUT /me/avatar`旧記法）＋共通ヘッダー（SC-01 §4.11 背景画像＝ユーザーメニューから設定・全認証画面反映）＋`doc/API設計/README.md` §2-K・一覧表 K 行／データモデル §5.3 users（`display_name`/`avatar_image_path`/`locale`/残高）・§8-⑬（ロケール源泉＝`accounts.locale`→`users.locale` ミラー）。
- 参照する規約: **A.9-⑦**（自己 PW 変更＝現在 PW 再確認〔一覧 1-㉒〕・email/MFA 変更時は再認証〔1-㉓〕）＝K が設計する委譲分。§1.13 アカウント同期 outbox（`accounts` 源泉→会社DB `users` ミラー）。
- 成果物: `doc/API設計/K_プロフィール・背景画像.md` を新規作成→ README §2 の K 行 ✅+リンク化・§2-K サマリ記述。
- 詰める論点:
  - **`GET /me`／`PATCH /me` の形**（残高 Lv/XP/コイン/SP・`display_name`・`locale`・`avatar_image_path`・背景画像）。**ドメインI が当面返しているヒーロー残高を `GET /me` に一本化するか**（I 決定の申し送り）。
  - **ロケール変更の源泉問題**＝`accounts.locale`（管理DB・源泉）と `users.locale`（会社DB・ミラー）。プロフィールでの `locale`/`display_name`/`email` 変更は **`accounts` を更新→`account_sync_outbox` で会社DBへ**（§1.13・データモデル §4.6/§8-①）＝クロスプレーン。K がどちらのプレーンの EP か（管理DB書き込み＋outbox）を明確化。
  - **背景画像・アバター画像**＝MinIO アップロード（§1.10・署名URL・allowlist/サイズ）。背景は「ユーザー個人設定・全認証画面反映」。保存先列（`users.avatar_image_path`＋背景用の列 or ユーザー設定）を確認（データモデルに背景画像列があるか要確認＝無ければ追加要否を論点に）。
  - **セキュリティ（A.9-⑦ 委譲）**＝自己 PW 変更（現在 PW 再確認）・email/MFA 変更時の再認証・変更で `security_password_changed` 通知を **K が発火**（H の B-5 契約）。
  - `PATCH /me` の Mass Assignment 対策（受入フィールド明示・残高や `system_role` は不可・§2.2）。

### その後（順次）
- **L**（リアルタイム配信 WebSocket／§1.12・D/E/H の event 発行点を統合＝最後。**通知チャネル `notifications:{user_id}` の publish は H の `notify()`・L は購読→WS 転送**という契約を踏襲）。
- **全ドメイン確定後＝実装スキャフォールド**（`compose`＋Next.js/FastAPI/PostgreSQL(PGroonga)/Redis/MinIO・ディレクトリは コーディング規約 §3.4/§4.1）。
- **ドキュメント作成規約の網羅適用（最終パス）**＝設計確定後に A〜J ほかの裸 §x を文書名接頭辞へ一括正規化（今は「折衷」で新規のみ準拠）。

### 未処理の小キュー（軽微・実装 or 該当ドメインで整理）
- **画面 md の旧記法**（実装時に画面 md を追随）: SC-22 §7（`PUT /vote`）・SC-24 §7（`POST /api/ideas/{id}/chat`）・SC-25 §7（`PUT /api/ideas/{id}/evaluation`）・SC-31 §6（`PUT /me/avatar`→`PUT /me/equipment`）・SC-41 §6（`?period=week|last|month|total`→`this_week|last_week|this_month|all`）・**SC-12 §113（全文検索 `scope=`→`types=`）**・各画面の `Transaction/Activity`→`activities`・`Notification`→`notifications`。
- 各画面 §9/§10 の実装寄り TBD（SC-01 §10 のダッシュボード各パネル件数/並び・SC-12 の検索語演算子/スコア重み・実績カタログ最終値・VRM パーツ 等）＝実装/運用で確定。

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
  - ドキュメント方針＝**設計の正は1箇所・他は参照**（drift 回避）／**設計判断はなぜも併記（必須）**／文書間参照は `doc/規約/ドキュメント作成規約.md`（`CLAUDE.md` から自動参照）／意図的な設計選択は `doc/規約/コーディング規約.md §3.5`・DRY 線引きは §2.3。

---

### 自己チェック（このファイルだけで再開できるか）
- ✅ **再開点＝⑨ドメインK**を §7 冒頭に明記し、入力（SC-31/共通ヘッダー・§5.3/§8-⑬・A.9-⑦）・成果物（`K_プロフィール・背景画像.md`）・論点（`GET/PATCH /me`・ロケール源泉のクロスプレーン・背景/アバター画像 MinIO・A.9-⑦ セキュリティ・Mass Assignment・残高の GET /me 一本化）を具体化。
- ✅ 本セッションの H/I/DRY/ログインボーナス/J を §3 に記録。J は下書き除外・WHERE強制・オフセット・同期索引・`types`。スキーマ変更なし。
- ✅ K/L への申し送り（残高 GET /me 一本化・B-5 の PW 通知発火・publish 契約）を §7 に明記。
- ⚠ A〜J の詳細な決定理由は各 `doc/API設計/*.md` を正とすること（本 handoff は要約）。会話ログは参照不可。
