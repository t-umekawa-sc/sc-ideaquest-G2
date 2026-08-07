# 作業引き継ぎ (handoff)

> 次回セッション開始時に **このファイルだけ読めば作業を再開できる** ことを目的とした引き継ぎメモ。
> 読者は「このセッションの記憶が一切ない次回の自分」。会話ログは参照不可。詳細仕様は必ず `doc/要件定義/README.md`（唯一の要件定義書）と `doc/API設計/` を参照。
> 毎回このファイルは全文を上書きする（履歴は git に任せる）。
>
> **次回の開始点＝⑧ドメインJ（全文検索・PGroonga／SC-12・§1.11/§6）の詳細確定**（§7 参照）。A〜I は詳細確定済み。

---

## 1. 最終更新日時 / ブランチ / 最新コミット

- 最終更新: **2026-08-08 JST**（セッション終了時）
- ブランチ: **main**（`origin/main` と同期・作業ツリー クリーン）
- 最新コミット（本文＝直近の内容変更）: **API設計 ドメインI 詳細確定**（`I_ダッシュボード集約.md` 新規＋README §2＋D/F 相互参照）。**このコミット直後に本 handoff 追記コミット**（2 段方式）。ハッシュは `git log --oneline` で確認。
- remote: `https://github.com/t-umekawa-sc/sc-ideaquest-G2.git`
- **プッシュ状況**: 本文コミット＋本 handoff コミットを **origin/main へプッシュ済み**（当セッションで実施）。
- 直近の主なコミット（新しい順・ハッシュは `git log --oneline` で確認）:
  - （本セッション）API設計 ドメインI 詳細確定（ダッシュボード集約／SC-01）
  - `ca9f066` handoff: ドメインH レビュー反映を記録
  - `bb36a79` API設計 ドメインH レビュー反映（notify() 責務A案・整合修正）
  - `9f7ec4a` handoff: セッション終了・全文更新
  - `03f6aa4` API設計 ドメインH 詳細確定（通知）

---

## 2. このプロジェクトのゴール

- **ideaquest**＝社内のアイデア創出をゲーミフィケーション（XP/コイン/レベル/魔法/ランキング）で促す **WEB アプリ**（マルチテナント SaaS・管理DB1＋会社DB N）。
- スタック＝フロント Next.js／バック FastAPI／PostgreSQL／Redis／MinIO／Docker。
- 現在は **実装前の設計フェーズ**（要件定義→データモデル→画面設計→**API設計（いまここ）**→実装）。

---

## 3. 今回やったこと — 変更ファイルと理由

今セッション＝**(前半) ドメインH のレビュー反映（B-1〜C-6）**と**(後半) ⑦ドメインI（ダッシュボード集約／SC-01）の詳細確定**。変更は **ドキュメントのみ**（コードは無い）。各段階で「本体→handoff にハッシュ追記」の2段コミット・プッシュ済み。

### 3.1 ドメインH レビュー反映（コミット `bb36a79`）
- `notify()` 責務をA案で確定（宛先解決＝発火ドメイン／畳み込み＝H 純粋 domain／INSERT＋Redis publish＝H repository・post-commit）。
- B-1: D.4 の `idea_updated` 通知を「同一UoW」→ post-commit(at-most-once) に修正。B-2: Redis publish は H の `notify()` が担う（E.7・README §1.4 整理）。B-3: H.0 表 chat系4種別に `ref_idea_id` 追記。B-4: H.2 meta を本人獲得値(achievement コイン)のみに。B-5: `security_password_changed` に K 発火元追記。C-1〜C-6: 冪等=at-most-once／spell 識別子凍結／revision 例外明示／read-all 文言／§2.2 セキュリティ突合／ref 削除時レンダリング。

