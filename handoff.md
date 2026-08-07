# 作業引き継ぎ (handoff)

> 次回セッション開始時に **このファイルだけ読めば作業を再開できる** ことを目的とした引き継ぎメモ。
> 読者は「このセッションの記憶が一切ない次回の自分」。会話ログは参照不可。詳細仕様は必ず `doc/要件定義/README.md`（唯一の要件定義書）と `doc/API設計/` を参照。
> 毎回このファイルは全文を上書きする（履歴は git に任せる）。
>
> **次回の開始点＝`doc/API設計/H_通知.md` の確認（レビュー）から**（§7 参照）。

---

## 1. 最終更新日時 / ブランチ / 最新コミット

- 最終更新: **2026-08-07 JST**（セッション終了時）
- ブランチ: **main**（`origin/main` と同期・作業ツリー クリーン＝確認済み）
- 最新コミット（本文＝直近の内容変更）: **`03f6aa4`**（API設計 ドメインH 詳細確定）。その handoff 追記が **`0285831`**。
  - ※**本 handoff（セッション終了版）更新コミットはこの直後**＝2段方式のため handoff は自分の未来ハッシュを持てず、ここでは 1 つ前（`0285831`）までを指す。
- remote: `https://github.com/t-umekawa-sc/sc-ideaquest-G2.git`
- **プッシュ状況**: `0285831` まで origin 反映済み。**本 handoff 更新のみ未プッシュ→本作業でコミット＆プッシュする**。
- 直近の主なコミット（新しい順）:
  - `0285831` handoff: ドメインH 詳細確定を記録
  - `03f6aa4` API設計 ドメインH 詳細確定（通知／SC-02）
  - `a12f3b5` handoff: コーディング規約 §3.5 追記を記録
  - `f2ab768` 規約: コーディング規約 §3.5「意図的な設計選択」を追記
  - `f0ae688` API設計 ドメインG 詳細確定（ゲーミフィケーション）

---

## 2. このプロジェクトのゴール

- **ideaquest**＝社内のアイデア創出をゲーミフィケーション（XP/コイン/レベル/魔法/ランキング）で促す **WEB アプリ**（マルチテナント SaaS・管理DB1＋会社DB N）。
- スタック＝フロント Next.js／バック FastAPI／PostgreSQL／Redis／MinIO／Docker。
- 現在は **実装前の設計フェーズ**（要件定義→データモデル→画面設計→**API設計（いまここ）**→実装）。

---

## 3. 今回やったこと — 変更ファイルと理由

今セッション＝**規約整備＋API設計 E→F→G→H の詳細確定**。変更は **ドキュメントのみ**（コードは無い）。各項目は「本体コミット→handoff にハッシュ追記」の2段でコミット済み・プッシュ済み。

- **規約**（`22c9f47`）: `doc/規約/ドキュメント作成規約.md`（汎用・文書間参照ルール）追加＋リポジトリ直下 `CLAUDE.md`（規約を毎セッション自動参照）新規＋`doc/コーディング規約.md`→`doc/規約/`へ移動。適用方針＝**折衷**。／（`f2ab768`）**コーディング規約 §3.5「意図的な設計選択」**を追記（完全 Functional Core・跨ぎは同一UoW・post-commit+冪等 vs outbox の使い分け）。
- **E**（`d735017`）: `doc/API設計/E_チャット・リアクション・魔法発動.md`。未読 `chat_reads` 新設（データモデル §5.31・§8-⑰）／チャット添付は単一 multipart `POST /chat-messages`（E.3 に「D と形が違う理由」）／魔法リアクションは `/reactions` に `type` 統合。
- **門番文明快化**（`3b6138d`）: C.0/D.0/E.0 の「グループ非所属も404」文を主語・行を補い明快化（意味不変）。
- **F**（`d4c0dad`）: `doc/API設計/F_評価.md`。選定は F 保有（`POST/DELETE /ideas/{id}/select`・複数可・XP+200 は取消でも剥奪なし）／限定公開は範囲外へ完全非表示／投稿者コイン確定＝(a) evaluator 全員 submitted or (b) `completed` 遷移の早い方（`reason=evaluation_coin`・§8-⑱）。C の `transition(→completed)` に確定フック注記。
- **G**（`f0ae688`）: `doc/API設計/G_ゲーミフィケーション.md`。実績付与＝台帳(`activities`) post-commit フックで即時判定（G 一元化）／台帳 canonical＝G.6／装備は部分スロットマップ `PUT /me/equipment`／ランキング `me` 常時同梱。`activities.reason` に `spell_unlock`/`achievement_reward` 追加（§8-⑲）。
- **H**（`03f6aa4`・直近）: `doc/API設計/H_通知.md`。**通知本文は取得時レンダリングで完全多言語化**＝`notifications.params jsonb` 追加・`body` を NULL 可フォールバックへ緩和（データモデル §5.24・§8-⑳）／**1 イベント×1 宛先は最具体種別で1件に集約**（重複排除）／生成は各発火ドメインが H の `notify()` を post-commit 呼び出し・H は取得/未読/既読 API＋テンプレ多言語・WS 配信は L。

