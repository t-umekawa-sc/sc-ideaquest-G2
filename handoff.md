# 作業引き継ぎ (handoff)

> 次回セッション開始時に **このファイルだけ読めば作業を再開できる** ことを目的とした引き継ぎメモ。
> 読者は「このセッションの記憶が一切ない次回の自分」。会話ログは参照不可。詳細仕様は必ず `doc/要件定義/README.md`（唯一の要件定義書）と `doc/API設計/` を参照。
> 毎回このファイルは全文を上書きする（履歴は git に任せる）。
>
> **次回の開始点＝⑦ドメインI（ダッシュボード集約／SC-01）の詳細確定**（§7 参照）。A〜H は詳細確定済み。

---

## 1. 最終更新日時 / ブランチ / 最新コミット

- 最終更新: **2026-08-08 JST**（セッション終了時）
- ブランチ: **main**（`origin/main` と同期・作業ツリー クリーン想定）
- 最新コミット（本文＝直近の内容変更）: **H レビュー指摘の反映**（`doc/API設計/H_通知.md` ほか D/E/README を更新）。**このコミット直後に本 handoff 追記コミットを行う 2 段方式**のため、本文コミットのハッシュは下記「直近コミット」欄を確認（handoff は自分の未来ハッシュを持てない）。
- remote: `https://github.com/t-umekawa-sc/sc-ideaquest-G2.git`
- **プッシュ状況**: 本文コミット＋本 handoff コミットを **origin/main へプッシュ済み**（当セッションで実施）。
- 直近の主なコミット（新しい順・ハッシュは `git log --oneline` で確認）:
  - （本セッション）H レビュー指摘の反映（H 本体＋D/E/README）
  - `9f7ec4a` handoff: セッション終了・全文更新（前セッション末）
  - `03f6aa4` API設計 ドメインH 詳細確定（通知／SC-02）
  - `f0ae688` API設計 ドメインG 詳細確定（ゲーミフィケーション）
  - `d4c0dad` API設計 ドメインF 詳細確定（評価）

---

## 2. このプロジェクトのゴール

- **ideaquest**＝社内のアイデア創出をゲーミフィケーション（XP/コイン/レベル/魔法/ランキング）で促す **WEB アプリ**（マルチテナント SaaS・管理DB1＋会社DB N）。
- スタック＝フロント Next.js／バック FastAPI／PostgreSQL／Redis／MinIO／Docker。
- 現在は **実装前の設計フェーズ**（要件定義→データモデル→画面設計→**API設計（いまここ）**→実装）。

---

## 3. 今回やったこと — 変更ファイルと理由

今セッション＝**`doc/API設計/H_通知.md` の確認（レビュー）と、指摘の反映**。変更は **ドキュメントのみ**（コードは無い）。

- **設計論点の合意（A案）**: `notify(recipient_ids, type, refs, params)` の責務分担を確定。**宛先解決＝発火ドメイン（自分のデータ）／重複排除の畳み込み＝H の純粋 domain／INSERT＋Redis publish＝H の repository（post-commit）**。判断材料は `refs`（ref から解決）と `params`（発火時点スナップショット）に集約され、application は肥大化しない。コーディング規約 §3.1/§3.5-(1)（完全 Functional Core）と両立。
- **H レビューで見つけた不整合を反映**（本セッションの本体コミット）:
  - **B-1**: `D_….md` D.4 の `idea_updated` 通知が「同一 UoW」だったのを **post-commit（best-effort＋冪等＝at-most-once）** に修正（§3.5-(3)・H.1 と整合）。ref に `ref_idea_id` も追記。
  - **B-2**: **`notifications:{user_id}` の Redis publish は H の `notify()`（post-commit）が担う**ことを明記（H.0/H.1）。`E_….md` E.7（E は `chat:{group}` のみ発行）・`README.md` §1.4 の発行者列を整理。
  - **B-3**: H.0 表の chat 系4種別（mention/idea_comment/follow_comment/magic_reaction）の `ref_*` に **`ref_idea_id`** を追記（E.6 と一致・件名レンダリング/遷移のため）。
  - **B-4**: H.2 の `meta` から「選定」を除外＝**本人が獲得した値のみ（`achievement` のコイン）**。`follow_selection` の宛先はフォロワーで投稿者の XP/コインは載せない（F.5＝投稿者向け選定通知は現状無し）。
  - **B-5**: `security_password_changed` の発火元に **K（プロフィールの自己PW変更・A.9-⑧(b)）** を追記（K は未着手・契約の先取り）。
  - **C-1〜C-6**（H 内の明確化）: 冪等の意味論＝**at-most-once**（自動リトライしない＝取りこぼしあり得るが二重は無い・dedup キーは実績の `UNIQUE` のみ）／`magic_reaction` の `params.spell` は**識別子（spell_id/code）を凍結**し表示名は取得時解決／`idea_updated` の `params.revision` は表示最適化の**意図的例外**として明示／`read-all` の文言を `type` フィルタのみに訂正／H.4 に**§2.2 セキュリティ突合**（主リスク＝IDOR・自分宛のみ 404）を追記／H.4 残 TBD に**参照先が論理削除/tombstone のときの取得時レンダリング**を追加。

