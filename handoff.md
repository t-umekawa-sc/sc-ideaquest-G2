# 作業引き継ぎ (handoff)

> 次回セッション開始時に **このファイルだけ読めば作業を再開できる** ことを目的とした引き継ぎメモ。
> 読者は「このセッションの記憶が一切ない次回の自分」。会話ログは参照不可。詳細仕様は必ず `doc/要件定義/README.md`（唯一の要件定義書）・`doc/API設計/`・`doc/ADR/`・`doc/データモデル.md`・`doc/テスト/`・`doc/規約/`・`doc/画面設計/` を正とすること（本 handoff は要約）。
> 毎回このファイルは全文を上書きする（履歴は git に任せる）。
>
> **現在地（2026-08-13）＝(A) 管理系のモック整合（SC-91 完全準拠・SC-93 済）は一旦保留し、ユーザー要望で「画面モックの精度向上＋UI標準（`デザイン標準.md`/`shared.css`/`shared.js`）の調整」に着手。まず「一覧の操作標準（DataTable）」を新設し SC-91 モックに適用（`becc385`・doc/mocks のみ・impl 未反映）。次＝ユーザーのモック確認フィードバック反映 → 他要望（ヘッダー usermenu の UI/アニメ・各画面ラベル）→ 落ち着いたら (A) 管理系整合や (B) 画面群移植を再開。**
>
> ※ 元の再開点（保留中）＝(A-1) SC-92 会社詳細（§7）／(A-2) SC-90／(A-3) 所属エディタ `.seg` 化。方針転換（2026-08-12）＝「画面モック先行のクリッカブル → 画面群ごとに backend 接続」（`doc/規約/フロントエンド実装フロー規約.md`）。Phase 0 完了。

---

## 1. 最終更新日時 / ブランチ / 最新コミット

- 最終更新: **2026-08-13 JST**（セッション終了時）。
- ブランチ: **main**（作業ツリー クリーン・**push 未**＝本セッション分は未 push）。
- 最新コミット: 本 handoff コミット。直前＝**`becc385`**（一覧の操作標準 DataTable 新設）。
- **本セッションのコミット（新しい順・未 push）**:
  - `becc385` **一覧の操作標準（DataTable）新設＋SC-91 適用＋`デザイン標準.md` §4.5 起こし**（**doc/mocks のみ・impl 未反映**）＝ユーザー要望のUI標準化。`shared.js` に `window.DataTable`（`DataTable.init(root, config)`＝列とデータを宣言するだけで全機能付与）。機能＝①単一列ソート(昇順→降順→解除・aria-sort)②詳細ソート(左右2ペイン transfer＋FLIP・複数キー・優先順位▲▼・詳細中は単一列無効＋バッジ＋要約チップ)③横断検索＋詳細絞込(テキスト/区分/数値/日付範囲)④番号ページャ(« ‹ 1 … [n] … › »)⑤列幅ドラッグ(Wクリックで既定)⑥列設定メニュー(表示/非表示＋▲▼並べ替え・名称先頭/操作末尾ロック・幅リセット/既定に戻す)⑦CSV(現在の絞込・ソート結果/表示列・UTF-8 BOM)⑧表示密度(標準/コンパクト)⑨行固定(行頭📌→上部sticky＋全ページ常時・固定ヘッダー前提・上限5件)。永続＝列順/表示/幅/密度/ピンを `localStorage`(画面×列)。`shared.css` に `9y` 部品＋**グローバル `[hidden]{display:none!important}` 修正**（`.btn`/`.pagination` の display が UA の `[hidden]` を上書きする不具合）。`デザイン標準.md` §4.5 新設＋F4/toolbar/pagination 改定（旧「列ヘッダソート MVP 非採用」撤回）。SC-91 は手書き table→`DataTable.init` に置換。`style-guide.html` に「9.」デモ。**検証＝ヘッドレスで SC-91/style-guide とも JS エラー無し・全機能描画確認・ユーザーがモック確認予定**。
  - `1094df1` **モーダル本文スクロール修正**＝本文＋フッターを `<form>` で包む標準パターン（`Modal.tsx` §159）で内容が高いと `<form>` がパネル（`max-height:88vh`・`overflow:hidden`）から溢れ、フッターが画面外・本文も未スクロール（SC-91 作成モーダルで表面化）。`.modal__panel.sectioned > form` を flex 列＋`flex:1/min-height:0/overflow:hidden` に（body 直下パターンには非適用で無害）。`design-system.css`／`mocks/shared.css` 同期。目視確認＋full e2e 26 passed。
  - `effe878` (A)SC-91 会社一覧＝**モック完全準拠へ再整合**＝`.backlink`/`.page-title`「システム管理（運営）」/`.admin-sub`/`.section-head`(h2「会社（テナント）」＋「＋ 会社を作成」)/末尾 `.role-note`・テーブル `.co`＋`QuestIcon`/`.db-id`/状態バッジ `.st-active`/`.st-provisioning`・作成モーダルに会社カラー `.swatches`(新 `components/ui/Swatches.tsx`・backend `color` 接続)＋会社アイコン `.icon-field`(objectURL プレビューのみの仮実装・MinIO 待ち)＋`.provision-note`。共有クラス 8種を design-system.css と mocks/shared.css へ昇格・SC-91 モック `<style>` の重複撤去。e2e＝sc-91(B-TC-110 見出し/B-TC-111 ボタン名)・sc-92(作成ボタン名)追随＝**full 26 passed**。
