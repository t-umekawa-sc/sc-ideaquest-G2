# 作業引き継ぎ (handoff)

> 次回セッション開始時に **このファイルだけ読めば作業を再開できる** ことを目的とした引き継ぎメモ。
> 読者は「このセッションの記憶が一切ない次回の自分」。会話ログは参照不可。詳細仕様は必ず `doc/要件定義/README.md`（唯一の要件定義書）と `doc/API設計/` を参照。
> 毎回このファイルは全文を上書きする（履歴は git に任せる）。
>
> **次回の開始点＝API設計は A〜L 全確定。次フェーズ＝実装スキャフォールド（の計画）**（§7 参照）。着手前にユーザーへ範囲確認。

---

## 1. 最終更新日時 / ブランチ / 最新コミット

- 最終更新: **2026-08-08 JST**（セッション終了時）
- ブランチ: **main**（`origin/main` と同期・作業ツリー クリーン）
- 最新コミット（本文＝直近の内容変更）: **API設計 ドメインL 詳細確定**（`L_リアルタイム配信.md` 新規＋README §2/§1.14＋E.7 の event 名を canonical 化）。**このコミット直後に本 handoff 追記コミット**（2 段方式）。ハッシュは `git log --oneline` で確認。
- remote: `https://github.com/t-umekawa-sc/sc-ideaquest-G2.git`
- **プッシュ状況**: 本文コミット＋本 handoff コミットを **origin/main へプッシュ済み**（当セッションで実施）。
- 直近の主なコミット（新しい順・ハッシュは `git log --oneline` で確認）:
  - （本セッション）API設計 ドメインL 詳細確定（リアルタイム配信・WebSocket）
  - `0f86dbe` ドメインK 詳細確定（プロフィール・背景画像）
  - `7a5cf47` ドメインJ J.5 に snippet_html 出力形を明記
  - `bbf8a41` ドメインJ 門番を精緻化

---

## 2. このプロジェクトのゴール

- **ideaquest**＝社内のアイデア創出をゲーミフィケーション（XP/コイン/レベル/魔法/ランキング）で促す **WEB アプリ**（マルチテナント SaaS・管理DB1＋会社DB N）。
- スタック＝フロント Next.js／バック FastAPI／PostgreSQL（全文検索 PGroonga）／Redis／MinIO／Docker。
- 現在は **実装前の設計フェーズの最終盤**。**API設計 A〜L が全確定**＝次は実装スキャフォールドへ。

---

## 3. 今回やったこと — 変更ファイルと理由

今セッション＝**H レビュー反映→⑦I→規約§2.3 DRY→ログインボーナス一般化→⑧J（＋門番精緻化＋J.5 明記）→⑨K→⑩L** を順に確定し、**API設計 A〜L を完了**。変更は **ドキュメントのみ**（コードは無い）。各段階で「本体→handoff にハッシュ追記」の2段コミット・プッシュ済み。

### 3.7 ドメインL 詳細確定（リアルタイム配信・本セッションの本体コミット）
- 大枠は README §1.12 で既決。本レビューで統合・確定:
  - `GET /realtime`（Cookie セッション認証・未認証 401 クローズ・`company_id` バインド）／**配信専用**（書き込みは REST・L は購読→WS 転送のみ・publish もしない）。
  - トピック＝常時 `notifications:{user_id}`（接続時自動）／動的 `chat:{chat_group_id}`（`subscribe`/`unsubscribe`・**購読時に C.0/E.0 門番＝パーティー＋クエストグループ所属の AND を検証**）。
  - **イベントカタログを canonical 統一（ドット記法・§1.12 準拠）**＝`chat.message.created/updated/deleted`・`chat.reaction.added/removed`・`notification.created`・`notification.unread_count`（`data` は E.1／H.2 準拠）。→ **E.7 の underscore 名を canonical のドット記法へ更新**（drift 回避）。
  - **publisher の正確化**＝`chat:{group}` は **E のみ**／`notifications:{user_id}` は **H の `notify()`**（D の `idea_updated` 等も H 経由）。→ README §1.14/§2-L の「D/E」「D/E/H」表現を正確化。
  - **購読中の認可失効**＝パーティー/グループ除去時に購読を**強制ドロップ＋再接続時に再検証**（不採用＝毎 fan-out で権限再チェック／放置）。
  - 再同期の真実は REST（`GET /ideas/{id}/chat?after=`／`GET /notifications`＋未読数）・WS は速報。fan-out＝Redis Pub/Sub・ping/pong。