---

## 4. 現在の状態 — 動いているもの / 壊れているもの / テスト

- **リポジトリは `doc/`・`CLAUDE.md`・`handoff.md` のみ**。アプリのコード・`compose`・テストは**未着手＝存在しない**（`doc/画面設計/mocks/shared.js` はモック用資産）。
- **壊れているもの**: なし（作業ツリー クリーン＝確認済み）。
- **テスト**: 自動テストは無い（コード未着手）。ドキュメント整合は人手＋Explore で確認（機械的テストではない）。
- **API設計の進捗（確認済み・`doc/API設計/` 実在）**: **A/B/C/D/E/F/G/H ＝詳細確定**（個別ファイルあり・README §2 一覧で ✅）。**I/J/K/L ＝未着手**（README §2 一覧で ⬜・目次のみ）。
- 成果物の所在:
  - `CLAUDE.md`（直下・規約自動参照の入口）
  - `doc/要件定義/README.md`（唯一の要件定義書）
  - `doc/データモデル.md`（管理DB6＋**会社DB29テーブル**〔E で `chat_reads` 追加・H は `notifications` へ列追加のみ〕・`system_role` 3値）＋`.pdf`（派生・追跡外）
  - `doc/API設計/`（`README.md`＝全体規約＋§2目次／`A_…`〜`H_通知.md` の8ドメイン）
  - `doc/規約/`（`ドキュメント作成規約.md`〔汎用〕／`コーディング規約.md`〔§3.5 意図的選択を含む〕）
  - `doc/画面設計/`（`screens/` md・`mocks/` html〔入口 `mocks/index.html`〕・`デザイン標準.md`・`画面遷移図.md`）
  - `doc/WEBアプリ開発時のセキュリティ対策一覧.md`（OWASP系・規約 §2.2 で義務化）

---

## 5. 詰まっている点 — 失敗したアプローチと理由

- **現時点でブロッカーは無い**。
- 今回確定した派生判断（再検討不要）: 通知本文は取得時レンダリング（`params` に発火時点スナップショット・ref から辿れる件名は都度解決）／通知生成は post-commit best-effort＋発火側冪等（確実配送が要件化したら outbox＝コーディング規約 §3.5-(3)）／1 イベント×1 宛先は最具体種別1件。
- **過去に採用→撤回**（記録）: D の `publish` を当初「2ステップ非原子」としたが**部分コミットの穴**（PATCH 後の publish 失敗を巻き戻せない）のため撤回し、`content?` を受ける**アトミック単一UoW**へ変更。

---

## 6. 決定事項と根拠（採用しなかった案も）

直近（ドメインH）で確定した主判断:
- **通知本文＝取得時レンダリングで完全多言語化**（`notifications.params jsonb` 追加・`body` NULL 可フォールバック）。不採用＝生成時に確定保存（受信者のロケール切替で既存通知が追従しない）。i18n 最大化を優先（§8-⑳）。
- **1 イベント×1 宛先は最具体種別で1件に集約**（優先 `mention>idea_comment>follow_comment`）。不採用＝種別ごとに複数生成（通知洪水）。
- **責務境界**＝生成は各発火ドメイン（post-commit で H の `notify()` 呼び出し）／H は取得・未読・既読 API＋テンプレ多言語／WS 配信は L。

