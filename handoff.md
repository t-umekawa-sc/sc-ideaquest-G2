# handoff.md — 次セッションの自分への引き継ぎ

> 読者＝このセッションの記憶が無い次回の自分。会話ログは参照不可。本ファイルだけで再開できるよう**全文上書き**で維持（履歴は git）。
> 規約の正本＝リポジトリ直下 `CLAUDE.md`（毎セッション自動読込）。設計の正本は `doc/` 配下、実装現況は `impl/README.md`、**残作業の正本は `doc/バックログ/未実装・ギャップ一覧.md`**。

## 1. 最終更新 / ブランチ / 最新コミット
- 更新: 2026-10-09（深夜・**シークレット管理 D6 の (A) 一式**＝ファイル供給基盤＋本番 fail-closed ガード＋F9＋**SOPS+age 本体（at-rest）**セッション）。
- ブランチ: `main`（main 直 push が慣習）。
- コミット済み＝**`9200a89c` feat(secrets/D6): 秘密のファイル供給基盤(file>env)＋本番fail-closedガード＋F9**（push 済み）。
- **未コミット**＝本セッション後半の **SOPS+age 本体（at-rest）** 分はまだコミットしていない（ユーザー確認後に push）。変更＝`impl/.sops.yaml`（新）／`impl/secrets/secrets.template.yaml`（新）／`impl/scripts/decrypt-secrets.sh`（新）／`impl/compose.secrets.yaml`（権限方針修正）／`.gitignore`（template 追跡）／docs（設計ドラフト・本番デプロイ要件 §3.1・台帳 D6・impl/README）。**コミットしない＝実鍵 `secrets/age_example.key`・暗号化実体 `secrets/secrets.enc.yaml`（いずれも gitignore）**。
- alembic heads: company=`0064_chat_messages_pm_json`／control=`0020_signup_challenges`（**DB 変更なし**）。

## 2. プロジェクトのゴール
ISO56001 準拠のアイデア/イノベーション管理 SaaS（マルチテナント＝control DB＋会社別DB・ゲーミフィケーション）。直近フェーズ＝ユーザー指摘の消化＋仕様確定済み未実装機能の処理。本セッションは**横断セキュリティ基盤（秘密のファイル供給）を、セキュリティ優先の方針で実装**した。

## 3. 今回やったこと（セキュリティ優先・ユーザー合意に基づく）
> ユーザー指示＝「**セキュリティ優先で**」「**素通りの恐れがあるなら (広) を今やる**」。→ (A) ファイル供給基盤＋F9 に加え、**本番 fail-closed ガード（広）を今セッションで実装**（SOPS 本体へ先送りしない）。設計の正本＝[シークレット管理(SOPS)_設計.md](<doc/設計ドラフト/シークレット管理(SOPS)_設計.md>)。

1. **秘密のファイルマウント供給（横断基盤・backend）**＝`impl/backend/app/core/config.py`
   - `SettingsConfigDict(..., secrets_dir="/run/secrets" if exists else None)`＝**存在時のみ有効化**（dev は `/run/secrets` 無し＝従来 env・pydantic の "directory does not exist" 警告を出さない）。
   - `settings_customise_sources` で **file > env に反転**＝`(init, file_secret, env, dotenv)`。理由＝設計 §5 の芯は「env をやめて file」。env は `docker inspect`/`/proc/<pid>/environ`/子プロセス継承で覗ける露出面（T3）。**compose は本番でも env 既定を container に入れてしまう**ため、file が env に勝たないと file 供給が機能しない（実測で確認＝反転前は env が勝つ）。