- 成果物＝`doc/API設計/L_リアルタイム配信.md` 新規（L.0〜L.5）＋README §2 の L 行 ✅+リンク＋§2-L サマリ＋§1.14 正確化＋E.7 event 名 canonical 化。スキーマ変更なし。

### 3.6 ドメインK（プロフィール・背景画像）
- `display_name` 源泉＝accounts（1b・`accounts.display_name` 列追加・`users` はミラー）／`GET /me` 正準（I の hero と両立）／`PATCH /me`＝display_name/locale（accounts+outbox 単一制御プレーン Tx）／`POST /me/password`（現在PW再確認→§A.9-③＋H 通知）／`POST /me/email`（再認証）／画像は会社DB 直接＋署名URL。

### 3.5 ドメインJ（全文検索・PGroonga）
- 対象＝ideas/chat_messages/attachments・門番＝パーティー＋グループ AND・可視範囲は WHERE 強制（下書き除外・completed 可）・結果 UNION score 降順・オフセットページング・同期索引・snippet_html はサニタイズ。

### 3.4 ログインボーナス付与契機の一般化
- 「新しい暦日（JST）の最初の認証済みリクエスト」（判定=純粋・付与=冪等台帳・契機=セッション解決依存性・日境界 JST）。

### 3.3 規約 §2.3「DRY」追記／3.2 ドメインI（ダッシュボード集約・集約1本 GET /dashboard）／3.1 ドメインH レビュー反映（notify() A案・B-1〜C-6）。

---

## 4. 現在の状態 — 動いているもの / 壊れているもの / テスト

- **リポジトリは `doc/`・`CLAUDE.md`・`handoff.md` のみ**。アプリのコード・`compose`・テストは**未着手＝存在しない**（`doc/画面設計/mocks/shared.js` はモック用資産）。
- **壊れているもの**: なし。
- **テスト**: 自動テストは無い（コード未着手）。ドキュメント整合は人手＋Explore で確認。
- **API設計の進捗（`doc/API設計/` 実在）**: **A〜L ＝全12ドメイン 詳細確定完了**（個別ファイルあり・README §2 一覧で全て ✅）。**未着手ドメインは無し**。
- 成果物の所在:
  - `CLAUDE.md`（直下・規約自動参照の入口）
  - `doc/要件定義/README.md`（唯一の要件定義書）
  - `doc/データモデル.md`（管理DB6＋**会社DB29テーブル**。§6 PGroonga。`accounts.display_name` 追加済〔K〕）＋`.pdf`（派生・追跡外）
  - `doc/API設計/`（`README.md`＝全体規約＋§2目次／`A_…`〜`L_リアルタイム配信.md` の**12ドメイン全確定**）
  - `doc/規約/`（`ドキュメント作成規約.md`〔汎用〕／`コーディング規約.md`〔§2.3 DRY・§3.1 4層・§3.4 ディレクトリ・§3.5 意図的選択・§4.1 フロント構成〕）
  - `doc/画面設計/`（`screens/` md・`mocks/` html〔入口 `mocks/index.html`〕・`デザイン標準.md`・`画面遷移図.md`）
  - `doc/WEBアプリ開発時のセキュリティ対策一覧.md`（OWASP系・規約 §2.2 で義務化）

---

## 5. 詰まっている点 — 失敗したアプローチと理由

- **現時点でブロッカーは無い**。API設計は全ドメイン確定。
- 今回確定した派生判断（再検討不要）:
  - L＝配信専用（書き込みは REST）／イベント type は canonical ドット記法／publisher は chat=E・notifications=H／購読門番＝パーティー＋グループ AND／認可失効は除去時ドロップ＋再接続再検証／再同期は REST。
  - K＝`display_name` 源泉 accounts（1b）／`GET /me` 正準／PW 変更＝現在PW再確認＋§A.9-③＋H 通知。
  - J＝可視範囲は WHERE 強制／下書き除外／オフセット／同期索引／門番パーティー＋グループ AND。
  - ログインボーナス＝新しいJST日の最初の認証済みリクエスト。I＝集約1本。H＝notify() A案・at-most-once。

---

## 6. 決定事項と根拠（採用しなかった案も）

