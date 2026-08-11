# 作業引き継ぎ (handoff)

> 次回セッション開始時に **このファイルだけ読めば作業を再開できる** ことを目的とした引き継ぎメモ。
> 読者は「このセッションの記憶が一切ない次回の自分」。会話ログは参照不可。詳細仕様は必ず `doc/要件定義/README.md`（唯一の要件定義書）・`doc/API設計/`・`doc/ADR/`・`doc/データモデル.md` を参照。
> 毎回このファイルは全文を上書きする（履歴は git に任せる）。
>
> **現在地＝実装スキャフォールド進行中。手法＝「設計書→（必要なら ADR で具体値確定）→テストパターン→テストコード→実装」で 1 スライスずつ縦に通す。red-green 必須（テスト規約 §5.1）。**
>
> **本セッションで完了＝(A) ② メール非同期化（`mail_outbox`・ADR-0007・FK バグ修正含む）／(B) `logout-all` frontend 導線（A-TC-022）／(C) `last_login_at` ミラー writer（B-TC-006）／(D) §4.6 seq 正規化／(E) ドメイン B（アカウント管理 API）を大きく縦通し＝B0 基盤（bootstrap OPS＋system_admin／`/admin` 認可）・B1 会社CRUD・B2 アカウント CRUD（発行/編集/disable/enable/password-reset・system_admin＋company_account_admin 両経路）。**
> **次＝ドメイン B の残りは B3 QG管理者＋memberships のみ＝いずれも会社DB `quest_groups`/`quest_group_members`（ドメインC領域）が前提。B とC の境界。着手前に「Cのテーブルを先に作るか」を相談。**

---

## 1. 最終更新日時 / ブランチ / 最新コミット

- 最終更新: **2026-08-11 JST**（セッション終了時）。
- ブランチ: **main**（作業ツリー クリーン・`origin/main` と同期＝`git status` で確認済み・**未プッシュのコミットは無い**）。
- 最新コミット: **`fd9a1e4`**（ドメインB B1＝会社CRUD）。※本 handoff 更新はこの後の別コミット。
- 本セッションのコミット（古い順・すべて `origin/main` へプッシュ済み）:
  - `62ba95d` テスト追加 A-TC-082（失敗計数の固定窓TTL経過リセット・ADR-0005）
  - `449fc28` docs(ADR-0007) メール送信の非同期化を確定
  - `e9e9c5d` docs(データモデル §4.7) mail_outbox 追記
  - `b2d3796` テストパターン §7 追加（A-TC-090〜099）
  - `ff65136` docs(ADR-0007 §2.9) スコープ境界を追記
  - `f9a750d` 実装 mail_outbox データ層（サブスライス1/3）
  - `c135e1d` 実装 mail_outbox ワーカ＋レンダリング（サブスライス2/3）
  - `cb25f19` 実装 auth をメール非同期化に切替（サブスライス3/3・完了）
  - `8b58d53` docs 相互参照更新（ADR-0002/0005 の「MVP許容」を解消済みに）
  - `55bba89` handoff 全文更新
  - `4170627` 修正 mail_worker の FK 解決失敗（別プロセスの import 隔離バグ）＋回帰ガード A-TC-100
  - `e638ab2` handoff 更新（フルスタック目視＋FK バグ修正）
  - `df45148` 実装 logout-all の frontend 導線（A.0-⑤・e2e A-TC-022）
  - `6630991` handoff 更新（logout-all）
  - `822b68d` 実装 last_login_at ミラー writer（account_sync・§4.6・B-TC-006）
  - `2684e76` handoff 更新（last_login_at）
  - `34aacb3` docs(データモデル §4.6) seq を明記＝実装との差分を正規化
  - `ffe1afb` handoff 更新（§4.6 正規化）
  - `8edca78` 実装 ドメインB B0＝bootstrap（OPS＋system_admin）＋/admin 認可基盤＋アカウント一覧（B-TC-010〜014）
  - `63d9710` handoff 更新（B0）
  - `41ededc` 実装 ドメインB B2＝アカウント発行（B.5・outbox＋mail・migration 0007・B-TC-020〜024）
  - `c69ff14` handoff 更新（B2 発行）
  - `ce4413a` 実装 ドメインB B2残＝disable/enable/password-reset（last_system_admin・A.9-③・B-TC-025〜029）
  - `6129556`/`c135d10`/`6b9fc3c` handoff 更新（B2 状態管理）
  - `0aac439` 実装 ドメインB B2＝アカウント編集 PATCH（identity一意再検証・自己降格拒否・A.9-③・B-TC-030〜034）
  - `0afba92` handoff 更新（B2 編集）
  - `9bdd5ad` 実装 ドメインB B2＝会社アカウント管理者 API /admin/accounts（B.2.1 SoD・B-TC-040〜043）
  - `dd4f67e` handoff 更新（company_account_admin 版）
  - `fd9a1e4` 実装 ドメインB B1＝会社CRUD /admin/companies（migration 0008・B-TC-050〜055）