2. **本番 fail-closed ガード（広・今セッションで実装）**＝`config.py insecure_prod_secrets(settings)` ＋ `app/main.py _enforce_prod_secret_guard()`（`lifespan` 冒頭で呼ぶ）。
   - `APP_ENV=prod` で **dev 既定値のまま**（`postgres_password=ideaquest`・`minio_access_key=ideaquest`・`minio_secret_key=ideaquest-secret`・`bootstrap_admin_password=Passw0rd!`・`jasper_shared_secret=dev-jasper-secret`）or **renderer=jasper の S2S 秘密が空**なら `RuntimeError` で**起動拒否**。
   - **形の決定＝「本番で全秘密を強制 non-empty」ではなく「dev 既定/プレースホルダを拒否」**（ユーザー合意）＝`bootstrap_admin_password=""`（seed しない）・`turnstile_secret_key=""`（CAPTCHA 無効）など**空が正当な意味を持つ秘密**の運用を壊さず、実際の footgun（dev 既定の本番流入）だけ塞ぐ。秘密値はログに出さず**フィールド名のみ**（§15）。
   - **完全な秘密棚卸しによる対象拡張のみ SOPS 本体へ**（台帳 D6・設計 §12-3）＝素通りしないよう台帳に明記。
3. **jasper 側（F9）**＝`impl/jasper/_secrets.py`（新規・純 stdlib＝Java 非依存で単体テスト可）＝`read_secret`（**file>env**・改行 strip）＋`secret_matches`（`hmac.compare_digest`＝**定数時間比較**・空 expected は常に拒否）。`app.py` は `/run/secrets/jasper_shared_secret` を読み、`/render` の認証を `secret_matches` に置換。`Dockerfile` の COPY に `_secrets.py` 追加（warmup が `from app import` するため必須＝追加漏れで一度 build 失敗した）。
4. **compose 本番オーバーレイ**＝`impl/compose.secrets.yaml`（新規）＝トップレベル `secrets:`（`file: ./secrets/jasper_shared_secret`）＋backend/jasper に `secrets:` 参照（`mode:0400`・jasper は非 root uid 10001 指定）。**最小権限＝S2S 秘密は使う backend と検証する jasper だけに配布（workers には配らない）**。使い方＝`docker compose -f compose.yaml -f compose.secrets.yaml up -d`。
5. **.gitignore**＝`impl/secrets/*`（実鍵追跡外）＋`!impl/secrets/*.sample`。サンプル `impl/secrets/jasper_shared_secret.sample`（ダミー文字列）を追加。
6. **テスト（テスト規約 §5・md 先行・red-green）**＝`doc/テスト/セキュリティ横断.md` §7（SEC-TC-050〜053）＋`doc/テスト/V_帳票.md` §4（V-TC-212/213）を**先に追記**。backend `tests/core/test_secret_supply.py`（4本）／jasper `tests/test_secrets.py`（2本）を実装。※`SEC-TC-` はトレーサビリティ正規表現（`\b[A-Z]-TC-`）に不一致＝md で追跡（既存 SEC-TC-045/046 と同扱い）。`V-TC-` は検査対象。
7. **ドキュメント**＝設計ドラフト §0/§5/§13 更新（実装済みの明示）／`doc/本番デプロイ要件.md` §3.1 新設＋§7.5 G1 の F9 表記更新／台帳（**F9 削除**・D6 を「部分実装」に更新・最終更新行）／`impl/README.md`（D6 節追加・F9 完了表記）。