- 前セッション以前のコミット（新しい順・push 済み）:
  - `c78aa2d` (A)SC-93 会社アカウント管理 モック整合＝`RowMenu`（⋯ケバブ）新設・`.table`化・状態バッジ・自社コンテキスト・system_admin 行ロック。
  - `ca2bbab` (A)SC-91 会社一覧 モック整合＝`QuestIcon` 新設・`.table-wrap`/`.table`・会社アイコン・DB識別子列・状態バッジ・sticky 操作列・行クリック遷移。
  - `faa2667` Phase 0-④ URL 付きモーダル基盤（Parallel `@modal`＋Intercept・SC-11 で実証）。
  - `ffd4e1d` Phase 0-③ 全ルート雛形＋ダッシュボードのハブ化。
  - `a9845f0` Phase 0-② App シェル（残高ピル・通知ベル・アバターLv・2層背景）。
  - `7f548b4` Phase 0-① デザインシステム移植＝mock `shared.css` を正として採用（段階移行）。
  - `b90eced` doc: フロントエンド実装フロー規約 新設（画面モック先行→接続）。
  - `7fe9323` モーダル標準挙動補完（本文スクロール・ドラッグ移動・最大化）。
  - `16fad1b` モーダル共通部品（client）＋管理フォームのモーダル化＋SC-91 一覧の検索/ページャ。
  - `8b4aa6b` doc: README のシードログイン表に admin@ops.example 追記。
  - `e864e4a` doc: テストパターンに目的列追加＋設計書ファースト再レビュー（テスト規約 §1.2/§5.2）。
  - `cd6e775` / `07cf6a4` 口座一覧のページング・検索 UI（SC-92/93）＋その handoff。
- **プッシュはユーザー依頼時のみ**。コミットは **実装本体→handoff の2段**。コミット末尾に `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。
- remote: `https://github.com/t-umekawa-sc/sc-ideaquest-G2.git`。

---

## 2. このプロジェクトのゴール

- **ideaquest**＝社内アイデア創出をゲーミフィケーション（XP/コイン/レベル/魔法/ランキング）で促す WEB アプリ（マルチテナント SaaS・**管理DB1＋会社DB N** の2プレーン）。
- スタック＝フロント Next.js(App Router)／バック FastAPI(4層)／PostgreSQL(会社DBのみ PGroonga)／Redis／MinIO／MailHog(dev)／Docker。
- 設計フェーズは **API設計 A〜L・画面設計 SC-00〜93・データモデル 全確定**。

---

## 3. 今回やったこと — 変更ファイルと理由