- remote: `https://github.com/t-umekawa-sc/sc-ideaquest-G2.git`。

---

## 2. このプロジェクトのゴール

- **ideaquest**＝社内のアイデア創出をゲーミフィケーション（XP/コイン/レベル/魔法/ランキング）で促す **WEB アプリ**（マルチテナント SaaS・管理DB1＋会社DB N）。
- スタック＝フロント Next.js(App Router)／バック FastAPI(4層)／PostgreSQL(会社DBのみ PGroonga)／Redis／MinIO／MailHog(dev メール)／Docker。
- 設計フェーズは **API設計 A〜L 全確定＋横断再レビュー済み**。現在は **実装スキャフォールドを 1 スライスずつ縦に通す段階**。

---

## 3. 今回やったこと — 変更ファイルと理由

### (0) テスト追加 A-TC-082（`62ba95d`）
- 失敗計数の**固定窓 TTL 経過リセット**を検証（4回失敗→窓TTL経過→1回失敗で計数=1・ロック非発火）。既存 A-TC-074（成功でリセット）とは別経路。後追いテスト＝反転手技で red 目視（`doc/テスト/red確認台帳.md` A-TC-082）。

### (1) ② メール送信の非同期化（`mail_outbox`・ADR-0007）＝本セッションの主成果
目的＝同期送信が生む3綻び〔(a) ロック通知のタイミングオラクル・(b) SMTP失敗で 202/401 が 500・(c) `request` 残余タイミング差〕を、「enqueue→別プロセスワーカが送信」で根治。

**設計（先に確定）**:
- `doc/ADR/ADR-0007_メール送信の非同期化.md`（**確定**）＝機構＝管理DBメールアウトボックス（Redis不採用）／ワーカ＝account_sync とは**別プロセス** `mail_worker.py`（障害隔離）／秘匿値＝完成本文を保存せず **`secret` 列に隔離・送信時レンダリング・送信後 NULL 化**／配送＝at-least-once＋**`status=sending`** で重複緩和／`done` 行はワーカが **7日 retention** 後に削除・`failed` は残す／**スコープ＝control-plane 認証系メール専用**（§2.9・テナント系メールは会社DB側の別機構＝別ADR）。
- `doc/データモデル.md` §4.7（テーブル定義）＋§3 Enum に `mail_category`/`mail_status`＋管理DB ER図/flowchart にノード。
- `doc/テスト/A_認証.md` §7（A-TC-090〜099）。