---

## 4. 現在の状態 — 動いているもの / 壊れているもの / テスト

- **リポジトリは `doc/`・`CLAUDE.md`・`handoff.md` のみ**。アプリのコード・`compose`・テストは**未着手＝存在しない**（`doc/画面設計/mocks/shared.js` はモック用資産）。
- **壊れているもの**: なし。
- **テスト**: 自動テストは無い（コード未着手）。ドキュメント整合は人手＋Explore で確認（機械的テストではない）。
- **API設計の進捗（`doc/API設計/` 実在）**: **A/B/C/D/E/F/G/H ＝詳細確定**（個別ファイルあり・README §2 一覧で ✅）。**I/J/K/L ＝未着手**（README §2 一覧で ⬜・目次のみ）。
- 成果物の所在:
  - `CLAUDE.md`（直下・規約自動参照の入口）
  - `doc/要件定義/README.md`（唯一の要件定義書）
  - `doc/データモデル.md`（管理DB6＋**会社DB29テーブル**・`notifications` は §5.24。H の反映はスキーマ変更なし＝運用/表現の明確化のみ）＋`.pdf`（派生・追跡外）
  - `doc/API設計/`（`README.md`＝全体規約＋§2目次／`A_…`〜`H_通知.md` の8ドメイン）
  - `doc/規約/`（`ドキュメント作成規約.md`〔汎用〕／`コーディング規約.md`〔§3.5 意図的選択を含む〕）
  - `doc/画面設計/`（`screens/` md・`mocks/` html〔入口 `mocks/index.html`〕・`デザイン標準.md`・`画面遷移図.md`）
  - `doc/WEBアプリ開発時のセキュリティ対策一覧.md`（OWASP系・規約 §2.2 で義務化）

---

## 5. 詰まっている点 — 失敗したアプローチと理由

- **現時点でブロッカーは無い**。
- 今回確定した派生判断（再検討不要）: `notify()` の責務分担＝A案（宛先解決は発火側／畳み込みは純粋 domain／INSERT＋Redis publish は H の repository・post-commit）／通知配信の Redis publish は H が発行・L は WS 転送に徹する／通知は at-most-once（取りこぼしゼロが要件化したら outbox・§3.5-(3)）。
- **過去に採用→撤回**（記録）: D の `publish` を当初「2ステップ非原子」としたが部分コミットの穴のため撤回し、`content?` を受ける**アトミック単一UoW**へ変更。

---

## 6. 決定事項と根拠（採用しなかった案も）

本セッション（H レビュー）で確定した主判断:
- **`notify()` はA案**（宛先解決＝発火ドメイン／重複排除畳み込み＝H 純粋 domain／INSERT＋Redis publish＝H repository・post-commit）。不採用＝(B) H が他モジュールのデータを横断参照して宛先解決まで行う（H がハブ化・境界崩壊）／(C) `notify()` 完全純粋で application が全 DB（肥大化＋ロジック分散）。
- **Redis publish は H の `notify()` が担う**（L は WS トランスポート）。不採用＝E/発火側が通知チャネルへ直接 publish（通知の関心が分散）。
- **通知は at-most-once**（post-commit・自動リトライなし）。不採用＝全種別に dedup キー付与（過剰・実績の `UNIQUE` で十分）。

過去セッションの主判断（要約・正は各 `doc/API設計/*.md`）:
- H＝取得時レンダリングで完全多言語化（`notifications.params jsonb`・`body` NULL 可）／1 イベント×1 宛先は最具体種別1件に集約。
- G＝実績は台帳フック即時付与（G 一元化）・台帳 canonical=G.6・装備 部分マップ PUT。
- F＝選定 F 保有（複数可・XP 取消なし）・限定公開 完全非表示・投稿者コイン確定トリガ（全 evaluator submitted or completed の早い方）。
- E＝未読 `chat_reads` 新設・チャット添付 単一 multipart・魔法リアクション統合 EP。
- 全体＝設計の正は1箇所・他は参照／なぜも併記（必須・メモリ [[document-design-rationale]]）／意図的な設計選択は コーディング規約 §3.5／認証は Cookie＋Redis 不透明セッション／リアルタイムは WebSocket＋Redis Pub/Sub（§1.12）／i18n JA/EN。