本セッション（ドメインL）で確定した主判断:
- **L は購読→WS 転送に徹し publish もしない**（chat publish は E・notification publish は H の `notify()`）。不採用＝L が自前で publish（責務混在）。
- **イベント `type` はドット記法に canonical 統一**（§1.12 準拠）。不採用＝E.7 の underscore 名を各所に残す（drift）。
- **購読中の認可失効＝除去時ドロップ＋再接続再検証**。不採用＝毎 fan-out で権限再チェック（高コスト）／放置（漏れ）。

過去の主判断（要約・正は各 `doc/API設計/*.md`）:
- A＝Cookie＋Redis 不透明セッション・MFA/pre-auth 分離・列挙耐性。B＝ロール別パス分離・QG管理者は `quest_group_members.role=admin`・会社アカウント管理者 SoD。C＝パーティー門番・6権限サーバー強制・状態機械 前進のみ。D＝publish アトミック単一UoW・投票 upsert・公開後 全保存で1版。E＝`chat_reads` 新設・チャット添付 単一 multipart・魔法リアクション統合 EP。F＝選定 F 保有・限定公開 完全非表示・投稿者コイン確定トリガ。G＝実績は台帳フック即時付与・台帳 canonical=G.6・ランキング週起点 月曜JST。H＝取得時レンダリング多言語化・1イベント×1宛先1件・notify() A案・Redis publish は H・at-most-once。I＝集約1本 `GET /dashboard`・合成の殻・横断 read は D/F。J＝PGroonga 横断・門番パーティー＋グループ AND・可視範囲 WHERE 強制。K＝`display_name` 源泉 accounts・GET /me 正準・PATCH は accounts+outbox。L＝配信専用・canonical event・認可失効ドロップ。
- 全体＝設計の正は1箇所・なぜ併記（メモリ [[document-design-rationale]]）／DRY 線引き＝規約 §2.3／意図的選択＝§3.5／i18n JA/EN／リアルタイムは WebSocket＋Redis Pub/Sub（§1.12）／認証は Cookie＋Redis 不透明セッション。

---

## 7. 次にやること — 優先順に、具体的に

### ★API設計は完了（A〜L 全確定）。次フェーズ＝実装スキャフォールド（着手前にユーザーへ範囲確認）
- **設計ドキュメントは出揃った**＝要件定義（唯一）／データモデル（管理DB6＋会社DB29）／画面設計（SC-xx＋mocks）／API設計（A〜L・全体規約 §1＋ドメイン別）／規約（ドキュメント作成・コーディング）。
- **実装スキャフォールドの計画（コーディング規約 §3.4/§4.1 が骨格）**:
  - **リポジトリ雛形**＝`compose`（Postgres〔PGroonga 同梱カスタムイメージ・会社DBのみ拡張〕・Redis・MinIO・backend・frontend・outbox worker・dev メール MailHog）／`backend/`（FastAPI・2プレーン `control_plane/`＋`tenant/`・モジュール縦スライス4層・`main.py`＋`worker.py`）／`frontend/`（Next.js App Router・`features/`＋`components/`＋`lib/`）。
  - **DB マイグレーション**＝`migrations/control/`（管理DB6テーブル）＋`migrations/company/`（会社DB29テーブル・PGroonga 索引・§6）＋`seeds/`（spells/items/achievements/reaction_emojis の ja/en）。
  - **着手順の推奨**＝(1) compose＋空アプリ起動確認 → (2) `core`/`db`/`infra` 基盤（config/security〔Argon2id・セッション・CSRF〕/errors〔RFC7807〕/deps〔認可ガード〕/tenant 解決 `get_tenant_session`/uow/storage〔MinIO 署名URL〕/cache〔Redis〕）→ (3) ドメイン A（認証・セッション）から縦に実装 → 以降 B→C→… の順（依存順）。
  - **横断で最初に固める**＝環境変数（`.env.example`）・ポート・RFC7807 エラー・Cookie/CSRF・§1.5 テナント解決・§1.9 冪等キー・§1.8 一覧規約・§1.10 添付/署名URL。
  - **未確定（実装時に確定）**＝各種閾値（セッション TTL 具体値・PW ポリシー値・レート制限・画像上限・per_page 上限）／CI（Lint/型/テスト ゲート・脆弱性スキャン §2.2）／pre-commit の要否（規約 §6）。