**実装（3サブスライス・すべて red-green）**:
- 新規 `impl/backend/app/control_plane/mail_outbox/`＝`orm.py`(MailOutboxEntry)／`repository.py`(enqueue・fetch_pending_ids)／`templates.py`(render＝category+secret+locale→subject/body・auth から移設)／`application.py`(`process_mail_outbox_once`＝reclaim→pending確保(sending)→送信→done+secret NULL、失敗 attempts++/pending・上限超 failed+secret NULL、独立処理でHOL無し／`cleanup_done_mail_outbox`＝retention 超 done 削除)。
- 新規 `impl/backend/app/mail_worker.py`＝別プロセスエントリ（`process_mail_outbox_once` ループ・掃除は間引き `_CLEANUP_EVERY_N_PASSES`・SIGTERM/SIGINT 停止）。
- 新規 migration `impl/backend/migrations/control/versions/0005_control_mail_outbox.py`（String列＝account_syncに倣う）。`migrations/control/env.py` に `mail_outbox.orm` を metadata 登録。
- 変更 `impl/backend/app/control_plane/auth/application.py`＝`_send_otp_email`/`_send_lock_notification`/`_send_password_setup_email` を撤去し `_enqueue_mail`（session相乗り or 単独INSERT）に置換。login MFA=OTP enqueue／INVALID経路のロック発火=lock_notification enqueue／`resend_mfa`=OTP enqueue／`request_password_setup`=`otp_challenges` 作成と**同一Tx**で enqueue（原子化）。`get_mail_sender` 直呼びを撤去。
- 変更 `impl/backend/app/core/config.py`＝`mail_outbox_max_attempts`/`_poll_interval_seconds`/`_sending_reclaim_seconds`(60)/`_done_retention_seconds`(604800)。`impl/compose.yaml`＝`mail-worker` サービス追加＋`&backend_env` に `MAIL_OUTBOX_*` 配線。`impl/.env.example` に同 env。
- テスト: `impl/backend/tests/mail_outbox/test_mail_outbox.py`(機構 091/094/095/096/097)／`impl/backend/tests/auth/test_mail_async.py`(統合 090/092/093/098/099)。`impl/backend/tests/conftest.py`＝**`_DrainingMail`**（`mail.sent` 参照時に `process_mail_outbox_once()` で配信する薄い委譲＝既存の同期送信前提TCを無改変で通す）＋`mail_outbox` の autouse truncate（トランスポート隔離）＋factory teardown で FK 掃除。
- docs 相互参照＝ADR-0002 §2.3・ADR-0005 §5 の「MVP許容/将来対応」を **ADR-0007 で解消済み**に更新。

### (2) `logout-all` の frontend 導線（A.0-⑤・`df45148`）
- 共通ヘッダーのユーザーメニューに「全端末からログアウト」を追加（既存「ログアウト」の直下）。backend EP `POST /auth/logout-all`（204・全セッション破棄＋信頼端末失効）は実装済み。
- `impl/frontend/src/features/auth/api.ts`＝`logoutAll()`／`components/LogoutAllMenuItem.tsx`（新規・確認ダイアログ無し＝既存 logout とパリティ）／`index.ts` export／`src/app/(app)/layout.tsx` に `<li>` 追加。
- e2e `impl/frontend/e2e/sc-00-login.spec.ts`＝A-TC-022。**既存 A-TC-021 が `getByRole` name の部分一致で「全端末からログアウト」にも一致して strict 違反 red になったのを検知→`exact: true` に修正**（導線追加が既存を壊さないことを担保）。

### (3) `last_login_at` ミラー writer（account_sync・§4.6・`822b68d`）
- ログイン成功時に `accounts.last_login_at` を更新し、**同一Tx で account_sync_outbox へ enqueue → 常駐ワーカが会社DB `users.last_login_at` へ冪等ミラー**（データモデル §5.3 認証イベント③）。password_set に続く 2 本目の writer。
- 管理DB `accounts` / 会社DB `users` に `last_login_at` 列（`migrations/control/0006` / `migrations/company/0003`）。
- `impl/backend/app/control_plane/auth/application.py`＝`_issue_session(r, session, account, company)` に副作用（`last_login_at` 更新＋`account_sync_repo.enqueue`）。login/verify_mfa の呼び出し側で `session.commit()`（verify_mfa は trust_device 非依存で commit するよう修正）。
- `impl/backend/app/tenant/profile/repository.py`＝`_MIRROR_FIELDS` に `last_login_at` 追加。**JSONB payload は ISO 文字列で運び、`upsert_user_mirror` で `datetime.fromisoformat` で復元**（`_DATETIME_FIELDS`）。
- テスト B-TC-006（`tests/account_sync/test_outbox.py`）。