### 3b. SOPS+age 本体（at-rest・案1 デプロイ時復号・案2 鍵非常駐）＝本セッション後半・未コミット
> ユーザーとの設計対話で確定した方針（**セキュリティ優先**）: **案1 デプロイ時復号**（イメージビルド時ではない＝本番サーバで `up` 直前）／**案2 age 鍵は本番に常駐させずデプロイ時だけ投入**（無人再起動では人の再投入まで復帰しないのを受容）／**平文は tmpfs**（ディスクに残さない）／**環境別鍵**／暗号化は authoring 時に**公開鍵**で（秘密鍵不要）・Git にコミットするのは暗号文だが**本リポジトリには `secrets.enc.yaml` を置かない**（defense-in-depth＝harvest-now-decrypt-later 回避）。
1. **`impl/.sops.yaml`**（新・公開鍵 recipient＝EXAMPLE、本番は置換）／**`impl/secrets/secrets.template.yaml`**（新・鍵名＋プレースホルダの構造テンプレ・代表9件）／**`impl/scripts/decrypt-secrets.sh`**（新・`SOPS_AGE_KEY_FILE` 投入必須〔fail-closed〕→`sops -d`→各キーを OUT_DIR に materialize）。
2. **権限の要点（ハマりどころ）**＝**非 Swarm の docker compose は secret の `uid/gid/mode` を無視**しホスト権限のまま bind-mount する（以前の D6(A) overlay が通ったのは偶然 0644 だったから）。→ `decrypt-secrets.sh` は **dir 0700＋file 0444**（コンテナ uid を問わず読める・平文は親 dir 0700＋tmpfs で守る「protect-by-directory」）。root 実行なら `STRICT_CHOWN_UID` で 0400＋消費 uid 所有。`compose.secrets.yaml` の `uid:/mode:` は削除（効かないため誤解防止）。
3. **検証ツール**＝sops/age はこの環境に無いので GitHub の静的バイナリを `/tmp/sopsbin`（age v1.2.1・sops v3.9.4）に落として検証（コミット対象外）。本番/CI は apt の `age`＋sops バイナリが前提（イメージには同梱しない）。
4. **ハマり2点**＝(a) `python3 - <<EOF` は heredoc が stdin を奪い JSON が届かない→`python3 -c` に。(b) `sops -e -i` は `.sops.yaml` の creation_rule に path が一致する必要（`secrets/secrets.enc.yaml$`）。
5. **検証（green）**＝テンプレ→`sops -e -i`（公開鍵で暗号化・値が `ENC[AES256_GCM...]`）→`decrypt-secrets.sh`（鍵投入）で tmpfs へ 9件 materialize→overlay 起動で **jasper が復号値を読み S2S 200**／誤り 401／**鍵なしは fail-closed（exit1）**。※jasper は `up` で再作成されないと旧秘密を保持＝検証時は `--force-recreate jasper` が要る。

## 4. 現在の状態（動作 / テスト）＝すべてグリーン・エンドツーエンド確認済み
- **backend/jasper を再ビルド済み**（`docker compose up -d --build backend jasper`）。現在は **base（dev）スタックで稼働中**（guard は dev で no-op）。
- **ユニット/回帰（すべて緑）**：
  - backend 新規 `tests/core/test_secret_supply.py`（SEC-TC-050〜053）＋既存 `test_deploy_hardening.py`＝**6 passed**。
  - jasper `tests/test_secrets.py`（V-TC-212/213）＝**2 passed**（backend イメージの pytest で実行＝下記コマンド）。
  - 回帰 `tests/billing + tests/me + tests/admin + tests/core`＝**178 passed**（config/main 変更の波及なし）。
  - TC トレーサビリティ ✅ **1110**。
- **エンドツーエンド（overlay で実証）**：
  - `impl/secrets/jasper_shared_secret` に強い値を置き `-f compose.secrets.yaml` で起動 → backend `settings.jasper_shared_secret` が **file 値を採用**（env は `dev-jasper-secret` のまま＝**file>env 実証**）。
  - jasper への `/render`＝**file 値 → 200+実PDF**／旧 env 値 `dev-jasper-secret` → **401**／誤り → **401**（jasper も file を使い・定数時間比較・fail-closed 実証）。
  - `APP_ENV=prod`＋dev 既定秘密で起動 → **`RuntimeError` で起動拒否**（5 つの dev 既定秘密名を列挙）。
- **未実行**＝frontend 変更なしのため build 省略（UI 非変更）。フル `tests/` 全体は未実行（変更は config/main/jasper に限定＝上記で確認）。