---

## 7. 次にやること — 優先順に、具体的に

### ★最優先＝⑦ドメインI（ダッシュボード集約／SC-01）の詳細確定
- 読む: `doc/画面設計/screens/SC-01_ダッシュボード.md`（**§10 未決＝集約 or 分割レスポンス**）＋`mocks/SC-01_ダッシュボード.html`／`doc/API設計/README.md` §2-I・一覧表 I 行。
- 参照する取得系: C（`GET /quests`＝参加中/下書き）・D（`GET /quests/{id}/ideas`＝下書き/未投票・`GET /ideas/{id}`）・F（フォロー中の評価）・G（`GET /rankings` 週間TOP3＋自分・残高ヒーロー）・H（`GET /notifications` 最近）／データモデル §5.3 users(残高)・§5.23 follows。
- 成果物: `doc/API設計/I_ダッシュボード集約.md` を新規作成→ README §2 の I 行 ✅+リンク化・§2-I サマリ記述。
- 詰める論点: **`GET /dashboard` 1レスポンス集約 か 分割並列 か**（SC-01 §10 未決＝ここで決める）／各パネル（下書き〔クエスト/アイデア/評価〕・未投票・参加中クエスト・フォロー中・週間ランキングTOP3＋自分・ヒーロー〔Lv/XP/コイン/SP〕・最近の通知）の形と件数上限／I は新規ロジックを持たず取得系の合成に徹するか／通知本文は H の取得時レンダリングを通す。

### その後（順次）
- **J**（全文検索・PGroonga／SC-12・§1.11/§6）→ **K**（プロフィール・背景画像・`GET/PATCH /me`＝残高/ロケール源泉・A.9 委譲のセキュリティ。**H の `security_password_changed` を K が発火する契約を実装に落とす**〔B-5〕）→ **L**（リアルタイム配信 WebSocket／§1.12・D/E/H の event 発行点を統合＝最後。**通知チャネル `notifications:{user_id}` の publish は H の `notify()`・L は購読→WS 転送**という本セッションの契約を踏襲）。
- **全ドメイン確定後＝実装スキャフォールド**（`compose`＋Next.js/FastAPI/PostgreSQL/Redis/MinIO・ディレクトリは コーディング規約 §3.4/§4.1）。
- **ドキュメント作成規約の網羅適用（最終パス）**＝設計確定後に A〜H ほかの裸 §x を文書名接頭辞へ一括正規化（今は「折衷」で新規のみ準拠）。

### 未処理の小キュー（軽微・実装 or 該当ドメインで整理）
- **画面 md の旧記法**（実装時に画面 md を追随）: SC-22 §7（`PUT /vote`）・SC-24 §7（`POST /api/ideas/{id}/chat`）・SC-25 §7（`PUT /api/ideas/{id}/evaluation`）・SC-31 §6（`PUT /me/avatar`→`PUT /me/equipment`）・SC-41 §6（`?period=week|last|month|total`→`this_week|last_week|this_month|all`）・各画面の `Transaction/Activity`→`activities`・`Notification`→`notifications`。
- 各画面 §9 の実装寄り TBD（通知グルーピング/保持期間/種別ON-OFF・ランキング集計方式/ページング・実績カタログ最終値・VRM パーツ 等）＝実装時 or 運用で確定。
- H.4 で明示した TBD（通知グルーピング／保持期間・件数上限・自動既読／参照先削除時の取得時レンダリング）＝実装 or 運用で確定。

---

## 8. 再開に必要な環境情報

- **アプリの起動/テストコマンドは無い**（コード未着手＝`compose`/`package.json`/`pyproject.toml` いずれも未作成）。ポート・環境変数も**未定（未確認）**。
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
- ✅ **再開点＝⑦ドメインI**を §7 冒頭に明記し、入力（SC-01 §10 未決）・成果物（`I_ダッシュボード集約.md`）・論点（集約 or 分割）を具体化。
- ✅ 本セッションの H レビュー反映（B-1〜B-5・C-1〜C-6）を §3 に列挙。波及先＝H 本体／D.4／E.7／README §1.4。データモデルはスキーマ変更なし。
- ✅ `notify()` の責務＝A案・Redis publish は H・通知は at-most-once を §5/§6 に確定記録。K/L への申し送り（B-5・publish 契約）を §7 に明記。
- ⚠ A〜H の詳細な決定理由は各 `doc/API設計/*.md` を正とすること（本 handoff は要約）。会話ログは参照不可。