### ★本セッションの主眼＝UI標準「一覧の操作標準（DataTable）」新設（2026-08-13・doc/mocks のみ）
- ユーザーが (A) 管理系整合を**保留**し「モック精度向上＋UI標準調整」に舵。要望＝**各画面ラベル**・**一覧のページング/ソート/各項目絞り込み**・**ヘッダー usermenu の UI/アニメ**。まず一覧まわりを仕様化→実装（`becc385`）。
- **仕様の詰め方**＝ユーザーが具体イメージを口頭描写→こちらが仕様化（選択肢提示は不可・[[design-spec-working-style]]）。決定①〜⑱を確定してから実装。
- **成果物**＝`shared.js` の `DataTable`／`shared.css` の `9y`＋グローバル `[hidden]` 修正／`SC-91` 適用／`デザイン標準.md` §4.5／`style-guide.html` デモ（詳細は §1 のコミット説明）。
- **重要**＝これは **doc/画面設計（mocks）だけ**の変更。**impl（`impl/frontend`）は未反映**。実装接続時に「Next.js 版 DataTable ＋ 一覧APIのクエリ契約（複数ソートキー・項目別フィルタ・CSVエクスポートEP・ピンID取得）」として backend/impl に落とす（CSV／行固定のページ跨ぎは backend 依存）。
- **残要望（未着手）**＝ヘッダー usermenu の UI/アニメ（現状 `.usermenu__list[hidden]` の即時トグル＝開閉アニメ無し）／各画面のラベル横断見直し。

### ★方針転換＝フロントエンド先行プロトタイプ（2026-08-12・ユーザー選択）
従来の「ドメイン縦スライスで backend まで一気」から、**全画面をモック先行で Next.js にクリッカブル移植（ナビ＋ダイアログ配線・デモデータ）→ 画面群ごとに backend 接続**へ変更。正＝**`doc/規約/フロントエンド実装フロー規約.md`（新設・`b90eced`）**（shared.css を単一デザインシステムに採用・段階移行／URL 付きモーダル標準／デモデータ seam＝fixtures は OpenAPI 型／画面遷移図＝ルートの正／既存接続画面は接続維持でモック整合／**DoD＝モック一致**）。CLAUDE.md・コーディング規約 §5・テスト規約 §7 にクロス参照済み。

### Phase 0（プロトタイプ基盤・完了）
- **①デザインシステム**（`7f548b4`）＝`doc/画面設計/mocks/shared.css` を `impl/frontend/src/styles/design-system.css` に複製し `app/globals.css` で最優先 import（既存 tokens/components/layout は legacy として段階移行）。アセットを `public/assets/`。潜在バグ修正＝sectioned モーダルの本文スクロール（`.modal__panel.sectioned{overflow:hidden}`＋`.modal__body{min-height:0}`）を design-system.css と正本 mocks/shared.css の双方に。自作の modal/list-toolbar/pager CSS は撤去し shared.css に委譲。`components/ui/Modal.tsx`・`Pager.tsx` を shared クラスへ整合。
- **②App シェル**（`a9845f0`）＝`components/layout/AppHeader.tsx` に残高ピル（Lv/コイン/SP・`.pixel-stat`）＋通知ベル（`.bell`）追加、`components/ui/Avatar.tsx` に任意 `level`、`app/(app)/layout.tsx` に 2層背景 `.app-bg`＋メニュー整備＋デモ残高/未読を供給（K.1/H 接続まで）。
- **③全ルート雛形＋ハブ**（`ffd4e1d`）＝`components/layout/ScreenStub.tsx` 新設。`app/(app)/` 配下に全画面ルートの stub（quests・quests/[questId]・ideas/[ideaId](+chat,+eval)・shop・avatar・spells・achievements・ranking・notifications）を作成し画面遷移図どおりに配線。`app/(app)/page.tsx`（SC-01）をナビ・ハブ化（`ようこそ` は e2e 互換で保持）。
- **④URL 付きモーダル基盤**（`faa2667`）＝`app/(app)/layout.tsx` に `@modal` パラレルスロット、`app/(app)/@modal/default.tsx`（null）、`app/(app)/@modal/(.)quests/new/page.tsx`（SC-11 作成モーダル）＋`app/(app)/quests/new/page.tsx`（フルページ・フォールバック）。e2e `frontend/e2e/sc-11-quest-create-modal.spec.ts`。

