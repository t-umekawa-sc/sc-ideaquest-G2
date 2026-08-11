# 作業引き継ぎ (handoff)

> 次回セッション開始時に **このファイルだけ読めば作業を再開できる** ことを目的とした引き継ぎメモ。
> 読者は「このセッションの記憶が一切ない次回の自分」。会話ログは参照不可。詳細仕様は必ず `doc/要件定義/README.md`（唯一の要件定義書）・`doc/API設計/`・`doc/ADR/`・`doc/データモデル.md` を参照。
> 毎回このファイルは全文を上書きする（履歴は git に任せる）。
>
> **現在地＝実装スキャフォールド進行中。手法＝「設計書→（必要なら ADR で具体値確定）→テストパターン→テストコード→実装」で 1 スライスずつ縦に通す。red-green 必須（テスト規約 §5.1）。**
> **直近スライス＝② メール送信の非同期化（`mail_outbox`・ADR-0007）を backend で縦通し完了。次スライス＝未着手（§7 の優先順から選ぶ・着手前に相談推奨）。**

---

## 1. 最終更新日時 / ブランチ / 最新コミット

- 最終更新: **2026-08-11 JST**（セッション終了時）。
- ブランチ: **main**（作業ツリー クリーン・`origin/main` と同期＝`git status` で確認済み・**未プッシュのコミットは無い**）。
- 最新コミット: **`8b58d53`**（相互参照更新）。
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

---

## 4. 現在の状態 — 動いているもの / 壊れているもの / テスト

- **動いているもの（backend で縦通し済み）**:
  - ドメイン A ログイン：状態A（PWログイン）・B（初回/再設定PW）・C（MFA）・D（再設定要求）。**SC-00 は frontend も完了**。
  - アカウント一時ロック（ADR-0005）＋クライアント IP 確定（ADR-0006）。
  - **account_sync_outbox**（管理DB→会社DB `users.password_set` ミラー・§4.6・worker.py）。
  - **mail_outbox（本セッション）**：認証系メール（OTP・設定リンク・ロック通知）は同期送信せず enqueue → `mail_worker`/`process_mail_outbox_once` が SMTP 送信。
- **テスト（本セッションで実測・マウント版）**:
  - **backend pytest = 78 passed**（従来67＋A-TC-082＋機構5＋統合5・回帰なし）。
  - **mail_worker 起動スモーク**＝`python -m app.mail_worker` が起動→SIGTERM 停止を確認。
  - **frontend tsc / e2e は本セッション未再実行**（frontend 未変更）。前回＝tsc クリーン・e2e 4 passed。
- **Docker（今回終了時点）**＝**db / redis のみ起動中**。backend/frontend/worker/mail-worker は停止（テストは `docker compose run --rm` の使い捨てで実行）。
- **壊れているもの＝無し**。
- **未実装 / 負債**:
  - **メール非同期化のフルスタック目視未実施**＝実 MailHog で「request→ワーカ配信」を通しで見る確認は未（backend テストでは担保済み）。
  - **account_sync_outbox の他 writer 未実装**＝`last_login_at`（login成功時）・発行/編集/無効化（B）・プロフィール編集（K）。
  - **outbox 系の `failed` 可視化/手動再送・管理者ロック解除**＝管理面が無く後続（両 outbox 共通）。
  - **`logout-all` の frontend 導線**＝未（backend EP は在る）。
  - **本番デプロイ設定**（`TRUSTED_PROXY_COUNT` 実値・エッジ XFF 確定）＝`doc/本番デプロイ要件.md` §6・未確認。
  - **テナント/データプレーン由来のメール**（クエスト参加者通知・アイデア作成通知等）＝`mail_outbox` には載せない（ADR-0007 §2.9）。会社DB側の別機構＝**最初の該当機能実装時に別ADR**。

---

## 5. 詰まっている点 — 失敗したアプローチと理由

- **ブロッカーは無い**。
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

### (1) メール非同期化のフルスタック目視（軽い・推奨で先に）
- `cd impl && docker compose up -d --build` → seed ログイン（MFA会社 ACME-02）や `password-setup/request` を叩き、**MailHog `http://localhost:8025`** に**ワーカ経由で**メールが届くことを確認。`mail-worker` が起動していること（`docker compose ps`）。

### (2) account_sync_outbox の writer 追加（§4.6・②とは別系統）
- `last_login_at` ミラー＝`login` 成功時（`_issue_session` 近辺）に enqueue。会社DB `users.last_login_at` 列追加（company migration）＋`_MIRROR_FIELDS` 拡張。
- 発行/編集/無効化（B.2/B.5）＝B ドメイン API 実装時に enqueue。

### (3) `logout-all` の frontend 導線
- `impl/frontend/src/components/layout/AppHeader.tsx` のユーザーメニューに追加（backend EP `POST /api/v1/auth/logout-all` は実装済み）。e2e を薄く1本。

### (4) 運用・本番系（設定/検証・`doc/本番デプロイ要件.md` §6）
- 本番トポロジのホップ数確定→`TRUSTED_PROXY_COUNT`／Next `rewrites()` の XFF 転送検証。
- 両 outbox（account_sync/mail）の `failed` 行の監視/アラート・手動対応、管理者ロック解除の可視化（管理面が整ってから）。

