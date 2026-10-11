# handoff.md — 次セッションの自分への引き継ぎ

> 読者＝このセッションの記憶が無い次回の自分。会話ログは参照不可。本ファイルだけで再開できるよう**全文上書き**で維持（履歴は git）。
> 規約の正本＝リポジトリ直下 `CLAUDE.md`（毎セッション自動読込）。設計の正本は `doc/` 配下、実装現況は `impl/README.md`、**残作業の正本は `doc/バックログ/未実装・ギャップ一覧.md`**。

## 1. 最終更新 / ブランチ / 最新コミット
- 更新: 2026-10-11（**ボタン色 §66 を新ルール「操作の主要度×意味（＝操作する主要コントロールは原則 青）」へ改訂**し、ユーザー実機レビューの指摘を順次反映したセッション）。
- ブランチ: `main`（worktree 無し＝通常クローン直下 `/home/t-umekawa/sc-ideaquest-G2`）。**main 直コミット/push が本プロジェクトの慣習**。
- **開始時点の最新コミット**: `57416401`（前回の §66 strict 全feature適用の handoff コミット）。
- **本セッションのコミット**: `e97b3813`（§66 改訂＋実機レビュー反映＋`デザイン標準.md`／台帳 X2／handoff 更新）＝**push 済み・`origin/main` と一致**。本 handoff の軽微な追記分は直後にもう1コミットで push する（＝この行の `e97b3813` は更新時点で確認できた最新コミット）。
- **本セッションの変更ファイル**: フロント22ファイル＋`doc/画面設計/デザイン標準.md`(§66改訂)＋`doc/バックログ/未実装・ギャップ一覧.md`(X2更新)＋本 handoff。**作業ツリーは clean（未コミット変更なし）**。
- alembic heads: **本セッションで migration 変更なし**（未再確認）。

## 2. このプロジェクトのゴール
ISO56001 準拠のアイデア/イノベーション管理 SaaS（マルチテナント＝control DB＋会社別DB・ゲーミフィケーション）。直近フェーズ＝ユーザー指摘の消化＋仕様確定済み未実装の処理。本セッションは横断 UI 標準（ボタン色 §66）の**ルール改訂**と実機レビュー反映。

## 3. 今回やったこと（理由つき）
前提＝前セッションは §66 を strict（色＝アクションの種類・意味のみ）で全 feature 適用。本セッションはユーザーが実機を1画面ずつレビューし、多数の「標準機能ボタンが outline のまま」を指摘。

- **§66 を新ルールへ改訂（ユーザー決定 2026-10-11）**＝旧「色＝アクションの種類（意味のみ）」→ **「操作の主要度×意味」＝操作して使う主要コントロールは原則 青（primary）**。一覧標準ツール（並び替え/絞り込み/列設定/エクスポート）・ページャ（番号/前へ/次へ/もっと見る）・一括実行系（すべて既読）も青。outline＝離脱・中立のみ。danger＝ネガティブ更新。`デザイン標準.md` §66 本文を書き換え、台帳 X2 を改訂（旧 strict 行を上書き）。
- **実機レビュー指摘の反映（16件）**＝(1)すべて既読→青 (2)画像をアップロード→青(Quest/Idea) (3)編集→青(QuestDetail) (4)もっと見る→青(全11箇所) (5)退席→赤(Contest) (6)アーカイブ(情報カード⋮)→赤 (7)使用料請求書→青(⬇アイコンを白へ・`companies.css`) (8)権限付与/剥奪ダイアログの閉じるを左端(`dialog-close-left`) (9)一覧ツールバー4種→青(DataTable) (10)番号ページャ→青＋現在=塗り/候補=青アウトライン (11)カード/リスト seg→塗り青で統一(`.viewtoggle .is-on`) (12)画像を選ぶ→青(Company作成/会社詳細/Profile×2) (13)管理グループ Combobox の折り返し修正(flex+nowrap・パネル自動幅) (14)メンバー追加ダイアログの閉じるを左端 (15)自分の順位へ→青(Ranking) (16)サインアップ幅=ログイン(400px・`auth.css`)。
- **対象外として据え置き**＝投票 `.vote-btn`／ゲーム層 `.btn-pixel`（shop/spells/avatar）は §66 対象外。

## 4. 現在の状態（動作 / テスト）
- **ビルド**＝`cd impl/frontend && npm run build` ✓ Compiled successfully（警告は既存の DataTable useMemo/aria 系＝無関係）。
- **TC トレーサビリティ**＝✅ 1134（テストファイル未変更＝純粋な UI variant / CSS 差し替え）。
- **Docker**＝`cd impl && docker compose up -d --build frontend` 実施済み・稼働中。**今日の全変更は `:3000` に反映済み**（ユーザーが実機レビュー）。
- **未検証**＝フル `tests/` 未実行／e2e 未実行（破壊的なので回避）。

## 5. 詰まっている点 / 未確認
- **残＝§66 新ルールでの全画面スイープ**（台帳 X2）＝ユーザーがレビューしたのは一部画面。**レビュー未到達画面（admin 各画面・各 detail・各 form）に outline のまま残る標準機能ボタン/トグルを洗い出し→primary 化**する一巡が残っている。
- **未処理の監査引継2件**＝`2026-10-10_バグ監査-ソース解析-セキュリティ.md`・`2026-10-10_全ソースコード品質セキュリティ監査.md`（実装セッションがコード裏取り→台帳 triage → 消化／本セッション未着手）。
- alembic heads 未再確認（migration は触っていない）。

