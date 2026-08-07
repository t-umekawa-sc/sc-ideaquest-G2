# 作業引き継ぎ (handoff)

> 次回セッション開始時に **このファイルだけ読めば作業を再開できる** ことを目的とした引き継ぎメモ。
> 読者は「このセッションの記憶が無い次回の自分」。会話ログは参照不可。詳細仕様は必ず `doc/要件定義/README.md`（唯一の要件定義書）と `doc/API設計/` を参照。
> 毎回このファイルは全文を上書きする（履歴は git に任せる）。

---

## 1. 最終更新日時 / ブランチ / 最新コミット

- 最終更新: **2026-08-07 JST**
- ブランチ: **main**
- 最新コミット（本文）: **`f2ab768`**（規約: コーディング規約 §3.5「意図的な設計選択」追記）。※本 handoff 更新コミットはこの直後（2段方式のため handoff は自分の未来ハッシュを持てず 1 つ前を指す）。
- remote: `https://github.com/t-umekawa-sc/sc-ideaquest-G2.git`
- **プッシュ状況**: `5ecfa72`（ドメインG の handoff 追記）まで origin 反映済み。**`f2ab768`（規約 §3.5）＋本 handoff 更新は未プッシュ**（ユーザー指示でプッシュ）。
- 直近の主なコミット（新しい順）:
  - `f2ab768` 規約: コーディング規約 §3.5「意図的な設計選択」を追記（Functional Core 完全純粋・跨ぎは同一UoW・post-commit+冪等 vs outbox 使い分け）
  - `5ecfa72` handoff: ドメインG 詳細確定を記録
  - `f0ae688` API設計 ドメインG 詳細確定（ゲーミフィケーション／SC-30/31/32/40/41）
  - `d4c0dad` API設計 ドメインF 詳細確定（評価／SC-25・SC-22）
  - `d735017` API設計 ドメインE 詳細確定（チャット・リアクション・魔法発動／SC-24）

---

## 2. このプロジェクトのゴール

- **ideaquest**＝社内のアイデア創出をゲーミフィケーション（XP/コイン/レベル/魔法/ランキング）で促す **WEB アプリ**。これから作る。
- **マルチテナント SaaS**（管理DB 1＋会社DB N の DB 分離）。フロント Next.js／バック FastAPI／PostgreSQL／Redis／MinIO／Docker。
- 現在は **実装前の設計フェーズ**。順序＝要件定義 →データモデル →画面設計 →**API設計（いまここ）**→ 実装。

---

## 3. 今回やったこと — 変更ファイルと理由

今回のセッション＝**(A) ドキュメント作成規約の導入＋規約集約**／**(B) ドメインE**／**(C) C/D/E 門番文の明快化**／**(D) ドメインF**／**(E) ドメインG** の詳細確定。変更したのは **ドキュメントのみ**（コードは無い）。

- **(A)**（`22c9f47`）: `doc/規約/ドキュメント作成規約.md`（汎用）追加＋`CLAUDE.md`（直下・自動参照の入口）新規＋`doc/コーディング規約.md`→`doc/規約/`へ移動。適用方針＝**折衷**。
- **(B)**（`d735017`）: `E_チャット・リアクション・魔法発動.md`。未読 `chat_reads` 新設（§5.31・§8-⑰）／チャット添付は単一 multipart `POST /chat-messages`（E.3 なぜ）／魔法リアクションは `/reactions` に `type` 統合。
- **(C)**（`3b6138d`）: C.0/D.0/E.0 の「グループ非所属も404」文を明快化（意味不変）。
- **(D)**（`d4c0dad`）: `F_評価.md`。選定は F 保有（複数可・XP+200 取消でも剥奪なし）／限定公開は完全非表示／投稿者コイン一括確定＝(a) evaluator 全員 submitted or (b) `completed` 遷移の早い方・`reason=evaluation_coin` 新設（§5.27/§7/§8-⑱）。C の `transition(→completed)` に確定フック注記。
- **(E)**（`f0ae688`・今回の主眼）: `G_ゲーミフィケーション.md`。**実績付与＝台帳(`activities`)書込の post-commit フックで即時判定**（G 一元化・スケジューラ不要・冪等・ティア連動コイン `achievement_reward` 20/50/150・通知 `achievement`）。ショップ購入/装備(部分スロットマップ PUT)/魔法解放(前提+SP検証)/ランキング(period/scope・`me` 常時同梱・週起点月曜JST)。**G.6 に XP/コイン/SP 付与規則の canonical 一覧**（他ドメインが呼ぶ台帳の対応表）。データモデル: §5.27 `reason` に `spell_unlock`/`achievement_reward` 追加・§8-⑲（新テーブル不要＝`activities`＋`achievements.condition` jsonb で表現）。

---

## 4. 現在の状態 — 動いているもの / 壊れているもの / テスト