過去セッションの主判断（要約・正は各 `doc/API設計/*.md`）:
- E＝未読 `chat_reads` 新設・チャット添付 単一 multipart・魔法リアクション統合 EP。
- F＝選定 F 保有(複数可・XP 取消なし)・限定公開 完全非表示・投稿者コイン確定トリガ(全 evaluator submitted or completed の早い方)。
- G＝実績は台帳フック即時付与(G 一元化)・台帳 canonical=G.6・装備 部分マップ PUT。
- 全体＝設計の正は1箇所・他は参照／なぜも併記（必須・メモリ [[document-design-rationale]]）／意図的な設計選択は コーディング規約 §3.5／認証は Cookie＋Redis 不透明セッション／リアルタイムは WebSocket＋Redis Pub/Sub（§1.12）／i18n JA/EN。

---

## 7. 次にやること — 優先順に、具体的に

### ★最優先＝(1) `doc/API設計/H_通知.md` の確認（レビュー）から再開
**ユーザー指定の再開点**。まず H を読み直し、整合を検証する。読む対象＝`doc/API設計/H_通知.md`（節＝H.0 責務境界／H.1 `notify()`／H.2 取得・未読数／H.3 既読・未読／H.4 境界・TBD）。**突き合わせて確認する観点**:
- **発火点の整合**：H.0 の「種別×発火ドメイン×`ref_*`×`params`」表が、各ドメインの発火記述と一致するか＝`doc/API設計/D_….md` D.126（`follow_*`/`idea_updated`）・`E_….md` E.6（`mention`/`idea_comment`/`follow_comment`/`magic_reaction`）・`F_評価.md` F.5（`follow_evaluation`/`follow_selection`）・`G_ゲーミフィケーション.md` G.4（`achievement`）・`A_認証・セッション.md` A.9（`security_*`）。
- **データモデル整合**：`doc/データモデル.md` §5.24（`params jsonb`／`body` NULL 可）・§8-⑳・§3 `notification_type`（10 種別）と H の記述が一致するか。
- **取得時レンダリング/多言語**：§8-⑬（バックエンドのロケール対応メッセージ）と H.2 のレンダリング手順（テンプレ×`recipient.locale`×`params`＋`ref_*`）の整合。
- **重複排除ルール**（H.1）と E.6 が H へ先送りした記述の整合。
- **WS 連携**：§1.12（`notifications:{user_id}`）と H の「配信は L・H は真実(REST)」の整合。
- 指摘が出たら **論点整理→決定案提示→ユーザー承認→反映→2段コミット**（本体→handoff にハッシュ追記）。**確認が取れるまでコード/ドキュメントは変更しない**。

### (2) H 確認後＝⑦ドメインI（ダッシュボード集約／SC-01）の詳細確定
- 読む: `doc/画面設計/screens/SC-01_ダッシュボード.md`（**§10 未決＝集約 or 分割レスポンス**）＋`mocks/SC-01_ダッシュボード.html`／`doc/API設計/README.md` §2-I・一覧表 I 行。
- 参照する取得系: C（`GET /quests`＝参加中/下書き）・D（`GET /quests/{id}/ideas`＝下書き/未投票・`GET /ideas/{id}`）・F（フォロー中の評価）・G（`GET /rankings` 週間TOP3＋自分・残高ヒーロー）・H（`GET /notifications` 最近）／データモデル §5.3 users(残高)・§5.23 follows。
- 成果物: `doc/API設計/I_ダッシュボード集約.md` を新規作成→ README §2 の I 行 ✅+リンク化・§2-I サマリ記述。
- 詰める論点: **`GET /dashboard` 1レスポンス集約 か 分割並列 か**（SC-01 §10 未決＝ここで決める）／各パネル（下書き〔クエスト/アイデア/評価〕・未投票・参加中クエスト・フォロー中・週間ランキングTOP3＋自分・ヒーロー〔Lv/XP/コイン/SP〕・最近の通知）の形と件数上限／I は新規ロジックを持たず取得系の合成に徹するか／通知本文は H の取得時レンダリングを通す。