### 3.2 ドメインI 詳細確定（本セッションの本体コミット）
- **確定＝集約1本 `GET /dashboard`**（ユーザー選択・SC-01 §10 の「集約 or 分割」を決定）。理由＝ランディングの1往復優先／分割は横断リストEPの乱立を招く。
- **I は「読取合成の殻」＝新業務ロジックを持たない**。匿名化・visibility・権限・ランキングスコアは各ドメインの純粋関数/repository が権威。
- **横断クエリ（全クエスト/全アイデア跨ぎの下書きアイデア/評価・未投票・フォロー中）は所有ドメイン（D/F）の repository に read を追加して I が合成**し、**別個の REST エンドポイントは新設しない**（コーディング規約 §3.1/§3.5-(2)）。→ `D_….md` D.1・`F_評価.md` F.6 に相互参照を1行追記。
- **ヒーロー残高（Lv/XP/コイン/SP）は K 未着手のため当面 I が直接返す**（G.0「残高参照は I でも可」と整合）。`login_bonus` は A のログイン付与結果をワンショット返却。
- 成果物＝`doc/API設計/I_ダッシュボード集約.md` 新規（I.0 責務／I.1 `GET /dashboard` レスポンス／I.2 合成元・上限・並び／I.3 横断 read の所在／I.4 境界・残TBD）＋README §2 の I 行 ✅+リンク＋§2-I サマリ。

---

## 4. 現在の状態 — 動いているもの / 壊れているもの / テスト

- **リポジトリは `doc/`・`CLAUDE.md`・`handoff.md` のみ**。アプリのコード・`compose`・テストは**未着手＝存在しない**（`doc/画面設計/mocks/shared.js` はモック用資産）。
- **壊れているもの**: なし。
- **テスト**: 自動テストは無い（コード未着手）。ドキュメント整合は人手＋Explore で確認。
- **API設計の進捗（`doc/API設計/` 実在）**: **A/B/C/D/E/F/G/H/I ＝詳細確定**（個別ファイルあり・README §2 一覧で ✅）。**J/K/L ＝未着手**（README §2 一覧で ⬜・目次のみ）。
- 成果物の所在:
  - `CLAUDE.md`（直下・規約自動参照の入口）
  - `doc/要件定義/README.md`（唯一の要件定義書）
  - `doc/データモデル.md`（管理DB6＋**会社DB29テーブル**。I はスキーマ変更なし＝既存 read の合成のみ）＋`.pdf`（派生・追跡外）
  - `doc/API設計/`（`README.md`＝全体規約＋§2目次／`A_…`〜`I_ダッシュボード集約.md` の9ドメイン）
  - `doc/規約/`（`ドキュメント作成規約.md`〔汎用〕／`コーディング規約.md`〔§3.5 意図的選択を含む〕）
  - `doc/画面設計/`（`screens/` md・`mocks/` html〔入口 `mocks/index.html`〕・`デザイン標準.md`・`画面遷移図.md`）
  - `doc/WEBアプリ開発時のセキュリティ対策一覧.md`（OWASP系・規約 §2.2 で義務化）

---

## 5. 詰まっている点 — 失敗したアプローチと理由

- **現時点でブロッカーは無い**。
- 今回確定した派生判断（再検討不要）: ダッシュボード＝集約1本 `GET /dashboard`／I は合成の殻・新業務ロジックなし／横断 read は D/F の repository に置き別 EP を作らない／ヒーロー残高は当面 I が返す（K 着手時に `GET /me` へ寄せるか再検討）。
- H の派生判断（再掲・再検討不要）: `notify()`=A案／Redis publish は H が発行・L は WS 転送／通知は at-most-once（取りこぼしゼロ要件化で outbox・§3.5-(3)）。
- **過去に採用→撤回**（記録）: D の `publish` を当初「2ステップ非原子」としたが部分コミットの穴のため撤回し、`content?` を受ける**アトミック単一UoW**へ変更。

---

## 6. 決定事項と根拠（採用しなかった案も）