- **リポジトリは `doc/`・`CLAUDE.md`・`handoff.md` のみ**。アプリのコード・`compose`・テストは**未着手＝存在しない**（`doc/画面設計/mocks/shared.js` はモック資産）。
- **壊れているもの**: なし（本文コミット時点で作業ツリー クリーン）。
- **テスト**: 自動テストは無い（コード未着手）。ドキュメント整合は人手＋Explore で確認。
- **API設計の進捗**: **A/B/C/D/E/F/G ＝詳細確定**（`doc/API設計/` に個別ファイル）。**H〜L ＝未着手**（README §2 一覧に ⬜・目次のみ）。
- 成果物の所在:
  - `CLAUDE.md`（直下・規約自動参照の入口）
  - `doc/要件定義/README.md`（唯一の要件定義書）
  - `doc/データモデル.md`（管理DB6＋**会社DB29テーブル**〔E で `chat_reads` 追加〕・`system_role` 3値）＋`.pdf`（派生・追跡外）
  - `doc/API設計/`（`README.md`＝全体規約＋§2目次／`A_認証・セッション.md`／`B_会社・アカウント・所属.md`／`C_クエスト・パーティー・権限.md`／`D_アイデア・添付・版・投票・フォロー.md`／`E_チャット・リアクション・魔法発動.md`／`F_評価.md`／**`G_ゲーミフィケーション.md`**）
  - `doc/規約/`（`ドキュメント作成規約.md`〔汎用〕／`コーディング規約.md`）
  - `doc/画面設計/`（`screens/` md・`mocks/` html〔入口 `mocks/index.html`〕・`デザイン標準.md`・`画面遷移図.md`）
  - `doc/WEBアプリ開発時のセキュリティ対策一覧.md`（OWASP系・規約 §2.2 で義務化）

---

## 5. 詰まっている点 — 失敗したアプローチと理由

- **現時点でブロッカーは無い**。
- ドメインG で確定した派生判断（再検討不要）: 実績は台帳フック即時付与（各ドメインが実績 API を個別に呼ばない・`activities` 追記で一元判定）／新テーブルは作らない（`achievements.condition` jsonb＋連続ログインは `activities(reason=login)` 日付連続で導出）／残高不足・前提未達・重複は 409 サブコード。
- **過去に採用→撤回**（記録）: D の `publish` を当初 2ステップ非原子としたが部分コミットの穴のため撤回し `content?` を受けるアトミック単一UoW に変更。

---

## 6. 決定事項と根拠（採用しなかった案も）

今回セッションで確定した主な設計判断（ドメインG）:
- **実績付与＝台帳(`activities`)post-commit フックで即時判定・G 一元化**。不採用＝参照時遅延判定（付与/通知/コインが「画面を見た瞬間」に遅延）・定期バッチ（スケジューラ基盤が MVP 未整備）。全付与行動は既に `activities` を書くため判定契機を一元化できる。
- **台帳 canonical は G 保有**（`activities`=真実・`users.*` 残高キャッシュ・付与/消費は同一 UoW・冪等は存在チェック＋購入/解放は `Idempotency-Key`）。付与規則の全一覧は **G.6**（金額の正は §7）。
- **装備は部分スロットマップ PUT**（1クリック=1スロット変更に自然対応・各スロット1点は部分ユニークで DB 保証）。
- **ランキングは `me` 常時同梱**（圏外でも自分の順位）・スコア=獲得XP+コイン（SP 対象外）・週起点 月曜JST・タイブレーク XP→コイン→到達順。
- ドメインE/F の決定は §3-(B)/(D) 参照。
- 規約: **設計の正は1箇所・他は参照**／**設計判断はなぜも併記（必須）**（メモリ [[document-design-rationale]]）。ドキュメント作成規約の適用は**折衷**。

（過去の主要決定＝データモデル §8 の TBD 決着、SoD〔§8-⑯〕、認証は Cookie＋Redis 不透明セッション、リアルタイムは WebSocket＋Redis Pub/Sub〔§1.12〕、i18n JA/EN。詳細は各ドキュメント。）

---

## 7. 次にやること — 優先順・具体的

### ★最優先＝⑥ドメインH（通知）の分割レビュー・詳細確定
段取り「①②③E→④F→⑤G（済 `f0ae688`）→⑥H」。**ユーザーの GO を待って着手**。進め方＝論点整理→決定案提示→ユーザー承認→反映→**2段コミット**。

1. **読む（インプット）**:
   - `doc/画面設計/screens/SC-02_通知一覧.md` ＋ `mocks/SC-02_通知一覧.html`（＋共通ヘッダーのベル）
   - `doc/API設計/README.md` の **§2-H サマリ**・ドメイン一覧表 H 行・**§1.12（WS 配信 `notifications:{user_id}`）**・**§1.13（通知テンプレ/多言語）**
   - `doc/データモデル.md` の **§5.24 notifications**（`type`・`ref_*`・`is_read`）・§3 `notification_type`（`mention`/`idea_comment`/`follow_comment`/`follow_evaluation`/`follow_selection`/`idea_updated`/`achievement`/`magic_reaction`/`security_new_device`/`security_password_changed`）
   - **発火元の各ドメイン**：D.126（follow_*/idea_updated）・E.6（mention/idea_comment/follow_comment/magic_reaction）・F.5（follow_evaluation/follow_selection）・G.4（achievement）・A.9（security_*）