### 仕上げパス（ドキュメント正規化）
- **`doc/データモデル.md` §4.6 本文の「id（生成順）」を `seq` に正規化**（実装は seq・§4.7 は seq 明記済みだが §4.6 本文が未反映）。
- ドキュメント作成規約の網羅適用（裸 `§x` の文書名接頭辞化・現状は折衷で新規のみ準拠）。

---

## 8. 再開に必要な環境情報

- **フル起動**＝`cd impl && docker compose up -d --build`。ポート＝db `:5432`／redis `:6379`／**mailhog SMTP `:1025`・UI `:8025`**／backend `:8000`／frontend `:3000`。**worker / mail-worker はポート無し**（常駐のみ）。backend entrypoint が bootstrap（DB作成→`alembic` head〔control 0001-**0005**・company 0001-0002〕→seed 2社・冪等）してから uvicorn。**今回終了時点で起動中は db / redis のみ**。
- **seed（開発用ログイン）**＝会社 `ACME-01`（`mfa_required=false`）/`user@acme.example`／会社 `ACME-02`（`mfa_required=true`）/`mfa@acme2.example`。PW いずれも `Passw0rd!`。
- **backend テスト（ホスト編集を反映＝マウント版・編集中はこちら）**＝`cd impl && docker compose up -d db redis && docker compose run --rm --no-deps -v "$PWD/backend:/app" backend pytest tests/ -q`（**78 passed**・build 不要でホスト変更が即反映）。
- **メールワーカ単体スモーク**＝`cd impl && docker compose run --rm --no-deps -v "$PWD/backend:/app" -e MAIL_OUTBOX_POLL_INTERVAL_SECONDS=0.2 backend timeout 2 python -m app.mail_worker`（起動→停止ログを確認）。account_sync ワーカは `python -m app.worker`。
- **frontend 型チェック/lint**＝`docker compose run --rm --no-deps -T frontend npx tsc --noEmit` ／ `docker compose exec -T frontend npm run lint`。
- **e2e**＝フル起動後、**初回のみ** `docker compose exec -u root frontend npx playwright install-deps chromium` → `... install chromium` → `docker compose exec frontend npx playwright test`（**前回 4 passed**・今回 frontend コンテナ無し＝再導入要）。コンテナ内 MailHog は `http://mailhog:8025`。
- **MailHog**＝ブラウザ `http://localhost:8025`／API `GET http://localhost:8025/api/v2/messages`（本文 encode は password_setup=base64／MFA OTP=quoted-printable と一定でない＝base64 デコード試行→ダメなら生テキスト）。
- **主要 env**＝`impl/.env.example` が雛形（`.env` は追跡外・無ければ Compose が `${VAR:-既定}`）。**実設定は `impl/compose.yaml` の backend `environment:`（worker/mail-worker は `&backend_env` アンカーで同一）に列挙された変数のみコンテナへ届く**（`env_file:` 無し）。新規しきい値は必ず `environment:` に配線。今回追加＝**`MAIL_OUTBOX_MAX_ATTEMPTS`/`_POLL_INTERVAL_SECONDS`/`_SENDING_RECLAIM_SECONDS`/`_DONE_RETENTION_SECONDS`**。
- **リポジトリ運用**:
  - `.gitignore` で `*.pdf`・`.env` は追跡外（`.env.example` が雛形）。
  - コミットは **実装本体→handoff にハッシュ追記の2段**が基本。末尾に `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。**プッシュはユーザー依頼時のみ**。
  - **テストは red-green 必須**（`doc/規約/テスト規約.md` §5.1）。TC-ID＝`<ドメイン>-TC-<3桁>`。test-first の証跡はコミットメッセージ／後追い（反転手技）は `doc/テスト/red確認台帳.md`。
  - ドキュメント方針＝設計の正は1箇所・他は参照（drift 回避）／設計判断はなぜも併記／文書間参照は `doc/規約/ドキュメント作成規約.md`。`CLAUDE.md` が各規約への入口。

---

### 自己チェック（このファイルだけで再開できるか）
- ✅ 再開点＝**(1) メール非同期化のフルスタック目視**（軽い）→ その後は §7 (2)〜(4) から選ぶ（着手前に相談推奨）。
- ✅ 本セッションの主成果（② メール非同期化＝`mail_outbox`・ADR-0007）と全変更ファイル・設計判断・スコープ境界（§2.9）を §3/§6 に記録。
- ✅ 状態＝backend 78 passed・mail_worker スモーク OK（本セッション実測）。起動中は db/redis のみ。未実装/負債（他 writer・logout-all frontend・failed 可視化・本番設定・テナント系メール別機構）は §4 に明記。
- ✅ 再利用できる手法（新ワーカの stub test-first／auth 切替の red-green／`_DrainingMail` で既存TC温存／mail_outbox truncate 隔離）を §5 に記録。
- ⚠ 詳細な決定理由・具体値は各 `doc/ADR/*.md`・`doc/データモデル.md` §4.6/§4.7・`doc/テスト/*.md`・`doc/規約/テスト規約.md` を正とすること（本 handoff は要約）。会話ログは参照不可。