### (A) 管理系のモック整合（実施中）
- **SC-91 会社一覧 モック完全準拠へ再整合**（`effe878`・本セッション）＝`CompanyList.tsx` に `.backlink`「← ダッシュボードへ戻る」・`.page-title`「システム管理（運営）」・`.admin-sub` 説明・`.section-head`（`<h2>会社（テナント）</h2>`＋「＋ 会社を作成」）・末尾 `.role-note` 脚注を追加。テーブルを `.co`＋`QuestIcon`／`.db-id`（等幅）／状態バッジ `.st-active`・`.st-provisioning` へ。作成モーダルに **会社カラー `.swatches`**（新 `components/ui/Swatches.tsx`・`SWATCH_PRESETS` 10色・**backend `CompanyCreateRequest.color` へ接続**）＋**会社アイコン `.icon-field`**（頭文字フォールバック＋画像プレビュー＝**送信せず objectURL のみの仮実装**・MinIO 基盤待ち）＋`.provision-note`＋各 hint。**共有クラス 8種**（`.page-title`/`.section-head`/`.backlink`/`.co`/`.db-id`/`.st-*`/`.icon-field`/`.provision-note`）を `design-system.css` と `mocks/shared.css` へ昇格・同期し、SC-91 モック `<style>` の重複を撤去（正の一元化）。状態ラベルは **有効/準備中**（active/suspended・provisioning 不採用）を踏襲。グループ数/作成日は「—」（`CompanyListItem` 未提供）。
- **SC-91 会社一覧（初回整合）**（`ca2bbab`）＝`components/layout/QuestIcon.tsx` 新設。`CompanyList.tsx` を `.table-wrap`/`.table`・会社アイコン・DB識別子列・状態バッジ・sticky 操作列（管理する→）・行クリック遷移・`.list-toolbar`(.filters/.tools)・`.list-count`・`.list-empty` に。
- **SC-93 会社アカウント管理**（`c78aa2d`）＝`components/ui/RowMenu.tsx`（⋯ケバブ・`position:fixed`）新設。管理画面補助クラス（`.admin-sub`/`.company-ctx`/`.row-locked`/`tr.is-suspended`/`.role-note`）を design-system.css へ昇格＋mocks/shared.css 同期。`features/accounts/components/AccountSelfSection.tsx` を 見出し「会社アカウント管理」＋自社コンテキスト行＋`.table`＋状態バッジ＋無効行淡色＋⋯ケバブ操作＋system_admin 行ロックに。`app/(app)/admin/accounts/page.tsx` から `companyCode` を渡す。

---

## 4. 現在の状態 — 動いているもの / 壊れているもの / テスト

- **backend（縦通し済み・本セッションで変更なし）**: ドメイン A（ログイン/MFA/初回・再設定PW/ロック ADR-0005/IP確定 ADR-0006）・B（会社/アカウント/所属・`/admin/*`・SoD）・K.2/K.3（`GET/PATCH /me`・`POST /me/password`・メール変更 double opt-in ADR-0008）・account_sync_outbox・mail_outbox・監査ログ。**本セッションは backend を一切変更していない。**
- **frontend**: Phase 0 完了で**全画面がクリッカブル**（未実装画面は `ScreenStub`）。ヘッダー/ハブ/URL モーダル動作。管理系は SC-91（**モック完全準拠**）・SC-93 がモック整合済み（接続維持）。SC-92・SC-90 は**旧実装のまま（未整合）**。
- **テスト（本セッション実測）**:
  - **frontend full e2e = 26 passed**（`cd impl && docker compose exec -T -e LOGIN_RATE_LIMIT_MAX=50 frontend npx playwright test --workers=1`）。SC-91 再整合後に再実測。内訳＝sc-00 系5＋sc-11 モーダル2＋sc-90〜93/91/92 系＋k-profile 等。
  - **backend pytest**＝**前セッション実測 164 passed のまま**。**本セッションでは backend 変更なし＝未再実行（未確認扱い）**。
  - frontend **tsc EXIT=0**（マウント版で実測）。
- **Docker（本 handoff 時点で稼働確認済み）**＝db/redis/mailhog/backend/frontend/worker/mail-worker の 7 サービス **running**。**frontend イメージは SC-91 再整合込みで再ビルド済み**。**backend イメージは K.3 期のまま**（本セッション backend 無変更）。
- **壊れているもの＝無し**（e2e 26 passed）。
- migration head＝**control 0010・company 0006**（versions ファイルで確認）。

---

## 5. 詰まっている点 — 失敗したアプローチと理由

