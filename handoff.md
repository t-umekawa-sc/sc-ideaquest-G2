# 作業引き継ぎ (handoff)

> 次回セッション開始時に **このファイルだけ読めば作業を再開できる** ことを目的とした引き継ぎメモ。
> 読者は「このセッションの記憶が一切ない次回の自分」。会話ログは参照不可。詳細仕様は必ず `doc/要件定義/README.md`（唯一の要件定義書）・`doc/API設計/`・`doc/ADR/`・`doc/データモデル.md`・`doc/テスト/`・`doc/規約/` を正とすること（本 handoff は要約）。
> 毎回このファイルは全文を上書きする（履歴は git に任せる）。
>
> **現在地＝実装スキャフォールド進行中。手法＝「設計書→（必要なら ADR で具体値確定）→テストパターン→テストコード→実装」で 1 スライスずつ縦に通す。red-green 必須（`doc/規約/テスト規約.md` §5.1）。**
> **本セッションで完了＝口座一覧のページング・検索 UI（SC-92/SC-93）。frontend のみ（backend の一覧 EP は既に `q`/`status`/`page`/`per_page`・`page_info` 実装済）＝検索（氏名/ログインID/メール）＋状態フィルタ＋オフセットページャ＋メールアドレス列を追加。共通部品（Pager・useAccountList・AccountsToolbar）に抽出（DRY）。**

---

## 1. 最終更新日時 / ブランチ / 最新コミット

- 最終更新: **2026-08-12 JST**（セッション終了時）。
- ブランチ: **main**（作業ツリー クリーン）。
- 最新コミット: 本 handoff コミット（`origin/main` へ **プッシュ済み**）。直前＝**`cd6e775`**（実装 口座一覧のページング・検索 UI）。
- 本セッションのコミット（古い順）:
  - `cd6e775` 実装 口座一覧のページング・検索 UI（SC-92/SC-93）＝検索＋状態フィルタ＋ページャ＋メール列。frontend のみ（backend 変更なし）。
  - （本コミット）handoff 全文更新。