2. **成果物**: `doc/API設計/H_通知.md` を新規作成→ README §2 の H 行 ✅+リンク化・§2-H サマリ記述。
3. **詰める論点（当たり）**: `GET /notifications`（種別/状態フィルタ・カーソル）・`GET /notifications/unread-count`（ベル）・`POST /notifications/{id}/read`・`POST /notifications/read-all`／**通知レコード生成の責務境界**（各ドメインが `notifications` 行を作る＝H は取得/既読/配信テンプレ担当か、H が生成 API を持つか）／多言語テンプレ（§1.13・`locale`）／WS push（§1.12・`notifications:{user_id}`）と REST の役割分担／`security_*` はオプトアウト不可。

### その後（順次）
- **I**（ダッシュボード集約／SC-01・分割 or 集約レスポンス）→ **J**（全文検索・PGroonga／SC-12）→ **K**（プロフィール・背景画像・`GET/PATCH /me`＝残高/ロケール源泉）→ **L**（リアルタイム配信 WebSocket／§1.12・D/E/H の event 発行点を統合）。
- **全ドメイン確定後＝実装スキャフォールド**（Next.js＋FastAPI＋PostgreSQL＋Redis＋MinIO の `compose`）。
- **ドキュメント作成規約の網羅適用（最終パス）**＝設計確定後に A〜G ほかの裸 §x を文書名接頭辞へ一括正規化。

### 未処理の小キュー（軽微・実装 or 該当ドメインで整理）
- **画面 md の旧記法**（軽微・実装時に画面 md を追随）: SC-22 §7（`PUT /vote`）・SC-24 §7（`POST /api/ideas/{id}/chat`）・SC-25 §7（`PUT /api/ideas/{id}/evaluation`）・SC-31 §6（`PUT /me/avatar`→`PUT /me/equipment`）・SC-41 §6（`?period=week|last|month|total`→`this_week|last_week|this_month|all`）・各画面の `Transaction/Activity` 表記（→`activities`）。
- 各画面 §9 の実装寄り TBD（ランキング集計方式/ページング/プライバシー・実績カタログ最終値・VRM パーツ・観点別コメント必須/任意 等）＝実装時 or シードで確定。

---

## 8. 再開に必要な環境情報

- **アプリの起動/テストコマンドは無い**（コード未着手＝`compose`/`package.json`/`pyproject.toml` 未作成）。ポート・環境変数も未定。
- **今使う操作**:
  - `git`（履歴・差分・コミット/プッシュ）。ブランチ `main`・remote `origin`。
  - ドキュメント＝Markdown を読む。画面モック＝`doc/画面設計/mocks/*.html`（入口 `mocks/index.html`）。
  - モック JS の構文チェック＝inline `<script>` を抽出して `node --check`。
- **技術スタック（確定・未構築）**: フロント Next.js(React/App Router)＋Three.js/R3F＋three-vrm ／ バック Python/FastAPI(4層) ／ DB PostgreSQL(管理DB1＋会社DB N) ／ Redis(セッション/OTP/pre-auth/会社コンフィグキャッシュ/冪等キー/Pub-Sub) ／ MinIO(添付・画像) ／ 全て Docker。
- **リポジトリ運用ルール**:
  - `.gitignore` で **`*.pdf` は追跡外**（Markdown が正・PDFは派生）。
  - **コミットは「本体コミット→handoff にハッシュ追記」の2段方式**。末尾に `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。プッシュ先 `origin/main`。
  - ドキュメント方針＝**設計の正は1箇所・他は参照**（drift 回避）／**設計判断はなぜも併記（必須）**／文書間参照は `doc/規約/ドキュメント作成規約.md`（`CLAUDE.md` から自動参照）。

---

### 自己チェック（このファイルだけで再開できるか）
- ✅ 現在地（⑤ドメインG 完了・⑥ドメインH が次）と、H 着手に必要な入力/成果物/論点をファイル・節レベルで記載。
- ✅ 今回の変更（規約=`22c9f47`／E=`d735017`／門番文=`3b6138d`／F=`d4c0dad`／G=`f0ae688`）とプッシュ状況（G＋本 handoff は未プッシュ）を記載。
- ✅ コードは無いこと・テストは存在しないことを明記。会社DB は 29 テーブル（G は新テーブルなし＝`activities`+`condition` で実現）。
- ⚠ A〜G の詳細な決定理由は各 `doc/API設計/*.md` を正とすること（本 handoff は要約）。