### (4) ドメイン B（アカウント管理 API・`/admin/*`）＝本セッション後半の主成果
greenfield（`/admin` 無し・system_admin/OPS 未 seed）から縦通し。設計記録は API設計 B.0.1/B.1/B.2/B.2.1/B.5.1（新 ADR は起こさず準拠）。
- **B0 基盤（`8edca78`）**＝bootstrap（`scripts/bootstrap.py` の `_seed_ops_admin`＝運営テナント OPS＋初期 system_admin・B.5.1 案a＝env `BOOTSTRAP_ADMIN_PASSWORD` を Argon2id・空なら未 seed）。config/compose/.env に `OPS_COMPANY_CODE`/`BOOTSTRAP_ADMIN_*`。`/admin` モジュール新設＝`app/control_plane/admin/`（`deps.require_system_admin`＝B.0.1 P1/P2/P5/P6・401/403/404）。`GET /admin/companies/{id}/accounts`。
- **B1 会社CRUD（`fd9a1e4`）**＝`GET/POST/PATCH /admin/companies`・`/settings`。`companies` に color/icon/vote_anonymized/hide_voters_from_managers 列追加（**migration 0008**・§4.1 ドリフト解消）。作成は status=suspended・code 大文字正規化＋一意。設定は記名時に非開示を無効化（整合）。`company_application.py`。
- **B2 アカウント CRUD**＝発行（`41ededc`・B.5 フロー＝accounts INSERT＋同一Tx で account_sync_outbox〔users ミラー〕＋mail_outbox〔password-setup リンク非同期〕・`email` 一意 **migration 0007**）／disable/enable/password-reset（`ce4413a`・`last_system_admin` 不変条件・A.9-③ 全セッション破棄）／編集 PATCH（`0aac439`・自己降格拒否・role 変更で全セッション破棄）／company_account_admin 版 `/admin/accounts`（`9bdd5ad`・SoD＝system_role 付与不可・system_admin の disable 不可・セッション会社固定）。
- テスト＝`impl/backend/tests/admin/`（B-TC-010〜055・各ガードは無効化/反転で red 目視＝台帳）。conftest factory に `system_role` 引数追加。

---

## 4. 現在の状態 — 動いているもの / 壊れているもの / テスト

- **動いているもの（backend で縦通し済み）**:
  - ドメイン A ログイン：状態A（PWログイン）・B（初回/再設定PW）・C（MFA）・D（再設定要求）。**SC-00 は frontend も完了**。
  - アカウント一時ロック（ADR-0005）＋クライアント IP 確定（ADR-0006）。
  - **account_sync_outbox**（管理DB→会社DB `users` ミラー・§4.6・worker.py）＝writer は **`password_set`（complete）** と **`last_login_at`（login 成功・本セッション追加）** の 2 本。
  - **mail_outbox（本セッション）**：認証系メール（OTP・設定リンク・ロック通知）は同期送信せず enqueue → `mail_worker`/`process_mail_outbox_once` が SMTP 送信。**フルスタックで MailHog への非同期配信を目視確認済み**（request 202 直後は未送信→ワーカが配信・重複なし・行は done+secret NULL）。
  - **ドメイン B アカウント管理 API（本セッション）**＝`/admin/companies`（会社CRUD・system_admin）／`/admin/companies/{id}/accounts`（会社スコープのアカウント発行/編集/disable/enable/password-reset・system_admin）／`/admin/accounts`（company_account_admin・セッション会社固定・SoD）。bootstrap で OPS＋system_admin を seed。**未着手＝B3 QG管理者＋memberships（会社DB quest_groups/quest_group_members＝ドメインC依存）**。
- **テスト（本セッションで実測・マウント版）**:
  - **backend pytest = 110 passed**（＋ドメインB B0/B1/B2 の B-TC-010〜055・回帰なし）。**bootstrap は OPS 運営テナント＋初期 system_admin も seed する**（B.5.1・`BOOTSTRAP_ADMIN_PASSWORD` 供給時）。
  - **mail_worker 起動スモーク**＝`python -m app.mail_worker` が起動→SIGTERM 停止を確認。
  - **frontend tsc クリーン・e2e 5 passed**（既存4＋新規 A-TC-022・本セッション実測）。**重要＝メール依存 e2e（sc-00-mfa/password-setup）は非同期化により `mail-worker` の起動が前提**（specs は MailHog を最大20回ポーリングして待つ）。`mail-worker` を起動せず backend/frontend だけだと当該2本は red（enqueue されるが配信されない）。