## 5. 詰まった点 / 学び
- **env>file が既定**（pydantic-settings の優先順位）＝`secrets_dir` を足すだけでは **env が file に勝つ**。compose は本番でも env 既定を入れるので、**`settings_customise_sources` で file>env に反転**しないとファイル供給が機能しない（セキュリティ目的が成立しない）。これが本実装の核心。
- **`secrets_dir` 非存在ディレクトリで警告**＝dev（`/run/secrets` 無し）で "directory does not exist" が1回出る → `os.path.isdir` ガードで存在時のみ有効化して抑止。
- **jasper も file>env に揃える必要**＝jasper は素の `os.environ`。compose 既定で env が常にセットされるため、env 優先だと file が永遠に使われない＝F9 が機能しない。`read_secret` を file 優先に。
- **jasper Dockerfile の COPY 漏れ**＝`_secrets.py` を COPY に足さないと warmup（`from app import`）で build 失敗。
- **jasper テストの実行**＝jasper にテスト基盤が無い。`_secrets.py` は純 stdlib なので **backend イメージの pytest** で実行＝`docker compose run --rm -T -e PYTHONPATH=/jasper -w /jasper -v "$(pwd)/jasper:/jasper" --entrypoint pytest backend tests -q`（entrypoint を pytest に上書きして bootstrap を回避・PYTHONPATH=/jasper は `app` を shadow するので entrypoint 上書きが必須）。
- **RED 裏取り**＝file>env は実装前の実測（反転前 `with-env: FROM_ENV`／反転後 `FROM_FILE`）で確認済み。ガード/ヘルパは新規シンボル＝未実装時は ImportError（red）。

## 6. 決定事項と根拠（本セッション）
- **セキュリティ優先で file > env**（env 露出面 T3 に file が負けない）＝設計 §5 の芯の実装。
- **本番 fail-closed ガードは「dev 既定値拒否」型**（全秘密強制 non-empty ではない）＝空が正当な秘密の意味論を壊さない（ユーザー合意）。
- **(広) を今セッションで実装**＝素通りの恐れを無くすため（ユーザー指示）。SOPS 本体へ回すのは**完全な秘密棚卸しによる対象拡張のみ**（台帳 D6 に明記）。
- **最小権限**＝S2S 秘密は backend/jasper だけに配布（workers 除外）。※当初 compose に書いた `mode:0400`/`uid:10001` は**非 Swarm では無視される**ことが判明（後半で修正）＝権限は復号ファイル側（dir0700/file0444）で制御。
- **env 露出面の縮小（ファイルマウント）＋ at-rest 暗号化（SOPS+age）の両方を本セッションで実装**（守れる/守れないは設計 §7）。平文は tmpfs で非永続・age 鍵は非常駐（案2）。

## 7. 次にやること（優先順・ファイル/関数レベル）
> 着手前に実コードで裏取り。**残作業の正本＝`doc/バックログ/未実装・ギャップ一覧.md`**。
1. **（本セッションの締め）SOPS 本体分のコミット＆push**＝ユーザー合意後。§3b の未コミット分（.sops.yaml/secrets.template.yaml/decrypt-secrets.sh/compose.secrets.yaml/.gitignore/docs）をまとめる。**`secrets/age_example.key`・`secrets/secrets.enc.yaml` は gitignore＝コミットされない**（残すと検証に再利用可）。
2. **D6 の残（(B)＋運用）**＝(B) **AES-GCM DB 暗号ラッパー**＝消費者 D3 カメリオ実装時に併せて（§4-B/§6・現状ブロック）／**秘密の完全棚卸し＋`_DEV_DEFAULT_SECRETS`／file 結線の対象拡張**（§12-3・DB 等は消費者トポロジ注意）。**SOPS+age 本体（at-rest）は本セッションで完了**（案1/案2・平文 tmpfs）。**運用手順書＝[doc/運用/シークレット管理_手順書.md](doc/運用/シークレット管理_手順書.md)**（鍵生成・暗号化・dev/本番復号・ローテ・トラブルシュートの具体コマンド・dev でも SOPS 可〔dev 専用鍵〕を明記）。
3. **（候補・ユーザー判断待ち）F6 AI 評価・再評価ボタンの表示条件**＝台帳 F6（出典＝`doc/セッション調整/引継/2026-10-09_ai評価-有効化と再評価ボタン.md`）。`IdeaDetailView.tsx:825` 付近。変更はユーザー意図確認後。
4. **（候補・掃除）F7 concepts 独自スコープチャットのレガシー掃除**＝台帳 F7（出典＝`doc/セッション調整/引継/2026-10-09_リッチテキスト2系統統一-tiptap移行.md`）。
5. **（候補）帳票 follow-up F8（和文）/F10（実請求データ）/F11（非同期）**／**D2 AI 駆動型アイデア生成**。
6. **（任意）フル `tests/` 全体実行**＝共有 dev DB は非冪等＝事前に acme/acme2 drop→bootstrap（memory `e2e-full-not-idempotent-shared-db`）。
7. 完了時＝`impl/README.md` 現況更新・台帳から完了行削除・handoff 全文更新。