本セッション（ドメインI）で確定した主判断:
- **取得方式＝集約1本 `GET /dashboard`**。不採用＝分割並列（各パネル個別EP＋不足する横断リストEPを D/F に新設）＝ランディングで N 本リクエスト＋狭いEP乱立で I が実質「目次」化。
- **横断 read は所有ドメイン（D/F）の repository に置き、I が内部合成（別 EP 新設なし）**。不採用＝I 独自 repository に他ドメインのテーブルクエリを重複実装（テーブル所有権・規則の一元適用が崩れる）。
- **ヒーロー残高は当面 I が直接返す**（K 未着手）。K 着手時に `GET /me` へ一本化するか再検討。

過去セッションの主判断（要約・正は各 `doc/API設計/*.md`）:
- H＝取得時レンダリングで完全多言語化（`notifications.params`）・1イベント×1宛先は最具体1件・`notify()` A案・Redis publish は H・at-most-once。
- G＝実績は台帳フック即時付与（G 一元化）・台帳 canonical=G.6・装備 部分マップ PUT・ランキング `GET /rankings`（週起点 月曜JST・SP非対象）。
- F＝選定 F 保有（複数可・XP 取消なし）・限定公開 完全非表示・投稿者コイン確定トリガ（全 evaluator submitted or completed の早い方）。
- E＝未読 `chat_reads` 新設・チャット添付 単一 multipart・魔法リアクション統合 EP。
- D＝publish アトミック単一UoW・投票 upsert(初回XP・日次上限)・公開後 全保存で1版・フォローは解除のみ完了後可。
- C＝パーティー門番・6権限サーバー強制・publish アトミック・状態機械 前進のみ。
- 全体＝設計の正は1箇所・他は参照／なぜも併記（必須・メモリ [[document-design-rationale]]）／意図的選択は コーディング規約 §3.5／認証は Cookie＋Redis 不透明セッション／リアルタイムは WebSocket＋Redis Pub/Sub（§1.12）／i18n JA/EN。

---

## 7. 次にやること — 優先順に、具体的に

### ★最優先＝⑧ドメインJ（全文検索・PGroonga／SC-12）の詳細確定
- 読む: `doc/画面設計/screens/SC-12_クエスト詳細.md`（全文検索タブ）＋関連モック／`doc/API設計/README.md` §1.11（全文検索方針）・§2-J・一覧表 J 行／データモデル §6（PGroonga・§1.11 が参照）。
- 参照する規約: README **§1.11**（全文検索の全体方針）・**§6**（PGroonga／インデックス）。C.0/D.0 のパーティー門番（検索も可視範囲＝パーティー内）。
- 既に予約済みのシグネチャ（README §2-J）: `GET /search`（全社/横断）・`GET /quests/{id}/search`（クエスト内・門番＝当該クエストのパーティー所属）。
- 成果物: `doc/API設計/J_全文検索.md` を新規作成→ README §2 の J 行 ✅+リンク化・§2-J サマリ記述。
- 詰める論点: **検索対象**（アイデア〔`ideas.title/value/body`〕・チャット〔`chat_messages.body`・E 委譲〕・クエスト〔`quests.title/purpose`〕のどれを含めるか）／**PGroonga インデックスの張り方**（対象列・言語トークナイザ・§6）／**可視範囲の強制**（パーティー門番・下書き除外・`visibility`/匿名化との関係）／**スコープ**（全社 `GET /search` vs クエスト内 `GET /quests/{id}/search`）とレスポンス形（種別混在 or 分離・ハイライト/スニペットの有無）／ページング（カーソル・§1.8）／`completed` クエストの検索可否。

### その後（順次）
- **K**（プロフィール・背景画像・`GET/PATCH /me`＝残高/ロケール源泉・A.9 委譲のセキュリティ。**I が当面返しているヒーロー残高を `GET /me` へ寄せるか判断**〔ドメインI決定〕・**H の `security_password_changed` を K が発火する契約を実装に落とす**〔B-5〕）。
- **L**（リアルタイム配信 WebSocket／§1.12・D/E/H の event 発行点を統合＝最後。**通知チャネル `notifications:{user_id}` の publish は H の `notify()`・L は購読→WS 転送**という契約を踏襲）。
- **全ドメイン確定後＝実装スキャフォールド**（`compose`＋Next.js/FastAPI/PostgreSQL/Redis/MinIO・ディレクトリは コーディング規約 §3.4/§4.1）。
- **ドキュメント作成規約の網羅適用（最終パス）**＝設計確定後に A〜I ほかの裸 §x を文書名接頭辞へ一括正規化（今は「折衷」で新規のみ準拠）。