- 前セッションまでの最新＝`cbc97ae`（handoff）／`e6d1f17`（K.3 メール変更 double opt-in）。
- remote: `https://github.com/t-umekawa-sc/sc-ideaquest-G2.git`。
- **プッシュはユーザー依頼時のみ**。コミットは **実装本体→handoff にハッシュ追記の2段**が基本。コミット末尾に `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。

---

## 2. このプロジェクトのゴール

- **ideaquest**＝社内のアイデア創出をゲーミフィケーション（XP/コイン/レベル/魔法/ランキング）で促す WEB アプリ（マルチテナント SaaS・**管理DB1＋会社DB N** の2プレーン）。
- スタック＝フロント Next.js(App Router)／バック FastAPI(4層)／PostgreSQL(会社DBのみ PGroonga)／Redis／MinIO／MailHog(dev メール)／Docker。
- 設計フェーズは **API設計 A〜L 全確定＋横断再レビュー済み**。現在は **実装スキャフォールドを 1 スライスずつ縦に通す段階**。

---

## 3. 今回やったこと — 変更ファイルと理由

### 口座一覧のページング・検索 UI（`cd6e775`）＝本セッションの主成果
目的＝一覧の暫定負債（frontend が `per_page=100` 固定でページング/検索 UI 未実装）を解消。backend の一覧 EP（`GET /admin/companies/{id}/accounts`＝SC-92／`GET /admin/accounts`＝SC-93）は既に `q`（氏名/ログインID/メール）・`status`（active/disabled）・`page`・`per_page`（既定20・最大100）と `page_info{total,page,per_page}`（README §1.8）を実装済み（API 層は B-TC-014 で検証済み）＝**本スライスは frontend UI をそれに配線するだけ**。正＝`doc/画面設計/screens/SC-92_会社詳細.md`・`SC-93_会社アカウント管理.md`（ツールバー＝検索＋状態フィルタ＋発行）・`doc/API設計/B_会社・アカウント・所属.md`（B.2/B.2.1）・`doc/テスト/B_会社・アカウント.md` §16。

**確定した実装方針（2026-08-12 ユーザー承認）**:
- **共通部品に抽出**（不採用＝各 Section にインライン。理由＝AccountSection/AccountSelfSection は元々ほぼ重複でさらに重複が増えるため DRY §2.3 に従い抽出）。
- **メールアドレス列も追加**（設計の一覧テーブルはメール列を要求。所属クエストグループ列は会社DB 依存＝backend 未対応のため別スライス）。

**frontend（`impl/frontend/src/`）**:
- 新規 `components/ui/Pager.tsx`＝汎用オフセットページャ（前へ/現在/次へ・`totalPages=ceil(total/perPage)`・判定はサーバーの `page_info` に従い UI は表示と `onPageChange` のみ）。`components/ui/index.ts` に export。
- 新規 `features/accounts/useAccountList.ts`＝検索/状態フィルタ/ページ状態＋取得を集約する共有フック。取得系（`listAccounts`/`listOwnAccounts`）を fetcher として受ける（経路差はフックの外）。`PER_PAGE=20`（backend 既定と一致）。`apply()` は検索/フィルタ適用時に `page=1` へ戻す（絞り込みで範囲外を防ぐ）。
- 新規 `features/accounts/components/AccountsToolbar.tsx`＝検索ボックス（`type=search`・aria-label「検索（氏名・ログインID・メール）」）＋状態 select（すべて/有効/無効）＋「検索」＋「クリア」。submit で親へ確定値（打鍵ごとの API 連打を避ける）。
- `features/accounts/api.ts`＝`listAccounts`/`listOwnAccounts` に `page`/`per_page` を配線・**固定 `per_page=100` を撤去**。
- `features/accounts/components/AccountSection.tsx`（SC-92）／`AccountSelfSection.tsx`（SC-93）＝`useAccountList`＋`AccountsToolbar`＋`Pager`＋**メールアドレス列**に更新。所属候補（グループ一覧）は一覧の検索/ページングに依存しないので**別 effect でマウント時に一度だけ取得**（発行フォームでのみ使用・取得失敗は一覧表示を妨げない）。**SC-92 ルートを `<section aria-label="この会社のアカウント管理">` 化**（a11y＋会社詳細ページに複数テーブルがあるため e2e スコープを明確化。SC-93 は既存 `<section aria-label="自社アカウント管理">`）。
- `features/companies/companies.css`＝`.list-toolbar`（検索行・flex-wrap）／`.pager`／`.pager-status` を追加。

**テスト**:
- e2e 新規＝**B-TC-124**（`sc-93-own-accounts.spec.ts`）・**B-TC-125**（`sc-92b-accounts.spec.ts`）＝メール列ヘッダ表示・1ページ目は「前へ」不可・**発行時に login≠email**にして検索絞り込み後に両セルが出る（＝メール列が email を表示している証拠）・「（1 件）」表示＋「次へ」不可・クリアで全件復帰。region ロール（`aria-label`）でスコープ。
- e2e 改定＝既存 **B-TC-114/115/117/122** は per_page=20 で新規発行行が最終ページに回るため「**発行後に検索ボックスで当該行を絞ってから検証**」に更新（backend 挙動は不変・並びは `Account.created_at, id` で決定的＝ページングは正常）。**B-TC-114** の seed 可視アサーションはメール列追加で `login==email` の seed が login/email 2セルに出る（strict 違反）ため `.first()`。
- `doc/テスト/B_会社・アカウント.md`＝**§16**（B-TC-124/125・「テスト範囲の概要」付き）を追記。

---

## 4. 現在の状態 — 動いているもの / 壊れているもの / テスト

- **動いているもの（backend で縦通し済み）**:
  - **ドメイン A ログイン**：状態A（PWログイン）・B（初回/再設定PW）・C（MFA）・D（再設定要求）。SC-00 は frontend も完了。アカウント一時ロック（ADR-0005）＋クライアントIP確定（ADR-0006）。
  - **account_sync_outbox**（管理DB→会社DB `users` ミラー・§4.6・`app/worker.py`）＝writer は `password_set`／`last_login_at`／発行・編集・無効化・再有効化（B）／プロフィール編集（K `PATCH /me`）／メール変更の確定（K.3 `POST /me/email/confirm`・upsert{email}）。worker は payload の `memberships` を `users` の後に会社DB `quest_group_members` へ適用（B.5 step3・FK 順・加算専用）。所属の「修正」（差分・削除）は編集経路（`admin/application._apply_membership_diff`・B.3）／QG管理者 API（B.4）が担う。
  - **mail_outbox**（認証系メール非同期・ADR-0007・`app/mail_worker.py`）＝OTP・設定リンク・ロック通知＋メール変更の確認リンク（`email_change_confirm`・新宛）／変更通知（`email_change_notice`・旧宛）。
  - **ドメイン B アカウント管理 API（`/admin/*`）**＝会社CRUD／会社スコープのアカウント発行/編集/disable/enable/password-reset（system_admin）／`/admin/accounts`（company_account_admin・セッション会社固定・SoD）／QG管理者 API（B.4）／quest_groups CRUD。**一覧 EP は `q`/`status`/`page`/`per_page`（既定20・最大100）＋`page_info`（並び＝`created_at, id` で決定的）**。bootstrap で OPS 運営テナント＋初期 system_admin を seed。
  - **ドメイン K**＝`GET /me`（identity）・`PATCH /me`（display_name/locale）・`POST /me/password`（204＋全セッション破棄＋信頼端末失効）・`POST /me/email`（202＝要求・pending 化）／`POST /me/email/confirm`（未認証・確定＝email 反映＋ミラー・ADR-0008 double opt-in）。
  - **監査ログ**＝`system_audit_logs`（control 0009）に特権操作を記録（`AuditContextMiddleware`・B.6）。`email.change.confirm` 含む。
  - **session `is_qg_admin`**＝ログイン時に会社DBの admin 所属を集計し session にスナップショット（SC-90 ナビ出し分け）。
- **frontend（フルスタックで実測）**＝features に companies／accounts（**AccountSection＝system_admin クロステナント／AccountSelfSection＝会社アカ管理者 自社。両者とも本セッションで検索＋状態フィルタ＋ページャ＋メール列を実装**）／questgroups／qgadmin／profile（ProfileForm＋SecuritySection＋EmailChangeConfirm）。共通 UI に **`Pager`**（`components/ui`）。route＝`(app)/admin/companies[/[id]]`・`/admin/accounts`・`/admin/quest-groups`・`/profile`・`(auth)/email-change/confirm`。ヘッダーナビは system_role と is_qg_admin でゲート。**口座一覧は per_page=20＝検索/フィルタ/ページャ実装済（暫定 per_page=100 は解消）。所属クエストグループ列だけは backend 未対応で未表示（別スライス）**。
- **テスト（本セッションで実測）**:
  - **backend pytest = 164 passed**（**本セッションは backend 変更なし**＝前セッション実測値のまま。migration head＝control 0010・company 0006）。※`B-TC-005` HOL・`A-TC-077` ロック通知・`A-TC-096` mail reclaim は稀に timing フレーク＝再実行で green。
  - **full e2e = 24 passed**（`docker compose exec -T frontend npx playwright test --workers=1`・`LOGIN_RATE_LIMIT_MAX=50`）。内訳＝従来22＋**新規2（B-TC-124/125）**。
- **Docker（本 handoff 時点）**＝**フルスタック起動中**（db/redis/mailhog/backend/frontend/worker/mail-worker）。**frontend イメージは本スライス（ページャ/検索 UI）込みで再ビルド済み**。backend イメージは前セッション（K.3）のまま（本セッションで backend 変更なし）。
- **壊れているもの＝無し**。
- **未実装 / 負債**:
  - **ドメイン K 残り**＝`GET /me` の残高・画像（署名URL）同梱＝K.1 全体（MinIO・別スライス）。K.4 画像（背景/アバター・MinIO）。PW 変更完了メール通知（H・任意）。
  - **口座一覧の所属クエストグループ列**（設計の一覧テーブルはメール＋所属を要求。メールは本セッションで追加済・**所属列は会社DB `quest_group_members` 依存で backend 一覧 EP 未対応**＝backend 拡張後に frontend 列追加）。
  - **メール変更 pending・期限切れトークンの物理掃除**（論理無効化のみ＝後続運用課題・password_setup と共通）。
  - **監査ログの閲覧 UI/API**・保持/エクスポート方針（B.6 は記録まで）。両 outbox（account_sync/mail）の `failed` 行の可視化/手動再送・管理者ロック解除＝管理面が無い。
  - **ドメイン C 以降**（クエスト等）未着手。`delete_company_quest_group` の quests 参照チェックは quests テーブル実装時に追加する TODO（コードにコメント済み）。
  - **本番デプロイ設定**（`TRUSTED_PROXY_COUNT` 実値・エッジ XFF 確定）＝`doc/本番デプロイ要件.md` §6・未確認。

---

## 5. 詰まっている点 — 失敗したアプローチと理由

- **ブロッカーは無い**。
- **本セッションのハマり（解消済み）**:
  - **per_page=100→20 で既存 e2e が回帰**＝発行→無フィルタ一覧で「当該行が見える」系（B-TC-114/115/117/122）は、蓄積アカウントで新規行が最終ページに回り不可視化して落ちる。**backend 挙動は変えず**（並びは `created_at,id` で決定的＝ページング自体は正常）、テストを「**発行後に検索で絞ってから検証**」に更新して解消。教訓＝**ページング導入時は「発行→一覧で確認」系テストは検索で絞る前提に直す**。
  - **メール列追加で `getByText` が strict 違反**＝seed の `login==email`（例 `user@acme.example`）が login/email 2セルに出て 2 マッチ。`.first()` か行スコープ（`getByRole("row",{name:RegExp})`）で回避。新規テスト（B-TC-124/125）は **login≠email** で発行して列表示を検証。
  - **e2e スコープ**＝SC-92 会社詳細は複数テーブル（アカウント＋グループ）が同居。AccountSection に `aria-label` を付け `getByRole("region",{name})` でスコープしてセレクタ衝突を回避。
- **過去セッションからの重要な教訓（再発防止）**:
  - **frontend 再ビルドで Playwright ブラウザ本体が消える**＝`install-deps`（システム依存）だけでは足りず `npx playwright install chromium`（ブラウザ本体）も要る。**frontend を焼き直したら deps＋browser の両方を入れ直す**（本セッションでも実施）。
  - **frontend の新規 EP 型は codegen 先行**＝backend を新コードでビルド/起動→`npm run codegen`→schema.d.ts 再生成→frontend ビルドの順。**本セッションは backend 変更なし＝codegen 不要だった**。
  - **worker プロセスの import 隔離＝FK ターゲット未登録**＝worker エントリは必ずフルスタックでスモーク（回帰ガード＝A-TC-100）。
  - **alembic の revision id は 32 字以内**（`alembic_version.version_num` が varchar(32)）。
  - **JSONB payload に datetime**＝ISO 文字列で積み適用側で `datetime.fromisoformat`。**監査ログ detail に UUID/datetime**＝`json.dumps(default=str)`。detail に PW/トークンを入れない（§15）。
  - **session に足したフラグが GET /session に出ない**＝`auth/application.py` `_SESSION_PUBLIC_KEYS`（ホワイトリスト）に載せる必要。
- **環境まわりの定番ハマり**:
  - **Bash の cwd ドリフト**＝`docker compose` は必ず `cd /home/t-umekawa/sc-ideaquest-G2/impl` してから。
  - **backend はイメージにソース焼き込み**（`COPY . .`）＝テストはホスト編集を反映するため `-v "$PWD/backend:/app"` マウントで実行／実起動は再ビルド。
  - **frontend の tsc**＝`-v "$PWD/frontend/src:/app/src"`（src だけマウント）＋ `node_modules/.bin/tsc --noEmit`。**編集した spec を焼き直さず走らせるなら `docker compose cp frontend/e2e/<spec> frontend:/app/e2e/<spec>`**（本セッションで多用＝spec のみ変更なら frontend 再ビルド不要）。
  - **compose の `environment:` に列挙した変数のみコンテナへ届く**（`env_file:` 無し）。新規しきい値は必ず `&backend_env` に配線（worker/mail-worker も同アンカー）。

---

## 6. 決定事項と根拠（採用しなかった案も）

### 本セッション（口座一覧のページング・検索 UI）
- **共通部品に抽出**（不採用＝各 Section にインライン）＝両 Section は元々ほぼ重複でさらに重複が増えるため DRY（コーディング規約 §2.3）に従い `Pager`／`useAccountList`／`AccountsToolbar` に抽出。
- **メール列を追加**（設計の一覧テーブル要求）／**所属列は別スライス**（会社DB `quest_group_members` 依存で backend 一覧 EP 未対応）。
- **検索は submit で確定**（打鍵ごとの API 連打を避ける）。**検索/フィルタ適用で page=1 へ戻す**（絞り込みで範囲外を防ぐ）。
- **per_page=20**（backend 既定と一致）。**backend の並び順（`created_at,id`）は変更しない**（決定的でページング健全・「新規を先頭に」は search で担保）。

### 過去の確定（正は各 `doc/API設計/*.md`・`doc/ADR/*.md`。ここは要約）
- ログイン＝Cookie＋Redis 不透明セッション（ADR-0001）。初回/再設定PW（ADR-0002）。MFA/信頼端末（ADR-0004）。アカウント一時ロック（ADR-0005）。クライアントIP確定（ADR-0006）。設定の置き場所（ADR-0003）。メール非同期化（ADR-0007）。メール変更 double opt-in（ADR-0008）。
- account_sync_outbox（§4.6）＝管理DB→会社DB `users` ミラー・seq 順・冪等・HOLブロッキング（メール outbox は HOL 無し）。
- SoD（§8-⑯）＝system_admin／company_account_admin／QG admin（per-group）。
- 2プレーン×縦スライス4層（router→application→domain→repository・エントリは `main.py`/`worker.py`/`mail_worker.py` の3つ）。

---

## 7. 次にやること — 優先順に、具体的に

> ドメイン B バックエンド＋B/K 管理系 frontend（**口座一覧のページング・検索 UI 含む＝本セッション完了**）＋K identity 自己編集（K.3）は縦通し済み。次スライスの選択はユーザーと相談。以下は候補（優先順）。

### (1) GET /me の残高・画像同梱＝K.1 全体（MinIO 署名URL）
- 現状 `me/application.py` の `get_me` は identity サブセットのみ。K.1 は残高（コイン/XP 等）と画像（背景/アバターの署名URL）を同梱。
- 前提＝MinIO クライアント基盤（署名URL 生成）未整備＝**先に画像ストレージの ADR/設計を確認**（`doc/API設計/K_プロフィール・背景画像.md` K.1/K.4）。残高の源泉テーブル（C/ゲーミフィケーション系）未実装なら K.1 は C 着手後が自然＝要相談。

### (2) 口座一覧の所属クエストグループ列（backend 拡張→frontend 列追加）
- 一覧 EP（`AccountListItem`）に所属グループ/グループ内ロールを付与（会社DB `quest_group_members` 参照）→ frontend の一覧テーブルに所属列を足す。設計の一覧テーブルは所属列を要求（本セッションでメール列は追加済）。

### (3) 管理面（監査ログ閲覧・outbox failed 可視化）
- 監査ログ閲覧 API/UI（`system_audit_logs` 一覧・フィルタ）＝B.6 は記録まで。両 outbox（account_sync/mail）の `failed` 行の一覧・手動再送、管理者ロック解除。

### (4) ドメイン C 着手（クエスト等）
- 未着手。`doc/API設計/C_*.md`・`doc/データモデル.md` §5.x を正に、テーブル→repository→application→router で縦通し。quests 実装時に `delete_company_quest_group` に quests 参照チェックを足す（TODO コメント済み）。

### 仕上げパス（ドキュメント正規化）
- ドキュメント作成規約の網羅適用（裸 `§x` の文書名接頭辞化）＝**折衷方針で先送り**（設計確定後の最終パス）。

### 手法（毎スライス共通）
- **red-green 必須**（テスト規約 §5.1）＝実装前に対象の振る舞いで落ちる red を目視（証跡はコミットメッセージ／後追いは `doc/テスト/red確認台帳.md`）。
- **API設計に新規 EP を追記する時は既存節と同じ表形式に揃える**（memory 記録済み）。
- テストパターン md の TC 表を持つ各節に「テスト範囲の概要」を必須（テスト規約 §1.1）。

---

## 8. 再開に必要な環境情報

- **フル起動**＝`cd impl && docker compose up -d --build`。ポート＝db `:5432`／redis `:6379`／mailhog SMTP `:1025`・UI `:8025`／backend `:8000`／frontend `:3000`。**worker / mail-worker はポート無し**（常駐のみ）。backend entrypoint が bootstrap（DB作成→`alembic` head〔control 0001-0010・company 0001-0006〕→seed＝2社＋OPS 運営テナント＋初期 system_admin〔`BOOTSTRAP_ADMIN_PASSWORD` 供給時〕・冪等）してから uvicorn。
- **dev ログイン**:
  - system_admin＝会社コード `OPS`／`admin@ops.example`／`Passw0rd!`。
  - seed 会社＝`ACME-01`（`mfa_required=false`）/`user@acme.example`／`ACME-02`（`mfa_required=true`）/`mfa@acme2.example`。PW いずれも `Passw0rd!`。
- **backend テスト（ホスト編集を反映＝マウント版・編集中はこちら）**＝`cd impl && docker compose up -d db redis && docker compose run --rm --no-deps -T -v "$PWD/backend:/app" backend pytest tests/ -q`（**実測 164 passed**・build 不要でホスト変更が即反映）。部分＝`pytest tests/me -q`。
- **frontend 型/OpenAPI**＝tsc＝`docker compose run --rm --no-deps -T -v "$PWD/frontend/src:/app/src" frontend node_modules/.bin/tsc --noEmit`（**本セッション EXIT=0**）。OpenAPI 型は手書きせず codegen＝backend 起動後 `... -e OPENAPI_URL=http://backend:8000/openapi.json frontend npm run codegen`（`src/lib/api/schema.d.ts` 再生成・**本セッションは backend 変更なしで不要だった**）。**frontend の実挙動/e2e に反映するには frontend を再ビルド**（`docker compose up -d --build frontend`＝src 焼き込み）。
- **e2e**＝フル起動後、**frontend を焼くたびに** `docker compose exec -u root -T frontend npx playwright install-deps chromium` → `docker compose exec -T frontend npx playwright install chromium`（**ブラウザ本体も必須**）→ `docker compose exec -T frontend npx playwright test --workers=1`（**本セッション実測 24 passed**）。**spec のみ変更なら再ビルド不要**＝`docker compose cp frontend/e2e/<spec> frontend:/app/e2e/<spec>` してから走らせる。**メール依存 e2e（sc-00-mfa/password-setup）は `mail-worker` 起動が前提**。**多数ログインの 429 は `LOGIN_RATE_LIMIT_MAX=50` で解消**＝それでも詰まったら `docker compose exec redis redis-cli flushall`。
- **MailHog**＝ブラウザ `http://localhost:8025`／API `GET http://localhost:8025/api/v2/messages`。コンテナ内からは `http://mailhog:8025`。配送確認は `mail_outbox` の `status`（`done`/`failed`）を psql で見るのが確実。
- **主要 env**＝`impl/.env.example` が雛形（`.env` は追跡外）。**実設定は `impl/compose.yaml` の `&backend_env` アンカー**（worker/mail-worker も同一）。`LOGIN_RATE_LIMIT_*`／`LOGIN_LOCK_*`／`MAIL_OUTBOX_*`／`PASSWORD_SETUP_TTL`（config 既定 72h）／`EMAIL_CHANGE_TTL_SECONDS`（既定 86400＝24h・ADR-0008）／`OPS_COMPANY_CODE`・`BOOTSTRAP_ADMIN_*`／`OUTBOX_MAX_ATTEMPTS`／`TRUSTED_PROXY_COUNT`。
- **リポジトリ運用**:
  - `.gitignore` で `*.pdf`・`.env` は追跡外（`.env.example` が雛形）。
  - コミットは **実装本体→handoff の2段**・末尾 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`・**プッシュはユーザー依頼時のみ**。
  - TC-ID＝`<ドメイン>-TC-<3桁>`（既存最大＝**B-TC-125**）。設計の正は1箇所・他は参照（drift 回避）。`CLAUDE.md` が各規約への入口。

---

### 自己チェック（このファイルだけで再開できるか）
- ✅ 再開点＝§7＝**(1) GET /me 残高・画像（K.1 全体・MinIO）／(2) 口座一覧の所属クエストグループ列〔backend 拡張→frontend〕／(3) 管理面（監査ログ閲覧・outbox failed）／(4) ドメイン C 着手**。本セッション完了＝口座一覧のページング・検索 UI（SC-92/SC-93）。
- ✅ 状態＝**backend 164 passed（不変）・full e2e 24 passed**（本セッション実測）。migration head＝control 0010・company 0006。作業ツリー クリーン・`origin/main` へ push 済み。
- ✅ 本セッションの全変更（Pager／useAccountList／AccountsToolbar／api.ts／AccountSection／AccountSelfSection／companies.css／ui index／e2e 3 spec〔B-TC-124/125 追加・114/115/117/122 改定〕／doc/テスト/B §16）と理由・設計判断を §3/§6 に、ハマりと再発防止を §5 に記録。
- ⚠ 詳細な決定理由・具体値は各 `doc/ADR/*.md`・`doc/データモデル.md`・`doc/API設計/*.md`・`doc/テスト/*.md`・`doc/規約/*.md` を正とすること（本 handoff は要約）。会話ログは参照不可。
- ⚠ Docker は本 handoff 時点で **フルスタック起動中**（frontend イメージは本スライス込みで再ビルド済み・backend は K.3 のまま＝本セッション backend 変更なし）。