## 8. 再開に必要な環境情報
- 作業ディレクトリ：`/home/t-umekawa/sc-ideaquest-G2`（実装 `impl/`・frontend `impl/frontend`・backend `impl/backend`・帳票 Jasper `impl/jasper`）。compose は `impl/compose.yaml`・**本番秘密オーバーレイ `impl/compose.secrets.yaml`**。
- 起動：`cd impl && docker compose up -d`（dev＝env・jasper も既定 up）。**本番秘密供給の検証**＝`docker compose -f compose.yaml -f compose.secrets.yaml up -d`（要 `impl/secrets/jasper_shared_secret` 実ファイル＝`.sample` を複製）。backend=`:8000`・frontend=`:3000`・MailHog=`:8025`・MinIO=`:9000/:9001`。jasper は公開ポート無（内部 `jasper_net`）。
- 反映（ソースベイク・volumes 無）：`cd impl && docker compose up -d --build backend|frontend|jasper`。
- テスト：
  - backend（ベイク）`cd impl && docker compose exec -T backend pytest <path> -q`。**未コミット/新規テスト反映は** `cd impl && docker compose run --rm -T -v "$(pwd)/backend:/app" backend pytest <path> -q`。
  - jasper `_secrets`＝`cd impl && docker compose run --rm -T -e PYTHONPATH=/jasper -w /jasper -v "$(pwd)/jasper:/jasper" --entrypoint pytest backend tests -q`。
  - frontend `cd impl/frontend && npm run build`／`npx vitest run <path>`／e2e `npx playwright test <spec> -g "<TC>" --workers=1`。
  - TC トレーサビリティ：`cd /home/t-umekawa/sc-ideaquest-G2 && python3 scripts/check_tc_traceability.py`（リポジトリ**ルート**で実行）。
  - **本番ガードの手動確認**＝`cd impl && docker compose run --rm -T -e APP_ENV=prod --entrypoint python backend -c "from app.main import _enforce_prod_secret_guard; _enforce_prod_secret_guard()"`（dev 既定秘密で RuntimeError）。
  - **S2S 疎通**＝`docker compose exec -T backend python -c "import urllib.request;print(urllib.request.urlopen('http://jasper:8000/health',timeout=3).read())"`。`/render` は `X-Report-Secret`（dev 既定 `dev-jasper-secret`）が必要。
- DB直接：`cd impl && docker compose exec -T db psql -U ideaquest -d ideaquest_control`（control）／`-d ideaquest_company_acme`（会社）。資格＝`ideaquest`/`ideaquest`。
- ログイン（PW いずれも `Passw0rd!`）：一般 `ACME-01`/`user@acme.example`／会社管理 `ACME-01`/`kanri@acme.example`（company_account_admin）／OPS `admin@ops.example`（system_admin）。

## 9. 残作業一覧への参照
- 残作業の正本＝**`doc/バックログ/未実装・ギャップ一覧.md`**。次回確認すべき項目＝**D6 残（SOPS 本体/(B)/棚卸し）・F6（ユーザー判断待ち）・F7（concepts レガシー掃除）・帳票 F8/F10/F11・D2（AI アイデア生成）**。ISO ギャップ（G2 ポートフォリオ/G3 指標＝優先度高）と横断（O1 ZAP DAST）も参照。
- 関連の引継ファイル（`doc/セッション調整/引継/`）＝`2026-10-09_ai評価-有効化と再評価ボタン.md`（F6 の出典・残置）／`2026-10-09_リッチテキスト2系統統一-tiptap移行.md`（F7 残のため残置）。