### 未処理の小キュー（軽微・実装 or 該当ドメインで整理）
- **画面 md の旧記法**（実装時に画面 md を追随）: SC-22 §7（`PUT /vote`）・SC-24 §7（`POST /api/ideas/{id}/chat`）・SC-25 §7（`PUT /api/ideas/{id}/evaluation`）・SC-31 §6（`PUT /me/avatar`→`PUT /me/equipment`）・SC-41 §6（`?period=week|last|month|total`→`this_week|last_week|this_month|all`）・各画面の `Transaction/Activity`→`activities`・`Notification`→`notifications`。
- 各画面 §9/§10 の実装寄り TBD。特に **SC-01 §10**（ダッシュボード各パネルの件数/並び順・部分失敗時挙動・login_bonus 保持・レベルアップ演出・実績サマリ搭載可否・3Dアバター表示）＝I.4 残TBD に再掲済み＝実装/運用で確定。

---

## 8. 再開に必要な環境情報

- **アプリの起動/テストコマンドは無い**（コード未着手＝`compose`/`package.json`/`pyproject.toml` いずれも未作成）。ポート・環境変数も**未定（未確認）**。
- **今使う操作**:
  - `git`（履歴・差分・コミット/プッシュ）。ブランチ `main`・remote `origin`。
  - ドキュメント＝Markdown を読む。画面モック＝`doc/画面設計/mocks/*.html` をブラウザで開く（入口 `mocks/index.html`）。
  - モック JS の構文チェック＝inline `<script>` を抽出して `node --check`（今後モックを触る場合）。
- **技術スタック（確定・未構築）**: フロント Next.js(React/App Router)＋Three.js/R3F＋three-vrm ／ バック Python/FastAPI(4層＝router→application→domain→repository) ／ DB PostgreSQL(管理DB1＋会社DB N・全文検索 PGroonga＝§6) ／ Redis(セッション/OTP/pre-auth/会社コンフィグキャッシュ/冪等キー/Pub-Sub) ／ MinIO(添付・画像) ／ 全て Docker。
- **リポジトリ運用ルール**:
  - `.gitignore` で **`*.pdf` は追跡外**（Markdown が正・PDFは派生）。
  - **コミットは「本体コミット→handoff にハッシュ追記」の2段方式**。コミットメッセージ末尾に `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。プッシュ先 `origin/main`。
  - ドキュメント方針＝**設計の正は1箇所・他は参照**（drift 回避）／**設計判断はなぜも併記（必須）**／文書間参照は `doc/規約/ドキュメント作成規約.md`（`CLAUDE.md` から自動参照）／意図的な設計選択は `doc/規約/コーディング規約.md §3.5`。

---

### 自己チェック（このファイルだけで再開できるか）
- ✅ **再開点＝⑧ドメインJ**を §7 冒頭に明記し、入力（SC-12 全文検索タブ・§1.11/§6）・予約シグネチャ（`GET /search`・`GET /quests/{id}/search`）・成果物（`J_全文検索.md`）・論点（検索対象/PGroonga/門番/スコープ/ページング）を具体化。
- ✅ 本セッションの H レビュー反映（3.1）と I 詳細確定（3.2）を記録。I は集約1本・合成の殻・横断 read は D/F・ヒーロー残高は当面 I。波及先＝I 新規／README §2／D.1／F.6。データモデルはスキーマ変更なし。
- ✅ K/L への申し送り（残高の GET /me 一本化判断・B-5 PW通知・publish 契約）を §7 に明記。
- ⚠ A〜I の詳細な決定理由は各 `doc/API設計/*.md` を正とすること（本 handoff は要約）。会話ログは参照不可。