- **ブロッカーは無い**。
- **本セッションのハマり（解消済み）**:
  - **モーダル本文スクロールが効かない（第2波＝`<form>` 包み）**＝`.modal__panel.sectioned` は flex 縦積みで直下に header/body/footer を想定するが、標準の呼び出しは body+footer を **`<form>` で包む**（`Modal.tsx` §159）ため `<form>` が単一 flex 子になり body の `flex:1/min-height:0` が無効化。内容が高い SC-91 作成モーダルでフッター画面外＋未スクロールが表面化。**`.modal__panel.sectioned > form { display:flex; flex-direction:column; flex:1 1 auto; min-height:0; overflow:hidden; }`** で解消（両 CSS 同期）。**入力モーダルは今後も内容が高くなり得る＝この form 規則が効いている前提で作る。**
  - **モーダル本文スクロールが効かない（第1波・前セッション）**＝flex 子の `min-height:0` 欠落（mock shared.css にも潜在）。`.modal__panel.sectioned{overflow:hidden}`＋`.modal__body{min-height:0}` で解消（design-system.css と正本 mocks/shared.css の両方）。
  - **モーダルを body に portal → region 外**＝`getByRole("region").getByRole(...)` でモーダル内ボタンを拾えず e2e 失敗。モーダル内要素は **page スコープ**で取る（sc-92b B-TC-125 で対応）。
  - **一覧のページング未実装が data 増で表面化**＝会社/口座が閾値超で新規行が1ページ目に出ず e2e 失敗。**CompanyList にも検索＋ページャを追加**して解消（accounts と同型）。並びは backend で `created_at,id`（決定的）。
  - **見出し文言変更で e2e 破損**＝SC-93 見出しを「会社アカウント管理」に変更→ B-TC-117 の heading 参照を更新。**画面名を変えたら該当 e2e の getByRole heading を必ず追随。**
- **再発防止の教訓**:
  - **frontend を焼くたびに** Playwright は `install-deps chromium`＋`install chromium`（ブラウザ本体）の両方を入れ直す（コンテナ再作成で消える）。
  - **spec のみ変更なら再ビルド不要**＝`docker compose cp frontend/e2e/<spec> frontend:/app/e2e/<spec>` で差し込み実行。
  - **shared.css を正**＝アプリ側 CSS の重複は撤去して design-system.css に寄せる。モック <style> ローカルの共通クラスは design-system.css へ昇格し mocks/shared.css にも同期（正本の一元化）。

---

## 6. 決定事項と根拠（採用しなかった案も）

### 本セッション
- **フロントエンド先行プロトタイプ**（不採用＝ドメイン縦スライスで一気に backend まで）＝設計がモック完備で、先に UI/動線を固めれば接続が「データ差し込み」だけになり整合の二度手間を回避。粒度＝**画面群ごとに移植→接続**。
- **shared.css を単一デザインシステムに採用・段階移行**（不採用＝新規画面だけ shared・既存は現状維持＝2デザイン系の併存で衝突）。
- **モーダルは本番形 URL 付き（Parallel `@modal`＋Intercept）に移行**（不採用＝client Modal 継続＝後で全ダイアログ手直し）。
- **既存接続画面は接続維持でモック整合**（不採用＝一旦デモデータに置換＝動くコードと e2e を捨てる）。
- **モック⇔設計の矛盾は設計を正**（DoD §7）。例＝会社 status は実モデル `active/suspended` の2値（モックの `provisioning` は不採用）／SC-90 のメンバー「ロール列」表示は設計 §4.1 が禁止（削除予定）／ディレクトリの login_id は最小射影で非表示（モックの逸脱）。
- **テストパターンに「目的」列を追加＋設計書ファースト**（`e864e4a`・テスト規約 §1.2/§5.2）。otp 単回消費の列名は実装の実列 `used_at` に統一（データモデル §4.4 の `consumed` は誤り＝是正済み）。

### 過去の確定（正は各設計文書。要約）
- 認証＝Cookie＋Redis 不透明セッション（ADR-0001）／初回・再設定PW（ADR-0002）／MFA・信頼端末（ADR-0004）／ロック（ADR-0005）／IP確定（ADR-0006）／メール非同期（ADR-0007）／メール変更 double opt-in（ADR-0008）／設定の置き場所（ADR-0003）。
- 2プレーン×縦スライス4層（router→application→domain→repository・エントリ `main.py`/`worker.py`/`mail_worker.py`）。SoD（§8-⑯）。