- **⚠ 着手前に確認**＝実装は大きな新フェーズ。**どこから・どの粒度で始めるか（雛形一括か／基盤のみか／特定ドメインから縦に一本か）をユーザーに確認**してから着手する。

### 仕上げパス（API設計完了に伴い実施可）
- **ドキュメント作成規約の網羅適用（最終パス）**＝A〜L ほかの裸 §x を文書名接頭辞へ一括正規化（今は「折衷」で新規のみ準拠）。設計が確定したので実施タイミング。
- **画面 md の旧記法の追随**（下記 小キュー）を実装時に解消。

### 未処理の小キュー（軽微・実装 or 該当ドメインで整理）
- **画面 md の旧記法**（実装時に画面 md を追随）: SC-22 §7（`PUT /vote`）・SC-24 §7（`POST /api/ideas/{id}/chat`）・SC-25 §7（`PUT /api/ideas/{id}/evaluation`）・SC-31 §6（`PUT /me/avatar`→装備は `PUT /me/equipment`〔G〕・プロフィール画像は `PUT /me/avatar-image`〔K〕）・SC-41 §6（period 値）・SC-12 §113（全文検索 `scope=`→`types=`）・各画面の `Transaction/Activity`→`activities`・`Notification`→`notifications`。
- 各画面 §9/§10 の実装寄り TBD（SC-01 §10 ダッシュボード各パネル・SC-12 検索語演算子/スコア重み・K の画像上限/メール確認・L の失効シグナル具体/Last-Event-ID・VRM パーツ・各種閾値）＝実装/運用で確定。

---

## 8. 再開に必要な環境情報

- **アプリの起動/テストコマンドは無い**（コード未着手＝`compose`/`package.json`/`pyproject.toml` いずれも未作成）。ポート・環境変数も**未定（未確認）**＝実装スキャフォールドで作成。
- **今使う操作**:
  - `git`（履歴・差分・コミット/プッシュ）。ブランチ `main`・remote `origin`。
  - ドキュメント＝Markdown を読む。画面モック＝`doc/画面設計/mocks/*.html` をブラウザで開く（入口 `mocks/index.html`）。
  - モック JS の構文チェック＝inline `<script>` を抽出して `node --check`（今後モックを触る場合）。
- **技術スタック（確定・未構築）**: フロント Next.js(React/App Router)＋Three.js/R3F＋three-vrm ／ バック Python/FastAPI(4層＝router→application→domain→repository・2プレーン control_plane/tenant) ／ DB PostgreSQL(管理DB1＋会社DB N・全文検索 PGroonga＝§6・会社DBのみ拡張) ／ Redis(セッション/OTP/pre-auth/会社コンフィグキャッシュ/冪等キー/Pub-Sub) ／ MinIO(添付・画像) ／ 全て Docker。
- **リポジトリ運用ルール**:
  - `.gitignore` で **`*.pdf` は追跡外**（Markdown が正・PDFは派生）。
  - **コミットは「本体コミット→handoff にハッシュ追記」の2段方式**。コミットメッセージ末尾に `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。プッシュ先 `origin/main`。
  - ドキュメント方針＝**設計の正は1箇所・他は参照**（drift 回避）／**設計判断はなぜも併記（必須）**／文書間参照は `doc/規約/ドキュメント作成規約.md`（`CLAUDE.md` から自動参照）／意図的選択は `doc/規約/コーディング規約.md §3.5`・DRY 線引きは §2.3。

---

### 自己チェック（このファイルだけで再開できるか）
- ✅ **API設計 A〜L が全確定**（README §2 で全 ✅）。次フェーズ＝実装スキャフォールド。§7 に着手順の推奨（compose→core/db/infra 基盤→A から縦）と、**着手前にユーザーへ範囲確認**を明記。
- ✅ 本セッションの H/I/DRY/ログインボーナス/J/K/L を §3 に記録。L は配信専用・canonical event（ドット記法）・publisher chat=E/notifications=H・認可失効ドロップ・再同期 REST。E.7 の event 名も canonical 化。スキーマ変更なし（K の `accounts.display_name` 追加は前コミット）。
- ✅ 小キュー（画面 md 旧記法・各画面 TBD・ドキュメント規約の最終正規化パス）を §7 に残置。
- ⚠ A〜L の詳細な決定理由は各 `doc/API設計/*.md` を正とすること（本 handoff は要約）。会話ログは参照不可。