### その後（順次）
- **J**（全文検索・PGroonga／SC-12・§1.11/§6）→ **K**（プロフィール・背景画像・`GET/PATCH /me`＝残高/ロケール源泉・A.9 委譲のセキュリティ）→ **L**（リアルタイム配信 WebSocket／§1.12・D/E/H の event 発行点を統合＝最後）。
- **全ドメイン確定後＝実装スキャフォールド**（`compose`＋Next.js/FastAPI/PostgreSQL/Redis/MinIO・ディレクトリは コーディング規約 §3.4/§4.1）。
- **ドキュメント作成規約の網羅適用（最終パス）**＝設計確定後に A〜H ほかの裸 §x を文書名接頭辞へ一括正規化（今は「折衷」で新規のみ準拠）。

### 未処理の小キュー（軽微・実装 or 該当ドメインで整理）
- **画面 md の旧記法**（実装時に画面 md を追随）: SC-22 §7（`PUT /vote`）・SC-24 §7（`POST /api/ideas/{id}/chat`）・SC-25 §7（`PUT /api/ideas/{id}/evaluation`）・SC-31 §6（`PUT /me/avatar`→`PUT /me/equipment`）・SC-41 §6（`?period=week|last|month|total`→`this_week|last_week|this_month|all`）・各画面の `Transaction/Activity`→`activities`・`Notification`→`notifications`。
- 各画面 §9 の実装寄り TBD（通知グルーピング/保持期間/種別ON-OFF・ランキング集計方式/ページング・実績カタログ最終値・VRM パーツ 等）＝実装時 or 運用で確定。

---

## 8. 再開に必要な環境情報

- **アプリの起動/テストコマンドは無い**（コード未着手＝`compose`/`package.json`/`pyproject.toml` いずれも未作成・確認済み）。ポート・環境変数も**未定（未確認）**。
- **今使う操作**:
  - `git`（履歴・差分・コミット/プッシュ）。ブランチ `main`・remote `origin`。
  - ドキュメント＝Markdown を読む。画面モック＝`doc/画面設計/mocks/*.html` をブラウザで開く（入口 `mocks/index.html`）。
  - モック JS の構文チェック＝inline `<script>` を抽出して `node --check`（今後モックを触る場合）。
- **技術スタック（確定・未構築）**: フロント Next.js(React/App Router)＋Three.js/R3F＋three-vrm ／ バック Python/FastAPI(4層＝router→application→domain→repository) ／ DB PostgreSQL(管理DB1＋会社DB N) ／ Redis(セッション/OTP/pre-auth/会社コンフィグキャッシュ/冪等キー/Pub-Sub) ／ MinIO(添付・画像) ／ 全て Docker。
- **リポジトリ運用ルール**:
  - `.gitignore` で **`*.pdf` は追跡外**（Markdown が正・PDFは派生）。
  - **コミットは「本体コミット→handoff にハッシュ追記」の2段方式**。コミットメッセージ末尾に `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。プッシュ先 `origin/main`。
  - ドキュメント方針＝**設計の正は1箇所・他は参照**（drift 回避）／**設計判断はなぜも併記（必須）**／文書間参照は `doc/規約/ドキュメント作成規約.md`（`CLAUDE.md` から自動参照）／意図的な設計選択は `doc/規約/コーディング規約.md §3.5`。

---

### 自己チェック（このファイルだけで再開できるか）
- ✅ **再開点＝H_通知.md の確認**を §7 冒頭に明記し、確認観点を突き合わせ対象（D.126/E.6/F.5/G.4/A.9・§5.24/§8-⑳/§1.12）までファイル・節レベルで記載。その後の I 着手の入力/成果物/論点も具体化。
- ✅ 今回の変更（規約=`22c9f47`/`f2ab768`／E=`d735017`／門番文=`3b6138d`／F=`d4c0dad`／G=`f0ae688`／H=`03f6aa4`）と、各がプッシュ済み・本 handoff のみ未プッシュ（→本作業でプッシュ）を記載。
- ✅ コードは無いこと・テストは存在しないこと・起動/テストコマンドとポート/環境変数は未定（未確認）を明記。会社DB は 29 テーブル（H は列追加のみ＝`notifications.params`・新テーブルなし）。
- ⚠ A〜H の詳細な決定理由は各 `doc/API設計/*.md` を正とすること（本 handoff は要約）。会話ログは参照不可。