---

## 7. 次にやること — 優先順に、具体的に

> **現在の最優先＝(D) UI標準/モック精度の調整（ユーザー主導・doc/mocks で作業）**。(A)/(B) の impl 作業は保留中。

### (D) UI標準・モック精度（進行中・最優先）
- **D-0（直近）＝一覧の操作標準 DataTable のユーザー確認フィードバック反映**。ユーザーが `mocks/SC-91_システム管理.html`・`mocks/style-guide.html`（「9.」）をブラウザ確認予定。指摘（見た目・文言・挙動）を `shared.js`/`shared.css`/`デザイン標準.md` §4.5 に反映。**目視検証手法**＝mocks を frontend コンテナへ `docker compose cp ../doc/画面設計/mocks frontend:/tmp/mocks`（**既存 /tmp/mocks は先に `rm -rf`。cp はネスト增殖する**）→ `@playwright/test` の chromium で `file:///tmp/mocks/SC-91_...html` を開き pageerror/console を収集＋screenshot（node スクリプトを cp して `docker compose exec frontend node`）。`node --check` で syntax も確認。
- **D-1＝ヘッダー usermenu の UI/アニメ**（要望）。現状 `shared.css` `.usermenu__list[hidden]{display:none}` の即時トグル＝**開閉アニメ無し**。フェード/スケール＋`prefers-reduced-motion` 対応を `shared.css`/`shared.js`（`initUserMenu`）に。
- **D-2＝各画面のラベル横断見直し**（要望）。用語統一・命名を `mocks` 全体で点検（`デザイン標準.md` に方針節を設けるか検討）。
- **D-3＝DataTable を他一覧へ展開**（SC-90/92/93・SC-10 等）。`columns`＋`data` 宣言のみ。
- **D-4（後）＝impl 反映**＝Next.js 版 DataTable＋一覧APIのクエリ契約（複数ソートキー・項目別フィルタ・CSVエクスポートEP・ピンID取得）。統合作業再開時。

### 【保留】(A-1) SC-92 会社詳細（UI標準調整が落ち着いたら再開）
- **会社設定トグル**＝`impl/frontend/src/features/companies/components/CompanyDetailView.tsx` の素の checkbox を **`.switch`（トグルスイッチ）**へ（shared.css `.switch` 定義済み）。新規 `components/ui/Switch.tsx` を作るのが良い。各設定に説明文を付す（デザイン標準 §98）。
- **会社カラー**＝同ファイルに **`.swatches`（プリセット10色）**を追加＝**`components/ui/Swatches.tsx` は SC-91 で実装済み・再利用可**（`Swatches`／`SWATCH_PRESETS` を `@/components/ui` から import）。`updateCompanyProfile` が `color` を受ける（`features/companies/api.ts`）。**会社アイコンのアップロードは MinIO 基盤前提＝別スライス**（SC-91 と同じく objectURL プレビューのみの仮実装で先行可）。
- **文脈バナー**＝会社アイコン＋名＋状態バッジ＋コード/DB/件数＋戻る（`.ctx` sticky・SC-92 モック参照）。`group_count` は `CompanyDetail` に無ければ暫定省略/「—」。
- **アカウント表**＝`impl/frontend/src/features/accounts/components/AccountSection.tsx` を SC-93 と同様に `.table-wrap`/`.table`・状態バッジ・**⋯ケバブ `RowMenu`**・所属列（backend 未対応で「—」）に。※`RowMenu`・`QuestIcon` は実装済み・再利用可。
- **クエストグループ表**＝`impl/frontend/src/features/questgroups/components/QuestGroupSection.tsx` を `.table` 化・操作を⋯ケバブ・**リネームを `window.prompt`→モーダル**（コード固定表示）に。
- e2e＝`frontend/e2e/sc-92-company-detail.spec.ts`・`sc-92b-accounts.spec.ts`・`sc-92b2-account-edit.spec.ts`・`sc-92c-quest-groups.spec.ts`（見出し/セレクタ変更時は追随）。