- **Docker（本 handoff 時点）**＝**db / redis のみ起動中**（他は停止）。フルスタックで試すなら backend の再ビルドが必要（§8 注意）。
- **壊れているもの＝無し**。
- **未実装 / 負債**:
  - **ドメイン B 残り**＝B3 QG管理者 API＋memberships（会社DB `quest_groups`/`quest_group_members`＝ドメインC依存）。account/company の CRUD は完了（B0/B1/B2）。
  - **users ミラーの列不足**＝会社DB `users` は `login_id`/`email`/`system_role` 列が未追加（データモデル §5.3 は規定）。発行/編集の outbox payload にこれらを積んでも `upsert_user_mirror` は該当列が `_MIRROR_FIELDS` に無く無視（前方互換）＝会社DB単独のユーザ一覧で login_id 等は未反映。列追加＋`_MIRROR_FIELDS` 拡張は後続。
  - **account_sync_outbox の他 writer**＝プロフィール編集（K）。※`password_set`/`last_login_at`/発行/編集/無効化（B）は実装済み。
  - **outbox 系の `failed` 可視化/手動再送・管理者ロック解除**＝管理面が無く後続（両 outbox 共通）。
  - **本番デプロイ設定**（`TRUSTED_PROXY_COUNT` 実値・エッジ XFF 確定）＝`doc/本番デプロイ要件.md` §6・未確認。
  - **テナント/データプレーン由来のメール**（クエスト参加者通知・アイデア作成通知等）＝`mail_outbox` には載せない（ADR-0007 §2.9）。会社DB側の別機構＝**最初の該当機能実装時に別ADR**。

---

## 5. 詰まっている点 — 失敗したアプローチと理由

- **ブロッカーは無い**。
- **本セッションで見つけて直したバグ（重要な教訓）**:
  - **worker プロセスの import 隔離＝FK ターゲット未登録**（`4170627`）＝`mail_worker` は別プロセスで `mail_outbox.orm` しか import せず、FK 先 `accounts`/`companies`（auth.orm）が SQLAlchemy metadata に無い → `done` 書込のフラッシュで `NoReferencedTableError`。送信は成功するのに行が `sending`+secret 残存で滞留し reclaim で重複送信していた。**pytest では conftest が auth.orm を import 済みで再現しない**＝**worker エントリは必ずフルスタックでスモークすること**。直し＝`mail_outbox/application.py` で `auth.orm` を import（account_sync worker が無事なのと同じ＝application が auth を import する）。回帰ガード＝A-TC-100（子プロセスで application だけ import→metadata に accounts/companies があるか）。
- **本セッションの小さなハマり（再利用可）**:
  - **alembic の revision id は 32 字以内**＝`alembic_version.version_num` が `varchar(32)`。長い id（初回 `0006_control_accounts_last_login_at`＝35字）は upgrade 末尾の version 更新で `StringDataRightTruncation`。id を短縮（`0006_control_last_login_at` 等）。
  - **JSONB payload に datetime を載せる**＝ISO 文字列で積み、適用側（`upsert_user_mirror`）で `datetime.fromisoformat` に戻す（`_DATETIME_FIELDS`）。DateTime 列へ str を直 setattr しない。
- **本セッションで確立したやり方（重要・再利用可）**:
  - **新規ワーカ関数の test-first**＝`process_*_once` を先に **stub**（`return {...}` で何もしない）にしてテストを書き、「送信されない/状態が進まない」で**自然な behavior-red**を目視→本実装で green（ImportError で満足しない・§5.1）。
  - **auth のメール送信切替の red-green**＝新TC（090/092/093/098/099）を**切替前の同期送信のまま**実行して自然 red（request で送信が走る／SMTP例外が応答に漏れ 500）を目視→enqueue 化で green。
  - **既存の同期送信前提TCを壊さない工夫**＝`conftest._DrainingMail`。`mail.sent` を読むたびに `process_mail_outbox_once()` を挟む薄い委譲。配信は冪等（pending のみ送る＝多重参照で二重送信しない）。これで A-TC-030/060/077 等が**無改変**で通る。配信タイミングそのものの検証（同期送信しない）は §7 の新TCが担う（そちらは `set_sender` で素の FakeMailSender を使い配信を明示制御）。
  - **mail_outbox のテスト隔離**＝conftest の autouse で各テスト前後に `mail_outbox` を truncate（Redis flush と同思想＝トランスポート状態）。FK（→accounts）は子側削除なので抵触しない。factory teardown でも account_id 紐付き行を accounts 削除前に掃除。