## 6. 決定事項と根拠（本セッション）
- **§66 改訂＝新ルール（ユーザー決定 2026-10-11）**＝旧 strict（意味のみ）では一覧標準ツール/ページャ/すべて既読が outline（中立）だったが、ユーザーは「クリックして使う標準機能は青で一貫して示したい」。prominence を許容する方向へ転換＝**操作する主要コントロールは原則 青**。矛盾していた3点（ページャ・すべて既読・一覧ツールバー）はこの改訂で正式ルール化（spec=正本を一致させた）。
- **ページャの現在/候補の区別**＝現在ページ＝青塗り（`.is-current`）／候補・前後ボタン＝青アウトライン（`.pagination .btn-outline` を青線化）。全部塗りだと現在位置が埋もれるため。
- **帳票ボタンの⬇**＝`.btn-report__dl` を `color: var(--color-primary)` → `inherit` にし、primary（青地）上で白く見えるよう修正（旧 strict では「⬇が青で潰れる」ため outline 据え置きだったが、inherit で解決）。
- **ダイアログ footer**＝閉じる/キャンセルは左端（`.dialog-close-left`）・主要アクションは右端（§8・`デザイン標準.md:116`）。CapabilitiesSection(付与/剥奪)・MemberAddPanel が未準拠だったので是正。

## 7. 次にやること（優先順）
> 着手前に実コードで裏取り。残作業の正本＝`doc/バックログ/未実装・ギャップ一覧.md`。
1. **【X2 継続】§66 新ルールの全画面スイープ**＝レビュー未到達画面を一巡し、outline のまま残る「操作する主要コントロール」を primary 化（admin 各画面・各 detail・各 form・トグル/セグメント）。バッチごとに `npm run build`→目視→コミット。全消化で X2 行削除。
2. **監査引継2件の受領→台帳 triage**＝各項目を実コードで裏取りしてから出典付きで起票→消化。
3. 以降は台帳の未着手＝**D8**/**G2・G3**/**D2・D3**/**F7**/**D6(B)** 等（着手時ユーザー確認）。
4. 完了時＝`impl/README.md` 現況更新・台帳から完了行削除・handoff 全文更新。

## 8. 再開に必要な環境情報
- 作業ディレクトリ：`/home/t-umekawa/sc-ideaquest-G2`（実装 `impl/`・frontend `impl/frontend`・backend `impl/backend`・帳票 `impl/jasper`）。Docker Compose プロジェクト＝`impl`。
- 起動：`cd impl && docker compose up -d`（dev）。backend=`:8000`・frontend=`:3000`・MailHog=`:8025`・MinIO=`:9000/:9001`・db=`:5432`・redis=`:6379`。
- **フロント反映はソースベイク**＝`cd impl && docker compose up -d --build frontend`（`npm run build` だけでは `:3000` に反映されない）。
- テスト：frontend ゲート＝`cd impl/frontend && npm run build`（必須）／`npx vitest run <path>`／e2e `npx playwright test <spec> -g "<TC>" --workers=1`。backend（ベイク）`cd impl && docker compose exec -T backend pytest <path> -q`。未コミット反映は `docker compose run --rm -T -v "$(pwd)/backend:/app" backend pytest <path> -q`。TC トレーサビリティ：**リポジトリルート**で `python3 scripts/check_tc_traceability.py`。
- 目視検証の型：`impl/frontend` に使い捨て `_*.mjs`（Playwright chromium）を作り**使い終わったら削除**。ログインは hydration 待ち必須（`#company_code`/`#login_id`/`#password` を fill 前に ~1.3s）。モック目視は `file://` で `doc/画面設計/mocks/*.html`（`style-guide.html`）。
- ログイン（PW いずれも `Passw0rd!`）：一般 `ACME-01`/`user@acme.example`／会社管理 `ACME-01`/`kanri@acme.example`／OPS `admin@ops.example`。
- **DB/テストデータ注意**＝共有 dev DB は非冪等。**フル e2e は会社DBを DROP→bootstrap する破壊的操作**＝セッション終了目的で実行しない。

## 9. 残作業・並行開発への参照
- 残作業の正本＝**`doc/バックログ/未実装・ギャップ一覧.md`**（本セッションで X2 を §66 新ルールへ改訂）。次回確認＝**X2 全画面スイープ**／監査引継2件の triage／D8・G2・G3・D2・D3・F7・D6(B)。
- **並行開発**＝別セッションが **G2 イノベーションポートフォリオ**を設計中（`1bbfe9db`）。台帳 `G2` 行の更新はその実装セッションの担当。push 前に `git fetch`/`git log` で競合確認。
- **未処理の引継（次回要対応）**＝`2026-10-10_バグ監査-ソース解析-セキュリティ.md`・`2026-10-10_全ソースコード品質セキュリティ監査.md`（読み取り専用監査＝実装セッションが裏取り→台帳 triage→消化）。`2026-10-09_プロジェクト管理機能拡張.md`（→D8/F4）。`2026-10-09_リッチテキスト2系統統一-tiptap移行.md`（→F7 出典）。
- 並行開発の取り決め＝`doc/セッション調整/並行開発の取り決め.md`。