### (A-2) SC-90 クエストグループ管理
- `impl/frontend/src/features/qgadmin/components/QuestGroupAdminView.tsx`：**設計違反の是正**＝メンバー一覧の「グループ内ロール」列を**削除**（設計 §4.1・SoD で role 非表示）／操作列を sticky＋「このグループから除外」文言／ディレクトリピッカーを `.dir-list`/`.dir-row`（アバター＋氏名）へ／**追加後にディレクトリ再取得**（参加済みを候補から除く）／`.admin-sub` の SoD 説明・空状態文言。**login_id/参加日列は `MemberListItem` 未提供＝backend 拡張（後述）**。

### (A-3) 所属エディタのセグメント化（SC-92/93 共有）
- `impl/frontend/src/features/accounts/components/MembershipsEditor.tsx` の `<select>`（member/admin）を **`.seg`（セグメントボタン）**へ。**`.seg`/`.mrow` は現状 design-system.css 未定義**（各モック <style> ローカル）＝**design-system.css へ昇格＋mocks/shared.css 同期**が必要（SC-93 mock の `<style>` に定義あり＝そこから移す）。

### backend 依存の残（別スライス・(A) では「—」表示で先送り中）
- `AccountListItem` に memberships（所属グループ/ロール）＝SC-92/93 の所属列・編集時の現所属初期表示。`impl/backend/app/control_plane/admin/schemas.py`・`application.py` の一覧クエリ（会社DB `quest_group_members` join）。
- `MemberListItem` に `login_id`・`joined_at`（SC-90 列）／`MemberListResponse` に `page_info`（ページング）。
- `CompanyListItem`/`CompanyDetail` に `group_count`・`created_at`（SC-91/92）。
- session に会社表示名（自社コンテキスト・SC-93）。
- 画像アップロード EP（会社アイコン/アバター/背景＝K.4・MinIO 基盤）。

### (B) 画面群の新規移植→接続（(A) 後）
- クエスト C（SC-10/12＋SC-11 モーダル）→ アイデア D（SC-21/22）→ チャット E（SC-24）→ 評価 F（SC-25）→ ゲーム G（SC-30/31/32/40/41）→ 通知 H（SC-02）→ ダッシュボード集約 I（SC-01 本実装）。**G-core 台帳（`activities`＋残高＋付与/消費）と MinIO 基盤は接続時に前倒し**（C/D/E/F の各アクションが同一 UoW で activities を書く設計＝G.0/G.6）。

### 手法（毎スライス共通）
- **DoD＝モック一致**（フロントエンド実装フロー規約 §7）。矛盾は設計を正とし図/モックを修正。
- プロトタイプ画面＝**ナビ/ダイアログ相互作用 e2e**（デモデータ）／backend 接続時＝テスト規約 §5.1 の red-green。
- テストパターン md は「目的」列必須（テスト規約 §1.2）。

---

## 8. 再開に必要な環境情報

- **フル起動**＝`cd impl && docker compose up -d --build`。ポート＝db `:5432`／redis `:6379`／mailhog SMTP `:1025`・UI `:8025`／backend `:8000`／frontend `:3000`（`next dev`）。worker/mail-worker はポート無し。backend entrypoint が bootstrap（DB作成→alembic head〔control 0001-0010・company 0001-0006〕→seed）してから uvicorn。
- **dev ログイン（seed・パスワードは全て `Passw0rd!`）**:
  - system_admin＝会社コード `OPS`／`admin@ops.example`（`BOOTSTRAP_ADMIN_PASSWORD` 供給時に seed・dev 既定で供給済み）。
  - 一般＝`ACME-01`/`user@acme.example`（MFA OFF）・`ACME-02`/`mfa@acme2.example`（MFA ON）。