- **一般のハマりどころ（継続）**:
  - **backend はイメージにソース焼き込み**（`COPY . .`）。ホスト編集を反映＝`-v "$PWD/backend:/app"` マウントで実行（§8）。
  - **env 上書きテスト**＝`monkeypatch.setenv(...)＋get_settings.cache_clear()`（finally で戻す。例＝`tests/mail_outbox/test_mail_outbox.py` の A-TC-094/097）。
  - **IP 差し替え**＝`TestClient(app, client=(ip, port))`（lock/mail-async の発火テスト）。
  - **メール送信が走るテストで実 SMTP を避ける**＝`mail` フェイク必須は従来通りだが、**非同期化で request 経路は SMTP を叩かない**ため、送信は `process_mail_outbox_once()` を呼んだ時だけ発生（fake 未設定なら実 SMTP に飛ぶので注意）。

---

## 6. 決定事項と根拠（採用しなかった案も）

### 本セッション（メール非同期化＝ADR-0007・2026-08-11 ユーザー承認）
正＝`doc/ADR/ADR-0007_メール送信の非同期化.md`・`doc/データモデル.md` §4.7。
- **機構＝管理DB `mail_outbox`**（不採用＝Redisキュー〔揮発・§4.6資産流用不可〕）。§4.6 account_sync_outbox と型は同じだが**用途別・会社DB跨がない**。
- **ワーカ＝別プロセス `mail_worker.py`**（不採用＝account_sync worker に相乗り〔SMTP詰まりが DBミラー反映に波及〕）。障害隔離優先。
- **秘匿値＝`secret` 列に隔離・送信時レンダリング・送信後NULL**（不採用＝完成本文を DB 保存）。at-rest 最小化。
- **配送＝at-least-once＋`status=sending` 緩和**（不採用＝exactly-once〔SMTP側重複排除が過剰〕）。クラッシュ窓のまれな重複は無害。
- **順序保証・HOL 無し**（§4.6 と対照＝メールは独立事象）。
- **`done` 掃除＝ワーカが 7日 retention 後に削除・`failed` は残置**（別 cron 立てない）。
- **スコープ＝control-plane 認証系メール専用**（§2.9）。テナント系は会社DB側の別機構（別ADR）。`mail_category` に足すのは認証系種別のみ。
- **テストのドメイン記号＝A 相乗り**（横断範囲が狭い）。