- **frontend 型チェック（マウント・軽量）**＝`cd impl && docker compose run --rm --no-deps -T -v "$PWD/frontend/src:/app/src" frontend node_modules/.bin/tsc --noEmit`。
- **frontend 実挙動/e2e に反映**＝`docker compose up -d --build frontend`（src 焼き込み）。**焼くたびに** `docker compose exec -u root -T frontend npx playwright install-deps chromium` → `docker compose exec -T frontend npx playwright install chromium`（ブラウザ本体）→ `docker compose exec -T -e LOGIN_RATE_LIMIT_MAX=50 frontend npx playwright test --workers=1`（**本セッション実測 26 passed**）。**spec のみ**なら再ビルド不要で `docker compose cp frontend/e2e/<spec> frontend:/app/e2e/<spec>`。
- **backend テスト（ホスト編集反映・マウント）**＝`cd impl && docker compose up -d db redis && docker compose run --rm --no-deps -T -v "$PWD/backend:/app" backend pytest tests/ -q`（前セッション 164 passed・本セッション未再実行）。
- **OpenAPI 型生成**＝backend 起動後 `docker compose run --rm --no-deps -T -v "$PWD/frontend/src:/app/src" -e OPENAPI_URL=http://backend:8000/openapi.json frontend npm run codegen`（`src/lib/api/schema.d.ts` 再生成・**デモデータ fixtures はこの型に合わせる**）。
- **デザインシステムの正**＝`impl/frontend/src/styles/design-system.css`（＝`doc/画面設計/mocks/shared.css` の複製）。共通クラスを足す時は**両方に同期**。モックは `doc/画面設計/mocks/SC-xx_*.html`（見た目の正）・`doc/画面設計/screens/SC-xx_*.md`（機能詳細）・`doc/画面設計/画面遷移図.md`（遷移の正）。
- **主要 env**＝`impl/.env.example`（雛形）／実設定は `impl/compose.yaml` `&backend_env`。`LOGIN_RATE_LIMIT_MAX=50` で e2e の 429 回避（多数ログイン時）。詰まったら `docker compose exec redis redis-cli flushall`。
- **リポジトリ運用**＝`.gitignore` で `*.pdf`・`.env` 追跡外。コミットは 実装本体→handoff の2段・末尾 Co-Authored-By・**プッシュはユーザー依頼時のみ**。TC-ID＝`<ドメイン>-TC-<3桁>`（既存最大 B-TC-125）。CLAUDE.md が各規約への入口。

---

### 自己チェック（このファイルだけで再開できるか）
- ✅ 再開点＝§7＝**(D) UI標準/モック精度（最優先）**：**D-0 一覧DataTableのユーザー確認フィードバック反映**（`mocks/SC-91`・`style-guide` の「9.」）→ D-1 usermenu の UI/アニメ → D-2 各画面ラベル横断見直し → D-3 DataTable を他一覧へ展開 → D-4 impl 反映。**（A-1〜A-3 SC-92/90/所属エディタ・(B) 画面群移植は保留）**。
- ✅ 状態＝**本セッションは doc/画面設計（mocks）のみ変更＝impl 無変更**。frontend full e2e は前回 SC-91 再整合時 **26 passed**（本セッションでは impl 触らず未再実行）。DataTable は**ヘッドレスで JSエラー無し・全機能描画確認**。migration head control 0010・company 0006。作業ツリー クリーン・**本セッション分は未 push**。
- ✅ 方針＝**画面モック先行→接続**（`doc/規約/フロントエンド実装フロー規約.md`）。shared.css 正・URL モーダル・DoD＝モック一致。再利用部品＝`components/ui/{Modal,Pager,RowMenu,Avatar,Button,Field,Card,Swatches}`・`components/layout/{AppHeader,QuestIcon,ScreenStub}`。**`Swatches`（`SWATCH_PRESETS` 10色）は SC-92 会社カラーでそのまま再利用可**。
- ⚠ **DataTable は mocks 側のみ＝impl 未反映**（D-4 で対応）。`.seg` は `shared.css`（mocks）には新設したが **design-system.css（impl）未昇格**。会社アイコン画像は MinIO 基盤待ち。backend pytest 164 は前セッション値（未確認扱い・本セッション無変更）。SC-92/90 は未整合（旧実装・保留）。
- ⚠ 仕様の詰め方＝**ユーザーの口頭イメージから仕様化する**（プレビュー付き選択肢での択一は不可）＝[[design-spec-working-style]]。
- ⚠ 詳細の正は各 `doc/` 文書（本 handoff は要約）。会話ログは参照不可。
- ⚠ Docker は本 handoff 時点で **7 サービス稼働中**（frontend は SC-91 再整合込み・backend は K.3 期。**本セッションの mocks 変更は impl イメージに無関係**）。