### 過去の確定（正は各 `doc/API設計/*.md`・`doc/ADR/*.md`。ここは要約）
- ログイン＝Cookie＋Redis 不透明セッション（ADR-0001）。初回/再設定PW（ADR-0002）。MFA/信頼端末（ADR-0004）。アカウント一時ロック（ADR-0005・(IP+login_id)・5回→15分・固定窓）。クライアントIP確定（ADR-0006）。設定の置き場所（ADR-0003＝env/DB）。
- account_sync_outbox（§4.6）＝管理DB→会社DB `users` ミラー・seq 順・冪等・HOLブロッキング（メール outbox とは方針が逆な点に注意）。
- 2プレーン×縦スライス4層（router→application→domain→repository・エントリは `main.py`/`worker.py`/**`mail_worker.py`** の3つ）。

---

## 7. 次にやること — 優先順に、具体的に

### (1) account_sync_outbox の writer 追加（§4.6・②とは別系統・残り）
- **`last_login_at`＝実装済み（本セッション・B-TC-006）**。
- 発行/編集/無効化（B.2/B.5）＝B ドメイン API 実装時に enqueue（`op=upsert/disable/enable`・payload に `display_name`/`login_id`/`email`/`system_role`/`locale`＋初期所属 `memberships`）。
- プロフィール編集（K・`PATCH /me`）＝`login_id`/`email`/`locale`/`display_name` の enqueue。

### (2) ドメイン B の続き（アカウント管理 API・着手中）
- **B0 完了**＝bootstrap（OPS＋system_admin）＋`/admin` 認可基盤（`admin/deps.require_system_admin`）＋`GET /admin/companies/{id}/accounts`（`8edca78`）。
- **B0/B1/B2 完了**＝B0 基盤（`8edca78`）／B1 会社CRUD（`fd9a1e4`）／B2 アカウント CRUD（発行 `41ededc`・状態管理 `ce4413a`・編集 `0aac439`・company_account_admin 版 `9bdd5ad`）。/admin モジュール＝`impl/backend/app/control_plane/admin/`（deps＝`require_system_admin`/`require_company_account_admin`・application＝アカウント・company_application＝会社・schemas・router）。テスト＝`impl/backend/tests/admin/`。
- **残り（いずれもドメインC依存）**＝(i) **memberships**（発行/編集 payload の `memberships:[{group_id,role}]`→会社DB `quest_group_members` を outbox 相乗で upsert・B.5 step3）、(ii) **B3 QG管理者 API**（`/admin/quest-groups`・`/admin/company-directory`・`require_qg_admin`）。**前提＝会社DB に `quest_groups`/`quest_group_members` テーブルを作る**（データモデル §5.5・company migration）。account/company の payload に login_id/email/system_role を積んでも users ミラーは該当列未追加で無視される点も注意（列追加は別途）。
  - 再利用＝`admin/application.issue_account` と同型。session 破棄＝`core.security.delete_account_sessions`＋`account_repo.revoke_all_trusted_devices`（logout_all 参照）。
- **B1**＝会社 CRUD（`GET/POST/PATCH /admin/companies`・`/settings`）。**B3**＝QG管理者・所属（quest_group_members）。
- 認可ヘルパは `admin/deps.py` に追加（`require_company_account_admin`＝セッション会社固定・`require_qg_admin` 等）。

### (3) 運用・本番系（設定/検証・`doc/本番デプロイ要件.md` §6）
- 本番トポロジのホップ数確定→`TRUSTED_PROXY_COUNT`／Next `rewrites()` の XFF 転送検証。
- 両 outbox（account_sync/mail）の `failed` 行の監視/アラート・手動対応、管理者ロック解除の可視化（管理面が整ってから）。

### 仕上げパス（ドキュメント正規化）
- ~~`doc/データモデル.md` §4.6 の seq 正規化~~＝**完了（`34aacb3`）**。ER図/列/index/取り出し順を seq に統一・横断ドリフト無し・doc/ 相対リンク切れ無しも確認。
- ドキュメント作成規約の網羅適用（裸 `§x` の文書名接頭辞化）＝**折衷方針で先送り**（設計確定後の最終パス。ADR は API設計参照を `A.1` 等ドメイン文字付きで統一しており個別書換は逆に不整合）。

---

## 8. 再開に必要な環境情報

- **フル起動**＝`cd impl && docker compose up -d --build`。ポート＝db `:5432`／redis `:6379`／**mailhog SMTP `:1025`・UI `:8025`**／backend `:8000`／frontend `:3000`。**worker / mail-worker はポート無し**（常駐のみ）。backend entrypoint が bootstrap（DB作成→`alembic` head〔control 0001-**0008**・company 0001-**0003**〕→seed＝2社＋**OPS 運営テナント＋初期 system_admin**〔`BOOTSTRAP_ADMIN_PASSWORD` 供給時〕・冪等）してから uvicorn。**今回終了時点で起動中は db / redis のみ**（他は停止）。**注意＝backend/mail-worker の実イメージは本セッションの変更を焼いていない＝フルスタックで試すなら `docker compose build backend frontend` 後に up する**。**dev system_admin ログイン＝会社コード `OPS`／`admin@ops.example`／`Passw0rd!`**。
- **seed（開発用ログイン）**＝会社 `ACME-01`（`mfa_required=false`）/`user@acme.example`／会社 `ACME-02`（`mfa_required=true`）/`mfa@acme2.example`。PW いずれも `Passw0rd!`。
- **backend テスト（ホスト編集を反映＝マウント版・編集中はこちら）**＝`cd impl && docker compose up -d db redis && docker compose run --rm --no-deps -v "$PWD/backend:/app" backend pytest tests/ -q`（**80 passed**・build 不要でホスト変更が即反映）。
- **メールワーカ単体スモーク**＝`cd impl && docker compose run --rm --no-deps -v "$PWD/backend:/app" -e MAIL_OUTBOX_POLL_INTERVAL_SECONDS=0.2 backend timeout 2 python -m app.mail_worker`（起動→停止ログを確認）。account_sync ワーカは `python -m app.worker`。
- **frontend 型チェック/lint**＝`docker compose run --rm --no-deps -T frontend npx tsc --noEmit` ／ `docker compose exec -T frontend npm run lint`。
- **e2e**＝フル起動後、**初回のみ** `docker compose exec -u root frontend npx playwright install-deps chromium` → `... install chromium` → `docker compose exec frontend npx playwright test`（**本セッション 5 passed**・chromium は本セッションで frontend コンテナに導入済み。コンテナ停止/削除で再導入要）。コンテナ内 MailHog は `http://mailhog:8025`。編集 spec は `docker compose cp frontend/e2e/<spec> frontend:/app/e2e/<spec>` で反映。**メール依存 e2e（mfa/password-setup）は `mail-worker` 起動が前提**（非同期配信・§4）。
- **MailHog**＝ブラウザ `http://localhost:8025`／API `GET http://localhost:8025/api/v2/messages`（本文 encode は password_setup=base64／MFA OTP=quoted-printable と一定でない＝base64 デコード試行→ダメなら生テキスト）。
- **主要 env**＝`impl/.env.example` が雛形（`.env` は追跡外・無ければ Compose が `${VAR:-既定}`）。**実設定は `impl/compose.yaml` の backend `environment:`（worker/mail-worker は `&backend_env` アンカーで同一）に列挙された変数のみコンテナへ届く**（`env_file:` 無し）。新規しきい値は必ず `environment:` に配線。今回追加＝**`MAIL_OUTBOX_*`（4種）** と **`OPS_COMPANY_CODE`/`BOOTSTRAP_ADMIN_LOGIN`/`BOOTSTRAP_ADMIN_EMAIL`/`BOOTSTRAP_ADMIN_PASSWORD`**（B.5.1・本番は強い秘密を供給／空なら system_admin を seed しない）。
- **リポジトリ運用**:
  - `.gitignore` で `*.pdf`・`.env` は追跡外（`.env.example` が雛形）。
  - コミットは **実装本体→handoff にハッシュ追記の2段**が基本。末尾に `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。**プッシュはユーザー依頼時のみ**。
  - **テストは red-green 必須**（`doc/規約/テスト規約.md` §5.1）。TC-ID＝`<ドメイン>-TC-<3桁>`。test-first の証跡はコミットメッセージ／後追い（反転手技）は `doc/テスト/red確認台帳.md`。
  - ドキュメント方針＝設計の正は1箇所・他は参照（drift 回避）／設計判断はなぜも併記／文書間参照は `doc/規約/ドキュメント作成規約.md`。`CLAUDE.md` が各規約への入口。

---

### 自己チェック（このファイルだけで再開できるか）
- ✅ 再開点＝**ドメイン B の残り＝B3 QG管理者＋memberships（会社DB `quest_groups`/`quest_group_members`＝ドメインC領域が前提）**。着手前に「C のテーブルを先に作るか」を相談。
- ✅ 本セッションの主成果（② メール非同期化＝`mail_outbox`・ADR-0007）と全変更ファイル・設計判断・スコープ境界（§2.9）を §3/§6 に記録。
- ✅ 状態＝backend 110 passed・**e2e 5 passed**・mail_worker スモーク OK・MailHog 配信目視・**ドメインB B0/B1/B2 完了**（本セッション実測）。起動中は db/redis のみ（実イメージは本セッション変更未反映＝フルスタックは要再ビルド）。未実装/負債（ドメインB B3/memberships＝C依存・users ミラー列不足・failed 可視化・本番設定）は §4 に明記。
- ✅ 再利用できる手法（新ワーカの stub test-first／auth 切替の red-green／`_DrainingMail` で既存TC温存／mail_outbox truncate 隔離）を §5 に記録。
- ⚠ 詳細な決定理由・具体値は各 `doc/ADR/*.md`・`doc/データモデル.md` §4.6/§4.7・`doc/テスト/*.md`・`doc/規約/テスト規約.md` を正とすること（本 handoff は要約）。会話ログは参照不可。
